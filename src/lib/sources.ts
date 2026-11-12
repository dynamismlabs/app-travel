/**
 * Read-only Gmail and Google Calendar sources for Travel, through the
 * person's hub (Ri). One call to a step reads at most one provider page and a
 * bounded number of message bodies, returns a new checkpoint for the caller to
 * commit with the records it covers, and never loops. Gmail follows the
 * documented full plus incremental sync with history-expiry recovery, and
 * Calendar follows page plus sync-token handling.
 *
 * https://developers.google.com/workspace/gmail/api/guides/sync
 * https://developers.google.com/workspace/calendar/api/guides/sync
 *
 * The kit's connector client has capability adapters for mail search, one
 * message's text and listing events. Travel needs more than those (history
 * with deletions, full MIME with attachments and invitations, calendar sync
 * tokens), so it calls Ri's own tools by name through `connectors(ctx).call`
 * and keeps the readers here. They came from Ri's old app kit.
 */
import { z } from "zod/v3";
import { ApprovalPending, SetupRequired, SourceUnavailable, connectors, type Context } from "@app-builder/core";
import { AppError, nowIso, type SqlDatabase, transaction } from "./data.js";
import { fromCapabilityMessage, parseGmailMessage, parseMetadata, type MailHeaders, type MailMessage } from "./mail.js";

// ─── The hub ─────────────────────────────────────────────────────────────────

/** Ri's tools Travel uses, by their hub names. Declared on the application so Ri's consent screen pre-ticks them. */
export const HUB_TOOLS = {
  profile: "gmail__get_profile",
  history: "gmail__list_history",
  search: "gmail__search_messages",
  metadata: "gmail__get_message",
  read: "gmail__read_message",
  attachment: "gmail__get_attachment",
  calendars: "google_calendar__list_calendars",
  calendarSync: "google_calendar__sync_events",
  /** The kit's calendar capability (google_calendar__list_events), for hubs without sync tokens. */
  calendarList: "google_calendar__list_events",
  createTask: "ri__create_task",
  getTask: "ri__get_task",
  aiText: "ri__ai_text",
  extractText: "ri__extract_text",
} as const;

/** How Travel reaches the hub: one tool call, with the account when Ri granted several. */
export interface Hub {
  call(tool: string, input: Record<string, unknown>, account?: string | null): Promise<unknown>;
  tools(): Promise<string[]>;
  close(): Promise<void>;
  signal: AbortSignal;
}
/** The account Travel uses when Ri granted it one account and so names none. */
export const DEFAULT_ACCOUNT = "default";

export function hubFor(ctx: Context, signal: AbortSignal = new AbortController().signal): Hub {
  const client = connectors(ctx);
  let listed: Promise<string[]> | undefined;
  return {
    signal,
    tools: () => (listed ??= client.tools()),
    async call(tool, input, account) {
      if (signal.aborted) throw new AppError("interrupted", "The step was cancelled");
      const args = account && account !== DEFAULT_ACCOUNT ? { ...input, account } : input;
      const result = await client.call(tool, args);
      // Ri answers an account that needs signing in again as a result, not an error,
      // and the kit's client passes it on. It's a setup state for that account.
      const status = result && typeof result === "object" ? (result as { status?: unknown }).status : undefined;
      if (status === "authorization_required" || status === "additional_permission_required" || status === "choose_connection_method")
        throw new SetupRequired(`Reconnect this account in Ri. ${String((result as { message?: unknown }).message ?? "")}`.trim().slice(0, 300));
      return result;
    },
    close: () => client.close(),
  };
}

/**
 * What a hub failure means for Travel. Ri reports a provider's 404 or 410
 * (a message deleted after it was listed, an expired history or sync token)
 * only as text, `provider error 404 for GET ...`, so Travel reads the status
 * from the message.
 */
