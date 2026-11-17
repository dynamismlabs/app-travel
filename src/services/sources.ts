/**
 * Sources: the accounts Ri's hub lets Travel read, imported files and the
 * collections. What each assistant connection may see is chosen on the
 * kit's consent screen and listed in Settings. Removing an account happens
 * in Ri and keeps records. Delete imported data removes what one source
 * supplied, keeps notes a person wrote and pauses that account so nothing
 * re-imports by surprise.
 */
import { z } from "zod/v3";
import { AppError } from "../lib/data.js";
import { accountSource, type AccessScope } from "../lib/data.js";
import type { Context } from "@app-builder/core";
import { accountsFromChoice, calendarCoverage, changeMailWindow, DEFAULT_ACCOUNT, failureKind, hubFor, HUB_TOOLS, listCalendars, mailCoverage, mailProfile, type Hub, type MailCheckpoint, type SourceAccount } from "../lib/sources.js";
import { localDate } from "../lib/time.js";
import { COLLECTION_LABELS, IMPORTS_SOURCE, MANUAL_SOURCE } from "../domain/model.js";
import type { EvidenceRow } from "../db/repo.js";
import type { listSourcesOutput, setupSourceInput } from "../actions/schemas.js";
import { DEFAULT_HISTORY_DAYS, type Travel } from "./core.js";
import { clip, dateLabel } from "./records.js";
import { GMAIL_QUERY } from "./sync.js";

type SourcesOutput = z.infer<typeof listSourcesOutput>;
type HistoryDays = 30 | 90 | 365;
const asHistory = (days: number): HistoryDays => (days <= 30 ? 30 : days <= 90 ? 90 : 365);

