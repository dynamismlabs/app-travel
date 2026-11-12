/**
 * Bounded background work. One call runs one step for one account: a Gmail
 * page with at most ten bodies, a Calendar page, or a small enrichment batch
 * (reading a booking attachment, or the opted-in AI fallback). Records and
 * the checkpoint commit together. Nothing loops or starts a timer: Travel's
 * declared job (sync_sources) runs a few steps each time it runs. Deleted
 * mail marks its evidence "Source unavailable" and never cancels a booking.
 *
 * Accounts and tools come from Ri's hub: what the person allowed Travel on
 * its page in Ri.
 */
import { AppError, accountSource, redact, transaction, type JobRecord } from "../lib/data.js";
import type { Context } from "@app-builder/core";
import { emailDomain, type MailHeaders } from "../lib/mail.js";
import { calendarSyncStep, failureKind, gmailSyncStep, hubFor, HUB_TOOLS, newCalendarCheckpoint, type CalendarCheckpoint, type CalendarEvent, type Hub, type MailCheckpoint } from "../lib/sources.js";
import { createSources } from "./sources.js";
import { parseConfirmation } from "../domain/parse/extract.js";
import { aiExtract } from "./ai.js";
import { CALENDAR_FUTURE_DAYS, CALENDAR_PAST_DAYS, DEFAULT_HISTORY_DAYS, type Travel } from "./core.js";
import { canonicalText, createIntake } from "./evidence.js";

const PROVIDERS = [
  "airbnb", "booking.com", "expedia", "hotels.com", "vrbo", "kayak", "tripit", "trip.com", "agoda", "priceline", "hopper", "orbitz", "travelocity",
  "hertz", "avis", "enterprise", "sixt", "budget", "europcar", "alamo", "nationalcar", "turo",
  "amtrak", "eurostar", "trainline", "sncf", "renfe", "trenitalia", "italotreno", "bahn.de", "viarail", "cp.pt",
  "delta", "united", "aa.com", "southwest", "jetblue", "alaskaair", "aircanada", "westjet", "britishairways", "lufthansa", "airfrance", "klm", "flytap", "iberia",
  "ryanair", "easyjet", "emirates", "qatarairways", "singaporeair", "cathaypacific", "ana.co.jp", "jal", "qantas", "aeromexico", "latam", "avianca", "turkishairlines", "swiss.com", "virginatlantic", "frontier", "spirit",
  "marriott", "hilton", "hyatt", "ihg", "accor", "wyndham", "choicehotels", "bestwestern", "radisson", "fourseasons",
  "opentable", "resy", "sevenrooms", "tock", "getyourguide", "viator", "klook", "tiqets", "eventbrite",
];
const SUBJECT_TERMS = ["confirmation", "confirmed", "itinerary", "reservation", "booking", "e-ticket", "eticket", "boarding pass", "your trip", "your stay", "your flight", "check-in", "cancellation", "schedule change", "trip details"];
/** Travel confirmations from airlines, hotels, rail, car rental and booking platforms. Combined with the history window by the sync step. */
export const GMAIL_QUERY = `{${SUBJECT_TERMS.map((term) => `subject:${term.includes(" ") || term.includes("-") ? `"${term}"` : term}`).join(" ")} ${PROVIDERS.map((name) => `from:${name}`).join(" ")}} -category:promotions -category:social -in:chats -in:drafts`;

const SUBJECT_RELEVANT = /\b(?:confirm(?:ation|ed)|itinerary|reservation|booking|e-?ticket|boarding\s+pass|your\s+(?:trip|stay|flight|train|car)|check-?in|cancell?(?:ation|ed)|schedule\s+change|flight|hotel|rental)\b/i;
const SNIPPET_RELEVANT = /\b(?:confirmation\s+(?:number|code)|booking\s+(?:reference|number)|record\s+locator|check-?in|check-?out|departure|pick-?up|itinerary|reservation\s+(?:number|confirmed))\b/i;
/** Cheap header check for new mail before reading a body. */
export function headerRelevant(headers: MailHeaders): boolean {
  if (headers.labelIds.some((label) => ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "SPAM", "TRASH", "DRAFT", "SENT"].includes(label))) return false;
  if (SUBJECT_RELEVANT.test(headers.subject)) return true;
  const domain = headers.from ? emailDomain(headers.from.address) ?? "" : "";
  if (PROVIDERS.some((name) => domain.includes(name.replace(/\.com$/, "")))) return SNIPPET_RELEVANT.test(headers.snippet) || /\b(?:trip|travel|flight|stay|reservation)\b/i.test(headers.subject);
  return SNIPPET_RELEVANT.test(headers.snippet);
}