export function failureKind(error: unknown): "not_found" | "reconnect" | "not_allowed" | "busy" | "approval" | "choose_account" | "interrupted" | "other" {
  if (error instanceof ApprovalPending) return "approval";
  if (error instanceof AppError) {
    if (error.code === "not_found") return "not_found";
    if (error.code === "interrupted") return "interrupted";
    if (error.code === "revoked") return "reconnect";
    if (error.code === "forbidden") return "not_allowed";
    if (error.code === "busy" || error.code === "timeout") return "busy";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SourceUnavailable) return "busy";
  if (error instanceof SetupRequired) {
    if (/^Choose which account/i.test(message)) return "choose_account";
    if (/hasn't been allowed|isn't allowed|no longer allowed|doesn't allow/i.test(message)) return "not_allowed";
    return "reconnect";
  }
  if (/\bprovider error (404|410)\b/.test(message) || /\bstatus 410\b/.test(message)) return "not_found";
  return "other";
}
/** The accounts Ri named when it asked Travel to choose one ("Choose which account to use (a, b)."). */
export function accountsFromChoice(error: unknown): string[] {
  const message = error instanceof Error ? error.message : "";
  const list = /^Choose which account to use \(([^)]*)\)/i.exec(message)?.[1] ?? "";
  return list.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

// ─── Gmail sync ──────────────────────────────────────────────────────────────

export const mailCheckpointSchema = z.object({
  version: z.literal(1),
  emailAddress: z.string().max(320).nullable(),
  windowDays: z.number().int().min(1).max(3650),
  windowStart: z.string(),
  backfill: z.object({ pageToken: z.string().max(4000).nullable(), pages: z.number().int().min(0), complete: z.boolean(), completedAt: z.string().nullable(), oldestAt: z.string().nullable() }).strict(),
  history: z.object({ historyId: z.string().max(128).nullable(), pageToken: z.string().max(4000).nullable(), checkedAt: z.string().nullable() }).strict(),
  lane: z.enum(["history", "backfill"]),
  rescans: z.number().int().min(0),
  lastSuccessAt: z.string().nullable(),
}).strict();
export type MailCheckpoint = z.infer<typeof mailCheckpointSchema>;
export interface MailStepResult {
  checkpoint: MailCheckpoint;
  /** More work is ready now: an unfinished page, backfill or history page. */
  more: boolean;
  lane: "profile" | "history" | "backfill";
  read: number;
  skipped: number;
  removed: number;
  /** The step stopped at a record boundary because of the body or time budget. */
  yielded: boolean;
}
export interface MailSyncOptions {
  hub: Hub;
  account: string;
  checkpoint: MailCheckpoint | null;
  windowDays: number;
  /** A Gmail search selecting relevant mail for backfill. Combined with the window. */
  query: string;
  /** Absolute deadline (epoch ms). Stops at a record boundary before it. */
  deadline: number;
  now?: () => Date;
  maxBodies?: number;
  maxMetadata?: number;
  pageSize?: number;
  seen(messageId: string): boolean;
  relevant?(headers: MailHeaders): boolean;
  ingest(message: MailMessage): void | Promise<void>;
  skip(messageId: string, threadId: string): void;
  removed(messageId: string): void;
  relabeled?(messageId: string, labelIds: string[], added: boolean): void;
}
function windowStartFor(days: number, now: Date) {
  return new Date(now.getTime() - days * 864e5).toISOString();
}
export function newMailCheckpoint(windowDays: number, now = new Date()): MailCheckpoint {
  return { version: 1, emailAddress: null, windowDays, windowStart: windowStartFor(windowDays, now), backfill: { pageToken: null, pages: 0, complete: false, completedAt: null, oldestAt: null }, history: { historyId: null, pageToken: null, checkedAt: null }, lane: "backfill", rescans: 0, lastSuccessAt: null };
}
/** Widen or narrow the window. A wider window resumes backfill for the older range only. */
export function changeMailWindow(checkpoint: MailCheckpoint, windowDays: number, now = new Date()): MailCheckpoint {
  const windowStart = windowStartFor(windowDays, now);
  if (windowDays <= checkpoint.windowDays) return { ...checkpoint, windowDays, windowStart };
  return { ...checkpoint, windowDays, windowStart, backfill: { ...checkpoint.backfill, pageToken: null, pages: 0, complete: false, completedAt: null } };
}
export function mailCoverage(checkpoint: MailCheckpoint | null) {
  if (!checkpoint) return { from: null, to: null, partial: true, lastSuccessAt: null, rescans: 0 };
  return {
    from: checkpoint.backfill.complete ? checkpoint.windowStart : checkpoint.backfill.oldestAt ?? null,
    to: checkpoint.lastSuccessAt,
    partial: !checkpoint.backfill.complete,
    lastSuccessAt: checkpoint.lastSuccessAt,
    rescans: checkpoint.rescans,
  };
}
const searchResult = z.object({ messages: z.array(z.object({ id: z.string(), threadId: z.string().optional() })).max(500).default([]), nextPageToken: z.string().optional() }).passthrough();
const historyResult = z.object({
  historyId: z.string(), nextPageToken: z.string().optional(),
  history: z.array(z.object({
    messagesAdded: z.array(z.object({ message: z.object({ id: z.string(), threadId: z.string().optional(), labelIds: z.array(z.string()).optional() }).passthrough() })).optional(),
    messagesDeleted: z.array(z.object({ message: z.object({ id: z.string() }).passthrough() })).optional(),
    labelsAdded: z.array(z.object({ message: z.object({ id: z.string() }).passthrough(), labelIds: z.array(z.string()).optional() })).optional(),
    labelsRemoved: z.array(z.object({ message: z.object({ id: z.string() }).passthrough(), labelIds: z.array(z.string()).optional() })).optional(),
  }).passthrough()).optional(),
}).passthrough();
const unixSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** The mailbox's address and position, through `gmail__get_profile`. */
export async function mailProfile(hub: Hub, account: string | null) {
  return z.object({ emailAddress: z.string(), historyId: z.string() }).passthrough().parse(await hub.call(HUB_TOOLS.profile, {}, account));
}

/**
 * One bounded Gmail step. While the initial backfill runs, steps alternate
 * between current changes and older pages, so new mail is never stuck behind
 * history. An expired history checkpoint restarts a bounded rescan of the
 * configured window, never the whole mailbox.
 */
export async function gmailSyncStep(options: MailSyncOptions): Promise<MailStepResult> {
  const now = options.now ?? (() => new Date());
  const maxBodies = options.maxBodies ?? 10, maxMetadata = options.maxMetadata ?? 50, pageSize = options.pageSize ?? 50;
  const call = async <T>(tool: string, input: Record<string, unknown>, schema: z.ZodType<T, z.ZodTypeDef, unknown>) => schema.parse(await options.hub.call(tool, input, options.account));
  let checkpoint = options.checkpoint ? mailCheckpointSchema.parse(options.checkpoint) : newMailCheckpoint(options.windowDays, now());
  const result = { read: 0, skipped: 0, removed: 0, yielded: false };
  const budgetLeft = () => !options.hub.signal.aborted && Date.now() < options.deadline;

  // Capture the mailbox position before scanning, so mail that arrives during the scan is caught by history.
  if (!checkpoint.history.historyId) {
    const profile = await mailProfile(options.hub, options.account);
    checkpoint = { ...checkpoint, emailAddress: profile.emailAddress, history: { historyId: profile.historyId, pageToken: null, checkedAt: null } };
    return { checkpoint, more: true, lane: "profile", ...result };
  }
  const lane: "history" | "backfill" = checkpoint.backfill.complete ? "history" : checkpoint.lane === "history" ? "backfill" : "history";
  let bodies = 0, metadata = 0;

  // A message can be deleted after it was listed. Its fetch then reports 404:
  // record it as gone and keep going, so the page and its checkpoint still complete.
  const gone = (id: string, threadId: string) => { options.skip(id, threadId); options.removed(id); result.removed++; return true; };
  const read = async (tool: string, input: Record<string, unknown>) => {
    try {
      return await options.hub.call(tool, input, options.account);
    } catch (error) {
      if (failureKind(error) === "not_found") return null;
      throw error;
    }
  };
  const process = async (id: string, threadId: string, mode: "full" | "headers") => {
    if (options.seen(id)) return true;
    if (mode === "headers" && options.relevant) {
      if (metadata >= maxMetadata) return false;
      metadata++;
      const raw = await read(HUB_TOOLS.metadata, { messageId: id, format: "metadata" });
      if (raw === null) return gone(id, threadId);
      const headers = parseMetadata(raw);
      if (!options.relevant(headers)) { options.skip(id, threadId); result.skipped++; return true; }
    }
    if (bodies >= maxBodies || !budgetLeft()) return false;
    bodies++;
    const raw = await read(HUB_TOOLS.read, { messageId: id });
    if (raw === null) return gone(id, threadId);
    const message = parseGmailMessage(raw);
    await options.ingest(message);
    result.read++;
    if (!checkpoint.backfill.oldestAt || message.receivedAt < checkpoint.backfill.oldestAt)
      checkpoint = { ...checkpoint, backfill: { ...checkpoint.backfill, oldestAt: message.receivedAt } };
    return true;
  };

  if (lane === "history") {
    let page: z.infer<typeof historyResult>;
    try {
      page = await call(HUB_TOOLS.history, {
        startHistoryId: checkpoint.history.historyId,
        historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
        maxResults: 100,
        ...(checkpoint.history.pageToken ? { pageToken: checkpoint.history.pageToken } : {}),
      }, historyResult);
    } catch (error) {
      if (failureKind(error) === "not_found") {
        // History expired: rescan the configured window from a fresh checkpoint.
        const fresh = newMailCheckpoint(checkpoint.windowDays, now());
        return { checkpoint: { ...fresh, emailAddress: checkpoint.emailAddress, rescans: checkpoint.rescans + 1, lastSuccessAt: checkpoint.lastSuccessAt }, more: true, lane, ...result };
      }
      throw error;
    }
    let finished = true;
    for (const record of page.history ?? []) {
      for (const deleted of record.messagesDeleted ?? []) { options.removed(deleted.message.id); result.removed++; }
      for (const change of record.labelsAdded ?? []) {
        options.relabeled?.(change.message.id, change.labelIds ?? [], true);
        if ((change.labelIds ?? []).some((label) => label === "TRASH" || label === "SPAM")) { options.removed(change.message.id); result.removed++; }
      }
      for (const change of record.labelsRemoved ?? []) options.relabeled?.(change.message.id, change.labelIds ?? [], false);
      for (const added of record.messagesAdded ?? []) {
        if ((added.message.labelIds ?? []).some((label) => label === "DRAFT" || label === "SPAM" || label === "TRASH")) continue;
        if (!(await process(added.message.id, added.message.threadId ?? added.message.id, "headers"))) { finished = false; break; }
      }
      if (!finished) break;
    }
    if (!finished) {
      result.yielded = true;
      return { checkpoint: { ...checkpoint, lane }, more: true, lane, ...result };
    }
    const last = !page.nextPageToken;
    const at = now().toISOString();
    checkpoint = {
      ...checkpoint,
      lane,
      history: last ? { historyId: page.historyId, pageToken: null, checkedAt: at } : { ...checkpoint.history, pageToken: page.nextPageToken!, checkedAt: at },
      lastSuccessAt: at,
    };
    return { checkpoint, more: !last || !checkpoint.backfill.complete, lane, ...result };
  }

  const query = `(${options.query}) after:${unixSeconds(checkpoint.windowStart)}`;
  const page = await call(HUB_TOOLS.search, { query, maxResults: pageSize, ...(checkpoint.backfill.pageToken ? { pageToken: checkpoint.backfill.pageToken } : {}) }, searchResult);
  for (const message of page.messages) {
    if (!(await process(message.id, message.threadId ?? message.id, "full"))) {
      result.yielded = true;
      return { checkpoint: { ...checkpoint, lane }, more: true, lane, ...result };
    }
  }
  const at = now().toISOString();
  const complete = !page.nextPageToken;
  checkpoint = {
    ...checkpoint,
    lane,
    backfill: { ...checkpoint.backfill, pageToken: page.nextPageToken ?? null, pages: checkpoint.backfill.pages + 1, complete, completedAt: complete ? at : null },
    lastSuccessAt: at,
  };
  return { checkpoint, more: true, lane, ...result };
}

/**
 * One bounded step through the kit's mail capability, for a hub that offers
 * only that (search and plain text, like the kit's fixture source): one page
 * of matching mail in the window, with bodies. Once the window is read, later
 * steps search from the last scan. There is no history, so deleted mail isn't
 * noticed, and there are no attachments or invitations to read.
 */
export async function basicMailSyncStep(options: MailSyncOptions & { ctx: Context }): Promise<MailStepResult> {
  const now = options.now ?? (() => new Date());
  const started = now();
  let checkpoint = options.checkpoint ? mailCheckpointSchema.parse(options.checkpoint) : newMailCheckpoint(options.windowDays, started);
  const complete = checkpoint.backfill.complete;
  // An hour of overlap: the index skips anything already read.
  const after = complete && checkpoint.history.checkedAt ? new Date(Date.parse(checkpoint.history.checkedAt) - 3_600_000).toISOString() : checkpoint.windowStart;
  // No provider search syntax here: any hub's mail capability can answer this. Relevance is checked on the headers.
  const page = await connectors(options.ctx).mail().search({
    after, limit: options.maxBodies ?? 10, withBody: true,
    ...(checkpoint.backfill.pageToken ? { cursor: checkpoint.backfill.pageToken } : {}),
    ...(options.account && options.account !== DEFAULT_ACCOUNT ? { account: options.account } : {}),
  });
  let read = 0;
  let skipped = 0;
  for (const raw of page.messages) {
    if (options.seen(raw.id)) continue;
    const message = fromCapabilityMessage(raw, started);
    if (options.relevant && !options.relevant({ id: message.id, threadId: message.threadId, labelIds: message.labelIds, subject: message.subject, from: message.from, to: message.to, cc: message.cc, snippet: `${message.snippet} ${message.text.slice(0, 2000)}`, listId: null })) {
      options.skip(message.id, message.threadId);
      skipped++;
      continue;
    }
    await options.ingest(message);
    read++;
    if (!checkpoint.backfill.oldestAt || message.receivedAt < checkpoint.backfill.oldestAt) checkpoint = { ...checkpoint, backfill: { ...checkpoint.backfill, oldestAt: message.receivedAt } };
  }
  const at = now().toISOString();
  checkpoint = page.cursor
    ? { ...checkpoint, lane: "backfill", backfill: { ...checkpoint.backfill, pageToken: page.cursor, pages: checkpoint.backfill.pages + 1 }, lastSuccessAt: at }
    : { ...checkpoint, lane: "history", backfill: { ...checkpoint.backfill, pageToken: null, pages: checkpoint.backfill.pages + 1, complete: true, completedAt: checkpoint.backfill.completedAt ?? at }, history: { historyId: null, pageToken: null, checkedAt: started.toISOString() }, lastSuccessAt: at };
  return { checkpoint, more: !!page.cursor, lane: complete ? "history" : "backfill", read, skipped, removed: 0, yielded: false };
}

// ─── Calendar sync ───────────────────────────────────────────────────────────

export const calendarCheckpointSchema = z.object({
  version: z.literal(1),
  calendarId: z.string().min(1).max(1024),
  pastDays: z.number().int().min(0).max(3650),
  futureDays: z.number().int().min(1).max(3650),
  window: z.object({ from: z.string(), to: z.string() }).strict(),
  phase: z.enum(["full", "incremental"]),
  pageToken: z.string().max(4000).nullable(),
  syncToken: z.string().max(4000).nullable(),
  completedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  resets: z.number().int().min(0),
  timeZone: z.string().max(100).nullable(),
}).strict();
export type CalendarCheckpoint = z.infer<typeof calendarCheckpointSchema>;
const attendee = z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean().default(false), organizer: z.boolean().default(false), resource: z.boolean().default(false), optional: z.boolean().default(false), responseStatus: z.string().optional() }).passthrough();
export const calendarEventSchema = z.object({
  id: z.string(),
  iCalUID: z.string().optional(),
  summary: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  location: z.string().optional(),
  joinUrl: z.string().optional(),
  responseStatus: z.string().optional(),
  allDay: z.boolean().default(false),
  startTimeZone: z.string().optional(),
  endTimeZone: z.string().optional(),
  recurringEventId: z.string().optional(),
  originalStartTime: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).passthrough().optional(),
  organizer: z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean().default(false) }).passthrough().optional(),
  attendees: z.array(attendee).default([]),
  attendeesOmitted: z.boolean().default(false),
  description: z.string().optional(),
  eventType: z.string().optional(),
  updated: z.string().optional(),
  created: z.string().optional(),
  cancelled: z.boolean().default(false),
  transparency: z.string().optional(),
}).passthrough();
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
const syncPage = z.object({ events: z.array(calendarEventSchema).default([]), nextPageToken: z.string().optional(), nextSyncToken: z.string().optional(), calendarTimeZone: z.string().optional() }).passthrough();
export function newCalendarCheckpoint(calendarId: string, pastDays: number, futureDays: number, now = new Date()): CalendarCheckpoint {
  return {
    version: 1, calendarId, pastDays, futureDays,
    window: { from: new Date(now.getTime() - pastDays * 864e5).toISOString(), to: new Date(now.getTime() + futureDays * 864e5).toISOString() },
    phase: "full", pageToken: null, syncToken: null, completedAt: null, lastSuccessAt: null, resets: 0, timeZone: null,
  };
}
export function calendarCoverage(checkpoint: CalendarCheckpoint | null) {
  if (!checkpoint) return { from: null, to: null, partial: true, lastSuccessAt: null, resets: 0 };
  return { from: checkpoint.window.from, to: checkpoint.window.to, partial: !checkpoint.completedAt, lastSuccessAt: checkpoint.lastSuccessAt, resets: checkpoint.resets };
}
export interface CalendarStepResult { checkpoint: CalendarCheckpoint; more: boolean; events: number; cancelled: number }
/**
 * One bounded Calendar page. The full scan covers the window, then the sync
 * token returns only changes. A cancelled event is reported, not dropped. An
 * expired token (410) restarts the window. When half the future window has
 * passed, a fresh full scan moves it forward.
 */