export function createSources(t: Travel) {
  const { repo, accounts, jobs, mailIndex } = t;

  function sourceStatus(stored: SourceAccount | null, granted: boolean, fictional: boolean): SourcesOutput["accounts"][number]["status"] {
    if (!stored) return "not_started";
    if (stored.paused) return "paused";
    if (!granted && !fictional) return "reconnect";
    return stored.status;
  }

  function accountRecord(account: string, kind: "mail" | "calendar", grant: { automatic: boolean } | null): SourcesOutput["accounts"][number] {
    const stored = accounts.get(account, kind);
    const source = accountSource(account);
    const zone = t.zone();
    let coverage: SourcesOutput["accounts"][number]["coverage"] = null;
    if (stored?.checkpoint) {
      if (kind === "mail") {
        const value = mailCoverage(stored.checkpoint as MailCheckpoint);
        if (value.from && value.to) coverage = { from: localDate(value.from, zone), to: localDate(value.to, zone), partial: value.partial };
      } else {
        const checkpoints = Object.values(stored.checkpoint as Record<string, Parameters<typeof calendarCoverage>[0]>);
        const values = checkpoints.map((checkpoint) => calendarCoverage(checkpoint));
        const from = values.map((value) => value.from).filter((value): value is string => !!value).sort()[0];
        const to = values.map((value) => value.to).filter((value): value is string => !!value).sort().at(-1);
        if (from && to) coverage = { from: localDate(from, zone), to: localDate(to, zone), partial: values.some((value) => value.partial) || checkpoints.length < (stored.calendars.length || 1) };
      }
    }
    const evidence = kind === "mail" ? repo.evidenceForSource(source) : [];
    // Saved sources still waiting to be read: booking attachments, and AI reading when it is on.
    const pending = evidence.filter((row) => row.parseStatus === "pending_attachment" || (row.parseStatus === "pending_ai" && t.settings.get().aiExtraction)).length;
    const failed = evidence.filter((row) => row.parseStatus === "unreadable" || row.parseStatus === "ai_failed").length + jobs.list(source).filter((job) => job.kind === `${kind}_sync` && job.state === "failed").length;
    const bookings = kind === "mail" ? Number(repo.get("SELECT COUNT(*) AS count FROM bookings b WHERE EXISTS (SELECT 1 FROM json_each(b.source_keys) j WHERE j.value = ?)", source)?.count ?? 0) : repo.calendarCount(account);
    const firstTrip = kind === "mail" ? repo.get("SELECT t.id, t.title, t.start_date, t.end_date, (SELECT COUNT(*) FROM bookings x WHERE x.trip_id = t.id) AS bookings FROM trips t WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id AND EXISTS (SELECT 1 FROM json_each(b.source_keys) j WHERE j.value = ?)) ORDER BY t.created_at LIMIT 1", source) : undefined;
    const fictional = evidence.some((row) => row.fictional) || (kind === "calendar" && repo.evidenceForSource(source).some((row) => row.fictional));
    const lastError = stored?.lastError ?? (!grant && stored && !fictional ? "Travel no longer has access to this account. Records already imported are kept." : null);
    return {
      id: `${kind}:${account}`, account, label: clip(stored?.label ?? (kind === "mail" ? "Email account" : "Calendar account"), 200), detail: null, kind,
      granted: !!grant, automatic: !!grant?.automatic, status: sourceStatus(stored, !!grant, fictional), coverage, historyDays: asHistory(stored?.historyDays ?? DEFAULT_HISTORY_DAYS),
      lastSuccessAt: stored?.lastSuccessAt ?? null, pending, failed, error: lastError ? clip(lastError, 300) : null, paused: !!stored?.paused,
      records: bookings, skipped: kind === "mail" ? mailIndex.counts(account).skipped : 0, calendars: (stored?.calendars ?? []).slice(0, 20),
      fictional,
      firstDetected: firstTrip ? { tripId: String(firstTrip.id), title: clip(String(firstTrip.title), 200), dateLabel: dateLabel(firstTrip.start_date as string | null, firstTrip.end_date as string | null), bookings: Number(firstTrip.bookings) } : null,
    };
  }

  /** An account is granted while Ri still lists it for Travel (checked by `discover`). */
  const grantOf = (stored: SourceAccount | null) => (stored && stored.status !== "reconnect" ? { automatic: true } : null);

  function list(): SourcesOutput {
    const keys = new Map<string, { account: string; kind: "mail" | "calendar" }>();
    for (const stored of accounts.list()) keys.set(`${stored.kind}:${stored.account}`, { account: stored.account, kind: stored.kind });
    const importEvidence = repo.evidenceForSource(IMPORTS_SOURCE).sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 200);
    const linked = (row: EvidenceRow) => repo.linksForEvidence(row.id).length;
    const settings = t.settings.get();
    return {
      accounts: [...keys.values()].slice(0, 60).map((value) => accountRecord(value.account, value.kind, grantOf(accounts.get(value.account, value.kind)))),
      imports: importEvidence.map((row) => ({ id: `import:${row.id}`, name: clip(row.title, 200), kind: row.origin === "paste" ? "Pasted text" : row.mimeType === "application/pdf" ? "PDF" : row.mimeType === "message/rfc822" ? "Saved email" : "File", importedAt: row.observedAt, records: linked(row), status: row.parseStatus === "parsed" ? "imported" : row.parseStatus === "unreadable" || row.parseStatus === "ai_failed" ? "failed" : "partial" })),
      collections: [
        { key: MANUAL_SOURCE, label: COLLECTION_LABELS[MANUAL_SOURCE], records: Number(repo.get("SELECT (SELECT COUNT(*) FROM bookings WHERE source_key = 'manual') + (SELECT COUNT(*) FROM ideas WHERE removed_at IS NULL) + (SELECT COUNT(*) FROM trips WHERE source_key = 'manual') AS count")?.count ?? 0) },
        { key: IMPORTS_SOURCE, label: COLLECTION_LABELS[IMPORTS_SOURCE], records: importEvidence.length },
      ],
      settings: { homeZone: settings.homeZone, ownerNames: settings.ownerNames, aiExtraction: settings.aiExtraction },
      mailQuery: GMAIL_QUERY.slice(0, 2000),
      note: "Travel searches the chosen mail history for confirmations from airlines, hotels, rail, car rental and booking platforms. Search is a relevance filter, so an older or unusual booking may be missing. Add it from a file or by hand. Calendar is read only to check trips against your schedule. Travel reads these accounts through Ri: which accounts and tools it may use is chosen on its page in Ri.",
      revision: `r${repo.dataRevision()}`,
    };
  }

  function setup({ sourceAccount, ...rest }: z.infer<typeof setupSourceInput>) {
    const input = { ...rest, account: sourceAccount };
    if (!accounts.get(input.account, input.kind)) throw new AppError("forbidden", "Allow this account for Travel in Ri first, then check for accounts again");
    const existing = accounts.get(input.account, input.kind);
    const historyDays = input.historyDays ?? existing?.historyDays ?? DEFAULT_HISTORY_DAYS;
    const stored = accounts.setup({ account: input.account, kind: input.kind, historyDays, label: input.label ?? null, calendars: input.kind === "calendar" ? input.calendars ?? existing?.calendars ?? ["primary"] : [] });
    if (input.kind === "mail" && existing?.checkpoint && input.historyDays && input.historyDays !== existing.historyDays)
      accounts.commit(input.account, "mail", changeMailWindow(existing.checkpoint as MailCheckpoint, input.historyDays, t.now()), "importing");
    if (input.kind === "calendar" && existing && input.historyDays && input.historyDays !== existing.historyDays && !input.calendars)
      // A new history range rereads the chosen calendars over the new window.
      accounts.commit(input.account, "calendar", {}, "importing");
    if (input.kind === "calendar" && input.calendars) {
      // Keep checkpoints only for calendars still chosen.
      const checkpoints = (stored.checkpoint ?? {}) as Record<string, unknown>;
      const kept = Object.fromEntries(Object.entries(checkpoints).filter(([id]) => input.calendars!.includes(id)));
      accounts.commit(input.account, "calendar", kept, Object.keys(kept).length === input.calendars.length ? "ready" : "importing");
      for (const row of repo.all("SELECT DISTINCT calendar_id FROM calendar_events WHERE account = ?", input.account)) if (!input.calendars.includes(String(row.calendar_id))) repo.run("DELETE FROM calendar_events WHERE account = ? AND calendar_id = ?", input.account, String(row.calendar_id));
    }
    const job = jobs.ensure(`${input.kind}_sync`, accountSource(input.account), { idempotent: true });
    if (job.state === "pending") jobs.wake(job.id);
    return { status: "saved" as const };
  }

  function pause(account: string, paused: boolean) {
    if (!accounts.get(account, "mail") && !accounts.get(account, "calendar")) throw new AppError("not_found", "That account has not been set up in Travel");
    accounts.pause(account, paused);
    if (paused) jobs.pause(accountSource(account));
    else jobs.resume(accountSource(account));
    return { status: "saved" as const };
  }

  /** Remove what one source supplied. Bookings also supported by another source stay. Notes a person wrote are kept on the trip. */
  function deleteImported(source: string) {
    if (source === MANUAL_SOURCE) throw new AppError("invalid_input", "Manual entries are yours. Remove them one at a time");
    let evidence: EvidenceRow[];
    let sourceKey: string;
    if (source.startsWith("import:")) {
      const row = repo.evidence(source.slice("import:".length));
      if (!row || row.sourceKey !== IMPORTS_SOURCE) throw new AppError("not_found", "That import is no longer available");
      evidence = [row];
      sourceKey = IMPORTS_SOURCE;
    } else if (source === IMPORTS_SOURCE || source.startsWith("account:")) {
      evidence = repo.evidenceForSource(source);
      sourceKey = source;
    } else throw new AppError("invalid_input", "Unknown source");
    const removing = new Set(evidence.map((row) => row.id));
    let bookings = 0, keptNotes = 0;
    const touched = new Set<string>();
    for (const row of evidence) for (const link of repo.linksForEvidence(row.id)) touched.add(link.bookingId);
    for (const bookingId of touched) {
      const booking = repo.booking(bookingId);
      if (!booking) continue;
      const remaining = repo.links(bookingId).filter((link) => link.contributes && !removing.has(link.evidenceId));
      if (!remaining.length && booking.method !== "manual") {
        if (booking.notes && booking.tripId) {
          const trip = repo.trip(booking.tripId);
          if (trip) { repo.updateTrip(trip.id, { notes: [trip.notes, `Kept from ${booking.title}: ${booking.notes}`].filter(Boolean).join("\n\n").slice(0, 4000) }); keptNotes++; }
        }
        repo.deleteBooking(bookingId);
        bookings++;
      } else {
        const keys = [...new Set(remaining.map((link) => link.evidence.sourceKey).concat(booking.method === "manual" ? [MANUAL_SOURCE] : []))];
        repo.setSourceKeys(bookingId, keys.length ? keys : [MANUAL_SOURCE]);
        if (booking.sourceKey === sourceKey) repo.run("UPDATE bookings SET source_key = ? WHERE id = ?", keys[0] ?? MANUAL_SOURCE, bookingId);
      }
    }
    for (const row of evidence) {
      repo.run("DELETE FROM review_items WHERE EXISTS (SELECT 1 FROM json_each(review_items.evidence_ids) j WHERE j.value = ?)", row.id);
      repo.deleteEvidence(row.id);
      for (const digest of [row.textBlob, row.fileBlob]) {
        if (!digest) continue;
        const shared = repo.get("SELECT 1 AS used FROM evidence WHERE text_blob = ? OR file_blob = ? LIMIT 1", digest, digest) || repo.get("SELECT 1 AS used FROM import_previews WHERE (text_blob = ? OR file_blob = ?) AND applied_at IS NULL LIMIT 1", digest, digest);
        if (!shared) t.blobs.remove(digest);
      }
    }
    // Trips this source started: removed when nothing remains, otherwise kept as your own.
    if (!source.startsWith("import:"))
      for (const trip of repo.trips().filter((item) => item.sourceKey === sourceKey)) {
        const has = Number(repo.get("SELECT (SELECT COUNT(*) FROM bookings WHERE trip_id = ?) + (SELECT COUNT(*) FROM ideas WHERE trip_id = ?) AS count", trip.id, trip.id)?.count ?? 0);
        if (!has && !trip.notes) repo.deleteTrip(trip.id);
        else repo.run("UPDATE trips SET source_key = ?, updated_at = ? WHERE id = ?", MANUAL_SOURCE, repo.iso(), trip.id);
      }
    if (source.startsWith("account:")) {
      const account = source.slice("account:".length);
      mailIndex.forget(account);
      repo.deleteCalendarSource(source);
      jobs.remove(source);
      // Forget checkpoints but keep the person's setup choices.
      const stored = (["mail", "calendar"] as const).map((kind) => accounts.get(account, kind)).filter((item): item is SourceAccount => !!item);
      accounts.remove(account);
      for (const item of stored) accounts.setup({ account, kind: item.kind, historyDays: item.historyDays, label: item.label, calendars: item.calendars });
      // Paused so the next scheduled step does not import everything again.
      if (accounts.get(account, "mail") || accounts.get(account, "calendar")) accounts.pause(account, true);
    }
    return { status: "deleted" as const, source, bookings, evidence: evidence.length, keptNotes };
  }

  /**
   * What a connection can be limited to on the consent screen: each account
   * Travel reads and the two collections. Fictional preview records have their
   * own source.
   */
  function shareable() {
    const items = new Map<string, { id: string; name: string; detail?: string }>();
    for (const stored of accounts.list()) {
      const key = accountSource(stored.account);
      const existing = items.get(key);
      const detail = stored.kind === "mail" ? "Bookings imported from this email" : "Calendar events";
      items.set(key, { id: key, name: clip(stored.label ?? stored.account, 200), detail: existing ? `${existing.detail} and calendar events` : detail });
    }
    items.set(MANUAL_SOURCE, { id: MANUAL_SOURCE, name: COLLECTION_LABELS[MANUAL_SOURCE], detail: "Trips, bookings and ideas you entered" });
    items.set(IMPORTS_SOURCE, { id: IMPORTS_SOURCE, name: COLLECTION_LABELS[IMPORTS_SOURCE], detail: "Files and pasted confirmations" });
    return [...items.values()].slice(0, 200);
  }

  /**
   * Ask Ri which accounts Travel may read. Ri names no accounts when it
   * granted one, so Travel reads the mailbox's own address, or the primary
   * calendar's ID, which is the account's address. With several, Ri asks
   * Travel to choose and names them. Accounts Ri no longer lists keep their
   * records and show as needing access again.
   */
  async function discover(hub: Hub): Promise<{ mail: string[]; calendar: string[]; connected: boolean; message: string | null }> {
    const found: { mail: string[]; calendar: string[] } = { mail: [], calendar: [] };
    let tools: string[];
    try { tools = await hub.tools(); }
    catch (error) {
      const kind = failureKind(error);
      if (kind === "reconnect" || kind === "not_allowed") return { ...found, connected: false, message: error instanceof Error ? error.message : "Connect Travel to Ri in Settings." };
      throw error;
    }
    // An account that must sign in again in Ri can't name itself. Keep the ones Travel knows,
    // so their own steps report it and their records stay.
    const unsure = new Set<"mail" | "calendar">();
    const names = async (kind: "mail" | "calendar", ask: () => Promise<string | null>) => {
      try { const name = await ask(); if (name) found[kind].push(name); }
      catch (error) {
        const failure = failureKind(error);
        if (failure === "choose_account") found[kind].push(...accountsFromChoice(error));
        else if (failure === "reconnect") { unsure.add(kind); found[kind].push(...accounts.list().filter((item) => item.kind === kind && !isFictional(item.account)).map((item) => item.account)); }
        else if (failure !== "not_allowed") throw error;
      }
    };
    // A hub with only the kit's mail or calendar capability names no account: Travel uses "default".
    if (tools.includes(HUB_TOOLS.search) && tools.includes(HUB_TOOLS.metadata))
      await names("mail", async () => tools.includes(HUB_TOOLS.profile) ? (await mailProfile(hub, null)).emailAddress : DEFAULT_ACCOUNT);
    if (tools.includes(HUB_TOOLS.calendarSync) || tools.includes(HUB_TOOLS.calendarList))
      await names("calendar", async () => tools.includes(HUB_TOOLS.calendars) ? (await listCalendars(hub, "")).find((calendar) => calendar.primary)?.id ?? DEFAULT_ACCOUNT : DEFAULT_ACCOUNT);
    t.mutate(() => {
      for (const kind of ["mail", "calendar"] as const) {
        for (const account of found[kind]) {
          const stored = accounts.get(account, kind);
          if (!stored) accounts.setup({ account, kind, historyDays: DEFAULT_HISTORY_DAYS, label: account, calendars: kind === "calendar" ? ["primary"] : [] });
          else if (stored.status === "reconnect" && !unsure.has(kind)) repo.run("UPDATE app_source_accounts SET status = CASE WHEN paused = 1 THEN 'paused' WHEN checkpoint IS NULL THEN 'not_started' ELSE 'ready' END, last_error = NULL, updated_at = ? WHERE account = ? AND kind = ?", repo.iso(), account, kind);
        }
        if (unsure.has(kind)) continue;
        for (const stored of accounts.list().filter((item) => item.kind === kind && !found[kind].includes(item.account) && !isFictional(item.account)))
          accounts.failed(stored.account, kind, "reconnect", "Ri no longer lets Travel read this account. Records already imported are kept.");
      }
    });
    return { ...found, connected: true, message: null };
  }
  const isFictional = (account: string) => !!repo.get("SELECT 1 AS yes FROM evidence WHERE account = ? AND fictional = 1 LIMIT 1", account) || account.startsWith("fictional-");

  async function calendars(ctx: Context, account: string) {
    const stored = accounts.get(account, "calendar");
    if (!stored) throw new AppError("forbidden", "Allow this calendar for Travel in Ri first, then check for accounts again");
    // The fictional preview's calendar lives in Travel, not behind the hub.
    if (isFictional(account)) return { calendars: [{ id: "primary", summary: clip(stored.label ?? "Fictional calendar", 300), primary: true }], chosen: stored.calendars };
    const hub = hubFor(ctx);
    try {
      if (!(await hub.tools()).includes(HUB_TOOLS.calendars)) return { calendars: [{ id: "primary", summary: "Main calendar", primary: true }], chosen: stored.calendars };
      const found = await listCalendars(hub, account);
      return { calendars: found.slice(0, 100).map((item) => ({ id: item.id, summary: clip(item.summary, 300), primary: item.primary })), chosen: stored.calendars };
    } catch (error) {
      const failure = failureKind(error);
      if (failure === "not_allowed" || failure === "reconnect" || failure === "choose_account") throw new AppError("forbidden", "Ri doesn't let Travel list this account's calendars now. Check Travel's access in Ri.");
      if (failure === "busy") throw new AppError("busy", "Ri isn't answering right now. Try again shortly.");
      throw new AppError("app_failed", "Travel couldn't list these calendars. Try again.");
    } finally { await hub.close(); }
  }

  return { list, setup, pause, deleteImported, shareable, discover, calendars, accountRecord };
}

/**
 * Source management, Review decisions, imports and deletion need the owner:
 * the person's own browser, or a connection they allowed to see everything.
 */
export function requireOwner(scope: AccessScope) {
  if (scope.kind !== "owner") throw new AppError("forbidden", "Only a connection allowed to see all of Travel can do this. Open Travel itself, or reconnect and allow everything.");
}