export interface StepSummary { ran: boolean; kind: string | null; source: string | null; more: boolean; summary: string; read: number; added: number; review: number; skipped: number; removed: number; failure?: ReturnType<typeof failureKind> }
const idle = (summary: string): StepSummary => ({ ran: false, kind: null, source: null, more: false, summary, read: 0, added: 0, review: 0, skipped: 0, removed: 0 });
const IDLE_MS = 4 * 60_000;

export function createSync(t: Travel, ctx: Context) {
  const { repo, jobs, accounts, mailIndex, db } = t;
  const intake = createIntake(t);
  const sources = createSources(t);

  function markRemoved(account: string, messageId: string, actor: string) {
    const evidence = repo.evidenceByExternal(accountSource(account), messageId);
    mailIndex.record(account, messageId, evidence?.threadId ?? messageId, "removed");
    if (!evidence || evidence.availability === "unavailable") return;
    repo.updateEvidence(evidence.id, { availability: "unavailable", unavailableAt: repo.iso() });
    for (const link of repo.linksForEvidence(evidence.id))
      repo.addChange({ bookingId: link.bookingId, evidenceId: evidence.id, kind: "source_unavailable", fields: [], actor, sourceKey: evidence.sourceKey, note: "The confirmation email was deleted or moved to Trash in Gmail. The booking is unchanged and nothing was canceled." });
  }
  function restore(account: string, messageId: string, actor: string) {
    const evidence = repo.evidenceByExternal(accountSource(account), messageId);
    if (!evidence || evidence.availability === "available") return;
    repo.updateEvidence(evidence.id, { availability: "available", unavailableAt: null });
    mailIndex.record(account, messageId, evidence.threadId ?? messageId, "kept");
    for (const link of repo.linksForEvidence(evidence.id))
      repo.addChange({ bookingId: link.bookingId, evidenceId: evidence.id, kind: "source_restored", fields: [], actor, sourceKey: evidence.sourceKey, note: "The confirmation email is back in Gmail." });
  }

  async function mailStep(hub: Hub, account: string, actor: string, budgetMs: number): Promise<Omit<StepSummary, "ran" | "kind" | "source">> {
    const stored = accounts.get(account, "mail")!;
    const deadline = Date.now() + Math.min(budgetMs, 20_000);
    let added = 0, review = 0;
    // The step's records are applied with its checkpoint in one transaction. A failure part way
    // still keeps the messages already read, without moving the checkpoint, so the page resumes.
    const pending: (() => void)[] = [];
    const buffered = new Set<string>();
    const apply = () => { for (const operation of pending.splice(0)) operation(); };
    let result: Awaited<ReturnType<typeof gmailSyncStep>>;
    try {
      result = await gmailSyncStep({
        hub, account, checkpoint: stored.checkpoint as MailCheckpoint | null, windowDays: stored.historyDays, query: GMAIL_QUERY, deadline, now: t.now,
        seen: (id) => buffered.has(id) || mailIndex.seen(account, id),
        relevant: headerRelevant,
        ingest: (message) => {
          buffered.add(message.id);
          pending.push(() => {
            const outcome = intake.mailMessage(account, message, actor);
            mailIndex.record(account, message.id, message.threadId, outcome.kept ? "kept" : "skipped", { receivedAt: message.receivedAt, digest: message.digest });
            added += outcome.outcomes.filter((item) => item.action === "created").length;
            review += outcome.outcomes.filter((item) => !!item.reviewId).length + (outcome.evidence?.parseStatus === "unreadable" ? 1 : 0);
          });
        },
        skip: (id, thread) => { buffered.add(id); pending.push(() => mailIndex.record(account, id, thread, "skipped")); },
        removed: (id) => pending.push(() => markRemoved(account, id, actor)),
        relabeled: (id, labels, wasAdded) => { if (!wasAdded && labels.some((label) => label === "TRASH" || label === "SPAM")) pending.push(() => restore(account, id, actor)); },
      });
    } catch (error) {
      if (pending.length) transaction(db, apply);
      throw error;
    }
    transaction(db, () => {
      apply();
      accounts.commit(account, "mail", result.checkpoint, result.checkpoint.backfill.complete ? "ready" : "importing", result.checkpoint.emailAddress);
    });
    const parts = [
      result.lane === "profile" ? "Found the mailbox position" : `Checked ${result.lane === "history" ? "new mail" : "older mail"}`,
      result.read ? `read ${result.read} message${result.read === 1 ? "" : "s"}` : null,
      added ? `added ${added} booking${added === 1 ? "" : "s"}` : null,
      review ? `${review} to review` : null,
      result.removed ? `${result.removed} source${result.removed === 1 ? "" : "s"} no longer in Gmail` : null,
    ].filter(Boolean);
    return { more: result.more, summary: parts.join(", "), read: result.read, added, review, skipped: result.skipped, removed: result.removed };
  }

  function storeEvent(account: string, calendarId: string, event: CalendarEvent) {
    const allDay = event.allDay || (event.start?.length ?? 0) === 10;
    const normalize = (value: string | undefined) => (!value ? null : allDay ? value.slice(0, 10) : Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString());
    const self = event.attendees.find((attendee) => attendee.self);
    repo.upsertCalendarEvent({
      account, calendarId, occurrenceKey: event.recurringEventId ? `${event.recurringEventId}@${event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? event.id}` : event.id,
      summary: event.summary?.slice(0, 300) ?? null, location: event.location?.slice(0, 300) ?? null, startValue: normalize(event.start), endValue: normalize(event.end), allDay,
      startZone: event.startTimeZone ?? null, status: event.status ?? null, cancelled: event.cancelled, transparent: event.transparency === "transparent",
      response: self?.responseStatus ?? event.responseStatus ?? null, sourceKey: accountSource(account),
    });
  }

  async function calendarStep(hub: Hub, account: string): Promise<Omit<StepSummary, "ran" | "kind" | "source">> {
    const stored = accounts.get(account, "calendar")!;
    const checkpoints = { ...((stored.checkpoint ?? {}) as Record<string, CalendarCheckpoint>) };
    if (!stored.calendars.length) return { more: false, summary: "No calendars chosen", read: 0, added: 0, review: 0, skipped: 0, removed: 0 };
    const pending = stored.calendars.find((id) => !checkpoints[id]?.completedAt || checkpoints[id]?.pageToken) ?? [...stored.calendars].sort((a, b) => (checkpoints[a]?.lastSuccessAt ?? "").localeCompare(checkpoints[b]?.lastSuccessAt ?? ""))[0];
    // The history range reaches back for past events. The future window covers trips planned up to a year ahead.
    const checkpoint = checkpoints[pending] ?? newCalendarCheckpoint(pending, Math.max(CALENDAR_PAST_DAYS, stored.historyDays), CALENDAR_FUTURE_DAYS, t.now());
    const events: CalendarEvent[] = [];
    const result = await calendarSyncStep({ hub, account, checkpoint, now: t.now, ingest: (event) => { events.push(event); } });
    checkpoints[pending] = result.checkpoint;
    const complete = stored.calendars.every((id) => checkpoints[id]?.completedAt && !checkpoints[id]?.pageToken);
    const count = events.length;
    // The page's events and its checkpoint commit together.
    transaction(db, () => {
      for (const event of events) storeEvent(account, pending, event);
      accounts.commit(account, "calendar", checkpoints, complete ? "ready" : "importing");
    });
    return { more: result.more || !complete, summary: `Checked calendar events, ${count} updated`, read: count, added: 0, review: 0, skipped: 0, removed: 0 };
  }

  async function enrichStep(hub: Hub, source: string, actor: string, budgetMs: number): Promise<Omit<StepSummary, "ran" | "kind" | "source">> {
    const account = source.replace(/^account:/, "");
    const aiEnabled = t.settings.get().aiExtraction;
    const statuses: ("pending_attachment" | "pending_ai")[] = aiEnabled ? ["pending_attachment", "pending_ai"] : ["pending_attachment"];
    const batch = repo.evidenceByStatus(statuses, [source], 3);
    const deadline = Date.now() + Math.min(budgetMs, 30_000);
    let read = 0, added = 0, review = 0;
    const notes: string[] = [];
    for (const evidence of batch) {
      if (Date.now() >= deadline || hub.signal.aborted) break;
      let text = evidence.textBlob ? t.blobs.readText(evidence.textBlob) ?? "" : "";
      if (evidence.parseStatus === "pending_attachment") {
        const pdfs = evidence.attachments.filter((item) => item.mimeType === "application/pdf" && item.attachmentId).slice(0, 2);
        let blocked: string | null = null;
        for (const pdf of pdfs) {
          try {
            const tools = await hub.tools();
            if (!tools.includes(HUB_TOOLS.attachment) || !tools.includes(HUB_TOOLS.extractText)) throw new AppError("forbidden", "not allowed");
            const data = (await hub.call(HUB_TOOLS.attachment, { messageId: evidence.externalId, attachmentId: pdf.attachmentId }, account)) as { data?: string };
            if (!data?.data) continue;
            const base64 = Buffer.from(data.data, "base64url").toString("base64");
            const extracted = (await hub.call(HUB_TOOLS.extractText, { fileName: pdf.filename.slice(0, 200), mimeType: "application/pdf", base64 })) as { text?: string };
            if (extracted?.text) text = `${text}\n\nAttachment ${pdf.filename}:\n${extracted.text}`;
          } catch (error) {
            const kind = failureKind(error);
            if (kind === "not_allowed") { blocked = "Reading attachments is not allowed for Travel. Allow attachments and reading files for Travel in Ri, or enter the details by hand."; break; }
            if (kind === "reconnect" || kind === "busy") throw error;
            blocked = redact(error);
          }
        }
        read++;
        const parse = parseConfirmation({ text, subject: evidence.title, senderName: evidence.sender, receivedAt: evidence.receivedAt });
        transaction(db, () => {
          const textBlob = intake.storeText(text);
          if (parse.bookings.length) {
            repo.updateEvidence(evidence.id, { parseStatus: "parsed", parseMethod: "deterministic", textBlob, parseNote: null });
            const outcomes = intake.applyAll(repo.evidence(evidence.id)!, parse, actor);
            added += outcomes.filter((item) => item.action === "created").length;
            review += outcomes.filter((item) => !!item.reviewId).length;
          } else if (aiEnabled && !blocked) repo.updateEvidence(evidence.id, { parseStatus: "pending_ai", textBlob });
          else {
            repo.updateEvidence(evidence.id, { parseStatus: "unreadable", textBlob, parseNote: blocked ?? "No booking details could be read from the attachment." });
            t.ingest(actor).review({ kind: "unreadable", evidence: repo.evidence(evidence.id)!, reason: blocked ?? "This looks like a travel confirmation, but no booking details could be read from the message or its attachment. Enter the details by hand." });
            review++;
          }
        });
        continue;
      }
      // Opted-in AI fallback with exact passages. Suggestions wait in Review.
      const result = await aiExtract(ctx, text, { subject: evidence.title, receivedAt: evidence.receivedAt });
      read++;
      if (result.status === "unavailable") {
        repo.updateEvidence(evidence.id, { parseNote: result.reason });
        notes.push(result.reason);
        break;
      }
      transaction(db, () => {
        if (result.status === "ok") {
          repo.updateEvidence(evidence.id, { parseStatus: "partial", parseMethod: "ai", parseNote: "AI suggestion waiting in Review" });
          const parse = { bookings: result.bookings, forwarded: evidence.forwarded, travelLike: true, notes: [] };
          review += intake.applyAll(repo.evidence(evidence.id)!, parse, actor).filter((item) => !!item.reviewId).length;
        } else {
          repo.updateEvidence(evidence.id, { parseStatus: "ai_failed", parseNote: result.reason });
          t.ingest(actor).review({ kind: "unreadable", evidence: repo.evidence(evidence.id)!, reason: `${result.reason} Enter the details by hand, or dismiss.` });
          review++;
        }
      });
    }
    const remaining = repo.evidenceByStatus(statuses, [source], 1).length > 0 && !notes.length;
    return { more: remaining, summary: notes[0] ?? `Read ${read} saved source${read === 1 ? "" : "s"}${review ? `, ${review} to review` : ""}${added ? `, added ${added}` : ""}`, read, added, review, skipped: 0, removed: 0 };
  }

  /**
   * Run one bounded step. The job passes nothing and works through the
   * accounts Ri grants fairly. Continue passes one account and kind.
   */
  async function step(options: { only?: { account: string; kind: "mail" | "calendar" }; kinds?: string[]; budgetMs?: number; hub?: Hub } = {}): Promise<StepSummary> {
    t.resolve(ctx, "write");
    const actor = t.actor(ctx);
    const budgetMs = options.budgetMs ?? 40_000;
    const hub = options.hub ?? hubFor(ctx);
    try {
      jobs.recover();
      // Which accounts Ri lets Travel read now.
      const found = await sources.discover(hub);
      if (!found.connected) {
        if (options.only) throw new AppError("revoked", found.message ?? "Connect Travel to Ri in Settings to import from your accounts.");
        return idle(found.message ?? "Connect Travel to Ri in Settings to import bookings from Gmail and Calendar.");
      }
      const granted = (["mail", "calendar"] as const).flatMap((kind) => found[kind].map((account) => ({ account, kind })))
        .filter((item) => !options.only || (item.account === options.only.account && item.kind === options.only.kind));
      if (options.only && !granted.length) throw new AppError("forbidden", "Allow this account for Travel in Ri first");
      const sourceKeys = new Set<string>();
      transaction(db, () => {
        for (const item of granted) {
          const kind = item.kind;
          const source = accountSource(item.account);
          let stored = accounts.get(item.account, kind);
          if (!stored) stored = accounts.setup({ account: item.account, kind, historyDays: DEFAULT_HISTORY_DAYS, label: item.account, calendars: kind === "calendar" ? ["primary"] : [] });
          const job = jobs.ensure(`${kind}_sync`, source, { idempotent: true });
          if (stored.paused) {
            if (job.state !== "paused") jobs.pause(source);
            continue;
          }
          if (job.state === "paused") jobs.resume(source);
          if (kind === "mail" && repo.evidenceByStatus(t.settings.get().aiExtraction ? ["pending_attachment", "pending_ai"] : ["pending_attachment"], [source], 1).length) jobs.ensure("enrich", source, { idempotent: true });
          if (options.only) {
            // A person asked to continue now: retry a failed step and skip the idle wait.
            const current = jobs.find(`${kind}_sync`, source)!;
            if (current.state === "failed") jobs.resume(source);
            else jobs.wake(current.id);
            const enrich = jobs.find("enrich", source);
            if (enrich && enrich.state === "pending") jobs.wake(enrich.id);
          }
          sourceKeys.add(source);
        }
      });
      if (options.only && accounts.get(options.only.account, options.only.kind)?.paused) return idle("Updates are paused for this account. Resume them to continue.");
      const kinds = options.kinds ?? (options.only ? [`${options.only.kind}_sync`, ...(options.only.kind === "mail" ? ["enrich"] : [])] : undefined);
      // The work queue keeps real time, independent of the clock used for trip dates.
      const job = jobs.next(new Date().toISOString(), { sources: sourceKeys, kinds });
      if (!job) return idle(granted.length ? "Everything is up to date for now." : "Ri hasn't allowed Travel to read any accounts yet.");
      const claimed = jobs.claim(job.id);
      const account = claimed.sourceKey.replace(/^account:/, "");
      try {
        const result = claimed.kind === "mail_sync" ? await mailStep(hub, account, actor, budgetMs)
          : claimed.kind === "calendar_sync" ? await calendarStep(hub, account)
          : await enrichStep(hub, claimed.sourceKey, actor, budgetMs);
        jobs.finish(claimed.id, { more: result.more, idleMs: IDLE_MS });
        return { ran: true, kind: claimed.kind, source: claimed.sourceKey, ...result };
      } catch (error) {
        return failed(claimed, account, error);
      }
    } finally { if (!options.hub) await hub.close(); }
  }

  function failed(job: JobRecord, account: string, error: unknown): StepSummary {
    const kind = job.kind === "calendar_sync" ? "calendar" : "mail";
    const failure = failureKind(error);
    const message = error instanceof Error ? error.message : "";
    const reason = failure === "reconnect" && /connect this app/i.test(message) ? "Reconnect Travel to Ri in Settings to continue updates. Records already imported are kept."
      : failure === "reconnect" ? "Reconnect this account in Ri to continue updates. Records already imported are kept."
      : failure === "not_allowed" ? "Travel no longer has access to this account. Allow it for Travel in Ri."
      : failure === "choose_account" ? "Ri asked which account to use. Check Travel's accounts in Ri."
      : failure === "busy" ? "The account was busy. Travel will try again shortly."
      : redact(error);
    transaction(db, () => {
      // A disconnected hub retries with backoff, so updates resume on their own after reconnecting.
      jobs.fail(job.id, reason, { retryable: failure !== "not_allowed" });
      if (accounts.get(account, kind)) accounts.failed(account, kind, failure === "reconnect" || failure === "not_allowed" || failure === "choose_account" ? "reconnect" : "error", reason);
    });
    if (failure === "interrupted") throw error;
    return { ran: true, kind: job.kind, source: job.sourceKey, more: false, summary: reason, read: 0, added: 0, review: 0, skipped: 0, removed: 0, failure };
  }

  return { step, markRemoved, restore, storeEvent, mailStep, calendarStep, enrichStep };
}
export type Sync = ReturnType<typeof createSync>;
export { canonicalText };