export async function calendarSyncStep(options: {
  hub: Hub;
  account: string;
  checkpoint: CalendarCheckpoint;
  now?: () => Date;
  pageSize?: number;
  ingest(event: CalendarEvent): void | Promise<void>;
}): Promise<CalendarStepResult> {
  const now = options.now ?? (() => new Date());
  let checkpoint = calendarCheckpointSchema.parse(options.checkpoint);
  const halfway = Date.parse(checkpoint.window.to) - (checkpoint.futureDays * 864e5) / 2;
  if (checkpoint.phase === "incremental" && now().getTime() > halfway)
    checkpoint = { ...newCalendarCheckpoint(checkpoint.calendarId, checkpoint.pastDays, checkpoint.futureDays, now()), resets: checkpoint.resets, lastSuccessAt: checkpoint.lastSuccessAt, timeZone: checkpoint.timeZone };
  const input = checkpoint.phase === "full"
    ? { calendarId: checkpoint.calendarId, timeMin: checkpoint.window.from, timeMax: checkpoint.window.to, maxResults: options.pageSize ?? 250, ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}) }
    : { calendarId: checkpoint.calendarId, syncToken: checkpoint.syncToken!, maxResults: options.pageSize ?? 250, ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}) };
  let page: z.infer<typeof syncPage>;
  try {
    page = syncPage.parse(await options.hub.call(HUB_TOOLS.calendarSync, input, options.account));
  } catch (error) {
    if (failureKind(error) === "not_found" && checkpoint.phase === "incremental") {
      const fresh = newCalendarCheckpoint(checkpoint.calendarId, checkpoint.pastDays, checkpoint.futureDays, now());
      return { checkpoint: { ...fresh, resets: checkpoint.resets + 1, lastSuccessAt: checkpoint.lastSuccessAt, timeZone: checkpoint.timeZone }, more: true, events: 0, cancelled: 0 };
    }
    throw error;
  }
  let cancelled = 0;
  for (const event of page.events) {
    if (event.cancelled) cancelled++;
    await options.ingest(event);
  }
  const at = now().toISOString();
  const last = !page.nextPageToken;
  checkpoint = {
    ...checkpoint,
    timeZone: page.calendarTimeZone ?? checkpoint.timeZone,
    pageToken: last ? null : page.nextPageToken!,
    syncToken: last ? page.nextSyncToken ?? checkpoint.syncToken : checkpoint.syncToken,
    phase: last && (page.nextSyncToken || checkpoint.syncToken) ? "incremental" : checkpoint.phase,
    completedAt: last ? (checkpoint.completedAt ?? at) : checkpoint.completedAt,
    lastSuccessAt: at,
  };
  return { checkpoint, more: !last, events: page.events.length, cancelled };
}
/**
 * One Calendar page through the kit's calendar capability, for a hub that
 * offers only that: events in the window, re-read in full each time, since
 * there is no sync token. Cancelled events simply stop appearing.
 */
export async function basicCalendarSyncStep(options: { ctx: Context; account: string; checkpoint: CalendarCheckpoint; now?: () => Date; ingest(event: CalendarEvent): void | Promise<void> }): Promise<CalendarStepResult> {
  const now = options.now ?? (() => new Date());
  let checkpoint = calendarCheckpointSchema.parse(options.checkpoint);
  if (checkpoint.completedAt && !checkpoint.pageToken) checkpoint = { ...newCalendarCheckpoint(checkpoint.calendarId, checkpoint.pastDays, checkpoint.futureDays, now()), resets: checkpoint.resets, lastSuccessAt: checkpoint.lastSuccessAt, completedAt: checkpoint.completedAt, timeZone: checkpoint.timeZone };
  const page = await connectors(options.ctx).calendar().listEvents({
    from: checkpoint.window.from, to: checkpoint.window.to, calendarId: checkpoint.calendarId, limit: 250,
    ...(checkpoint.pageToken ? { cursor: checkpoint.pageToken } : {}),
    ...(options.account && options.account !== DEFAULT_ACCOUNT ? { account: options.account } : {}),
  });
  for (const event of page.events) await options.ingest(calendarEventSchema.parse({ id: event.id, summary: event.title, start: event.start, end: event.end, allDay: event.allDay, status: event.status, location: event.location, htmlLink: event.url, joinUrl: event.joinUrl, cancelled: event.status === "cancelled" }));
  const at = now().toISOString();
  checkpoint = { ...checkpoint, pageToken: page.cursor ?? null, completedAt: page.cursor ? checkpoint.completedAt : at, lastSuccessAt: at };
  return { checkpoint, more: !!page.cursor, events: page.events.length, cancelled: 0 };
}

export async function listCalendars(hub: Hub, account: string) {
  const result = z.object({ calendars: z.array(z.object({ id: z.string(), summary: z.string().optional(), primary: z.boolean().optional(), accessRole: z.string().optional(), hidden: z.boolean().optional() }).passthrough()) }).passthrough()
    .parse(await hub.call(HUB_TOOLS.calendars, {}, account));
  return result.calendars.filter((calendar) => !calendar.hidden).map((calendar) => ({ id: calendar.id, summary: calendar.summary ?? calendar.id, primary: !!calendar.primary, accessRole: calendar.accessRole ?? null }));
}

// ─── Source accounts and the message index ───────────────────────────────────

export type SourceKind = "mail" | "calendar";
export type SourceStatus = "not_started" | "importing" | "ready" | "paused" | "reconnect" | "error";
export interface SourceAccount {
  account: string;
  kind: SourceKind;
  createdAt: string;
  updatedAt: string;
  label: string | null;
  historyDays: number;
  /** Mail: Gmail checkpoint. Calendar: map of calendar ID to checkpoint. */
  checkpoint: unknown;
  calendars: string[];
  paused: boolean;
  status: SourceStatus;
  lastError: string | null;
  lastSuccessAt: string | null;
}
const accountRow = (row: Record<string, unknown>): SourceAccount => ({
  account: String(row.account),
  kind: String(row.kind) as SourceKind,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  label: row.label === null ? null : String(row.label),
  historyDays: Number(row.history_days),
  checkpoint: row.checkpoint === null ? null : JSON.parse(String(row.checkpoint)),
  calendars: JSON.parse(String(row.calendars)),
  paused: Number(row.paused) === 1,
  status: String(row.status) as SourceStatus,
  lastError: row.last_error === null ? null : String(row.last_error),
  lastSuccessAt: row.last_success_at === null ? null : String(row.last_success_at),
});
/**
 * Each account Travel reads through the hub: chosen history range,
 * calendars, pause state and the committed checkpoint. Saved with the
 * records it describes, so a restart resumes from the last committed page.
 */
export function createAccountStore(db: SqlDatabase) {
  const get = (account: string, kind: SourceKind) => {
    const row = db.prepare("SELECT * FROM app_source_accounts WHERE account = ? AND kind = ?").get(account, kind);
    return row ? accountRow(row) : null;
  };
  return {
    get,
    list(): SourceAccount[] {
      return db.prepare("SELECT * FROM app_source_accounts ORDER BY kind, created_at LIMIT 100").all().map(accountRow);
    },
    setup(input: { account: string; kind: SourceKind; historyDays: number; label?: string | null; calendars?: string[] }): SourceAccount {
      const time = nowIso(), existing = get(input.account, input.kind);
      if (existing) {
        db.prepare("UPDATE app_source_accounts SET history_days = ?, label = COALESCE(?, label), calendars = ?, updated_at = ? WHERE account = ? AND kind = ?")
          .run(input.historyDays, input.label ?? null, JSON.stringify(input.calendars ?? existing.calendars), time, input.account, input.kind);
      } else {
        db.prepare("INSERT INTO app_source_accounts (account, kind, created_at, updated_at, label, history_days, checkpoint, calendars, paused, status, last_error, last_success_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 'not_started', NULL, NULL)")
          .run(input.account, input.kind, time, time, input.label ?? null, input.historyDays, JSON.stringify(input.calendars ?? []));
      }
      return get(input.account, input.kind)!;
    },
    commit(account: string, kind: SourceKind, checkpoint: unknown, status: SourceStatus, label?: string | null) {
      const time = nowIso();
      db.prepare("UPDATE app_source_accounts SET checkpoint = ?, status = CASE WHEN paused = 1 THEN 'paused' ELSE ? END, last_error = NULL, last_success_at = ?, label = COALESCE(?, label), updated_at = ? WHERE account = ? AND kind = ?")
        .run(JSON.stringify(checkpoint), status, time, label ?? null, time, account, kind);
    },
    failed(account: string, kind: SourceKind, status: "error" | "reconnect", reason: string) {
      db.prepare("UPDATE app_source_accounts SET status = CASE WHEN paused = 1 THEN 'paused' ELSE ? END, last_error = ?, updated_at = ? WHERE account = ? AND kind = ?").run(status, reason.slice(0, 300), nowIso(), account, kind);
    },
    pause(account: string, paused: boolean) {
      db.prepare("UPDATE app_source_accounts SET paused = ?, status = CASE WHEN ? = 1 THEN 'paused' WHEN checkpoint IS NULL THEN 'not_started' ELSE 'ready' END, updated_at = ? WHERE account = ?").run(paused ? 1 : 0, paused ? 1 : 0, nowIso(), account);
    },
    remove(account: string) {
      db.prepare("DELETE FROM app_source_accounts WHERE account = ?").run(account);
    },
  };
}
export type AccountStore = ReturnType<typeof createAccountStore>;

/**
 * Every message an account has delivered, with its outcome. It makes repeated
 * delivery idempotent and lets a page be re-read after an interruption without
 * reading bodies again.
 */
export function createMailIndex(db: SqlDatabase) {
  return {
    seen(account: string, messageId: string): boolean {
      return !!db.prepare("SELECT 1 FROM app_mail_messages WHERE account = ? AND message_id = ?").get(account, messageId);
    },
    outcome(account: string, messageId: string): "kept" | "skipped" | "removed" | null {
      const row = db.prepare("SELECT outcome FROM app_mail_messages WHERE account = ? AND message_id = ?").get(account, messageId);
      return row ? (String(row.outcome) as "kept" | "skipped" | "removed") : null;
    },
    record(account: string, messageId: string, threadId: string, outcome: "kept" | "skipped" | "removed", details: { receivedAt?: string | null; digest?: string | null } = {}) {
      const time = nowIso();
      db.prepare(
        "INSERT INTO app_mail_messages (account, message_id, created_at, updated_at, thread_id, outcome, received_at, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account, message_id) DO UPDATE SET outcome = excluded.outcome, updated_at = excluded.updated_at, received_at = COALESCE(excluded.received_at, received_at), digest = COALESCE(excluded.digest, digest)",
      ).run(account, messageId, time, time, threadId, outcome, details.receivedAt ?? null, details.digest ?? null);
    },
    counts(account: string) {
      const result = { kept: 0, skipped: 0, removed: 0 };
      for (const row of db.prepare("SELECT outcome, COUNT(*) AS count FROM app_mail_messages WHERE account = ? GROUP BY outcome").all(account)) result[String(row.outcome) as keyof typeof result] = Number(row.count);
      return result;
    },
    forget(account: string) {
      transaction(db, () => db.prepare("DELETE FROM app_mail_messages WHERE account = ?").run(account));
    },
  };
}
export type MailIndex = ReturnType<typeof createMailIndex>;
