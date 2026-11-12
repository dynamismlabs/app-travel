/**
 * Test harness: Travel's real application over a disposable data directory,
 * called through the kit's own action router as the person's browser, an
 * assistant connection or the app's job, with a fake hub. All data is
 * fictional.
 *
 * The fake hub is a ConnectorSource (the kit's interface for where connector
 * calls go), answering with Ri's hub tool names and shapes and failing the way
 * the kit's hub client does: SetupRequired for a disconnected hub, a tool Ri
 * didn't allow or several accounts to choose from, SourceUnavailable when Ri
 * is busy, ApprovalPending for a write waiting in Ri, and Ri's own text for a
 * provider's 404 or 410. tests/hub.test.ts also runs Travel on the kit's own
 * fixture source.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ApprovalPending, createActionRouter, SetupRequired, SourceUnavailable, type ConnectorSource, type Context, type Platform } from "@app-builder/core";
import { openNodePlatform } from "@app-builder/core/node";
import { application } from "../src/app.js";
import { closeTravelDatabases } from "../src/db/connection.js";
import { AppError } from "../src/lib/data.js";
import { setTravelClock, travelFor, type Travel } from "../src/services/core.js";

const created: { dir: string; close(): void }[] = [];

export interface Caller {
  kind: "owner" | "chat" | "job";
  audience: "user" | "agent";
  connection?: NonNullable<Context["connection"]>;
  job?: string;
}
/** The person's own browser: sees everything. */
export const owner = (): Caller => ({ kind: "owner", audience: "user" });
/** An assistant connection with the sources and write choice made on the consent screen (null sources: everything). */
export const chat = (id: string, sources: string[] | null, write = false): Caller => ({
  kind: "chat", audience: "agent", connection: { clientId: id, name: `Assistant ${id}`, sources, write, collections: false },
});
/** One of the app's declared jobs. */
export const job = (name = "sync_sources"): Caller => ({ kind: "job", audience: "user", job: name });

export interface Harness {
  dir: string;
  platform: Platform;
  /** Set the clock for trip dates in subsequent calls. */
  setNow(iso: string): void;
  call<T = any>(action: string, input: unknown, caller?: Caller): Promise<T>;
  /** Replace the hub (null: Travel isn't connected to Ri). */
  setHub(hub: ConnectorSource | null): void;
  travel(): Promise<Travel>;
}

const NOT_CONNECTED: ConnectorSource = {
  kind: "fixtures",
  async listTools() { throw new SetupRequired("Connect this app to Ri in Settings to use your accounts."); },
  async callTool() { throw new SetupRequired("Connect this app to Ri in Settings to use your accounts."); },
};

const CODES: Record<string, AppError["code"]> = { NOT_FOUND: "not_found", FORBIDDEN: "forbidden", BAD_REQUEST: "invalid_input", CONFLICT: "conflict", SERVICE_UNAVAILABLE: "busy" };

export async function harness(options: { now?: string; hub?: ConnectorSource | null } = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-test-"));
  const opened = await openNodePlatform(application, { dataDir: dir, localOwner: true, baseURL: "http://127.0.0.1:4334" });
  created.push({ dir, close: () => { closeTravelDatabases(path.join(dir, "data.sqlite")); opened.close(); } });
  let now = options.now ? new Date(options.now) : new Date("2026-10-15T12:00:00.000Z");
  setTravelClock(opened.platform, () => now);
  opened.platform.connectors = options.hub === undefined ? NOT_CONNECTED : options.hub ?? NOT_CONNECTED;
  const viewer = { id: "local-owner", name: "You", email: "owner@localhost" };
  const h: Harness = {
    dir, platform: opened.platform,
    setNow(iso) { now = new Date(iso); },
    setHub(hub) { opened.platform.connectors = hub ?? NOT_CONNECTED; },
    travel: () => travelFor({ platform: opened.platform }),
    async call(name, input, caller = owner()) {
      const ctx: Context = {
        platform: opened.platform, viewer, request: new Request("http://127.0.0.1:4334/api/trpc/run"),
        ...(caller.connection ? { connection: caller.connection } : {}),
        ...(caller.job ? { job: { name: caller.job, runId: `${caller.job}@test-${randomUUID()}`, scheduledFor: now.toISOString(), attempt: 1, checkpoint: undefined, saveCheckpoint: async () => {} } } : {}),
      };
      const action = application.actions.find((item) => item.name === name);
      if (!action) throw new Error(`Unknown action ${name}`);
      const router = createActionRouter(application, caller.audience).createCaller(ctx);
      try {
        // The kit's job runner calls the action itself, so its hub errors (ApprovalPending and the rest) reach the runner as they are.
        if (caller.kind === "job") return await action.execute(ctx, input) as never;
        return (action.effect === "read" ? await router.read({ name, input }) : await router.run({ name, input })) as never;
      } catch (error) {
        // Tests compare Travel's own error codes.
        if (error instanceof TRPCError) {
          if (error.cause instanceof AppError) throw error.cause;
          if (CODES[error.code]) throw new AppError(CODES[error.code], error.message);
        }
        throw error;
      }
    },
  };
  return h;
}

export function cleanup() {
  for (const item of created.splice(0)) { item.close(); fs.rmSync(item.dir, { recursive: true, force: true }); }
}

// ─── Fake Gmail, Calendar and Ri through the hub ────────────────────────────

export interface FakeMail { id: string; threadId?: string; subject: string; from: string; to?: string; receivedAt: string; text?: string; html?: string; labelIds?: string[]; attachments?: { attachmentId: string; filename: string; mimeType: string; data: string }[]; ics?: string }
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
/** A message in Gmail's full format, as Ri's `gmail__read_message` returns it. */
export function gmailMessage(mail: FakeMail) {
  const headers = [{ name: "From", value: mail.from }, { name: "To", value: mail.to ?? "alex.rivera@example.test" }, { name: "Subject", value: mail.subject }, { name: "Message-ID", value: `<${mail.id}@mail.example>` }];
  const parts: unknown[] = [];
  if (mail.text !== undefined) parts.push({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }], body: { data: b64(mail.text) } });
  if (mail.html !== undefined) parts.push({ mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: { data: b64(mail.html) } });
  if (mail.ics) parts.push({ mimeType: "text/calendar", body: { data: b64(mail.ics) } });
  for (const attachment of mail.attachments ?? []) parts.push({ mimeType: attachment.mimeType, filename: attachment.filename, body: { attachmentId: attachment.attachmentId, size: attachment.data.length } });
  return { id: mail.id, threadId: mail.threadId ?? `t-${mail.id}`, historyId: "1", internalDate: String(Date.parse(mail.receivedAt)), labelIds: mail.labelIds ?? ["INBOX"], snippet: (mail.text ?? "").slice(0, 120), payload: { mimeType: "multipart/mixed", headers, parts } };
}

export interface GmailAccount {
  messages: Map<string, FakeMail>;
  /** Backfill pages of message IDs. */
  pages: string[][];
  /** History records returned in order, one page each. */
  history: Record<string, unknown>[][];
  historyId: number;
  expireHistory?: boolean;
  failNextRead?: string;
  revoked?: boolean;
}
export function gmailAccount(mails: FakeMail[], pageSize = 50): GmailAccount {
  const messages = new Map(mails.map((mail) => [mail.id, mail]));
  const ids = mails.map((mail) => mail.id);
  const pages: string[][] = [];
  for (let index = 0; index < ids.length; index += pageSize) pages.push(ids.slice(index, index + pageSize));
  return { messages, pages: pages.length ? pages : [[]], history: [], historyId: 100 };
}

export interface FakeHubOptions {
  /** Gmail accounts by the name Ri shows for them (their address). */
  gmail?: Record<string, GmailAccount>;
  calendars?: Record<string, { calendars: { id: string; summary: string; primary?: boolean }[]; events: Record<string, unknown>[]; expireSync?: boolean }>;
  tasks?: Map<string, { id: string; title: string }>;
  /** Ri services the person allowed Travel (default: tasks, files and the model). */
  services?: ("create_task" | "get_task" | "ai_text" | "extract_text" | "attachments")[];
  /** Answer task creation as Ri does before the person approves. */
  approveTasks?: boolean;
  ai?: (prompt: string) => string | Error;
  extract?: (input: { fileName: string; mimeType: string; base64: string }) => { text: string; truncated: boolean; characters: number } | Error;
  /** The whole hub is down or the connection was revoked. */
  unavailable?: boolean;
  revoked?: boolean;
}
export interface FakeHub extends ConnectorSource {
  calls: { name: string; input: Record<string, unknown>; account?: string }[];
  options: FakeHubOptions;
}
const provider404 = (path: string) => new Error(`provider error 404 for GET ${path}`);
const provider410 = (path: string) => new Error(`provider error 410 for GET ${path}`);

/** Ri's hub as the kit's connector client presents it to Travel. */
export function fakeHub(options: FakeHubOptions = {}): FakeHub {
  const calls: FakeHub["calls"] = [];
  const tasks = options.tasks ?? new Map();
  const services = options.services ?? ["create_task", "get_task", "ai_text", "extract_text", "attachments"];
  const check = () => {
    if (options.unavailable) throw new SourceUnavailable("Ri had a problem (503). Trying again later.");
    if (options.revoked) throw new SetupRequired("Ri needs you to connect this app again. Open Settings and reconnect.");
  };
  /** With one account Ri names none; with several, a call must say which. */
  const pick = <T>(accounts: Record<string, T> | undefined, account: string | undefined, tool: string): [string, T] => {
    const names = Object.keys(accounts ?? {});
    if (!names.length) throw new Error(`MCP error -32602: Tool ${tool} not found`);
    if (!account) {
      if (names.length > 1) throw new SetupRequired(`Choose which account to use (${names.join(", ")}). Multiple accounts are connected. Ask the user which one, then retry with the \`account\` field set to that exact value.`);
      return [names[0], accounts![names[0]]];
    }
    if (!(account in accounts!)) throw new SetupRequired("Ri doesn't allow this app to do that. Check its access in Ri.");
    return [account, accounts![account]];
  };
  const hub: FakeHub = {
    kind: "fixtures", calls, options,
    async listTools() {
      check();
      return [
        ...(options.gmail && Object.keys(options.gmail).length ? ["gmail__get_profile", "gmail__list_history", "gmail__search_messages", "gmail__get_message", "gmail__read_message", ...(services.includes("attachments") ? ["gmail__get_attachment"] : [])] : []),
        ...(options.calendars && Object.keys(options.calendars).length ? ["google_calendar__list_calendars", "google_calendar__sync_events", "google_calendar__list_events"] : []),
        ...services.filter((name) => name !== "attachments").map((name) => `ri__${name}`),
      ];
    },
    async callTool(name, raw) {
      check();
      const { account: requested, ...input } = raw as Record<string, unknown> & { account?: string };
      calls.push({ name, input, account: requested });
      if (name.startsWith("gmail__")) {
        const [account, box] = pick(options.gmail, requested, name);
        // Ri answers an account that must sign in again with a status, not an error.
        if (box.revoked) return { status: "authorization_required", provider: "gmail", message: "This needs a connected gmail account. The app is prompting the user to authorize, tell them to complete it, then retry." };
        if (name === "gmail__get_profile") return { emailAddress: account, historyId: String(box.historyId) };
        if (name === "gmail__search_messages") {
          const index = input.pageToken ? Number(String(input.pageToken).slice(1)) : 0;
          const page = box.pages[index] ?? [];
          return { messages: page.map((id) => ({ id, threadId: box.messages.get(id)?.threadId ?? `t-${id}` })), ...(index + 1 < box.pages.length ? { nextPageToken: `p${index + 1}` } : {}) };
        }
        if (name === "gmail__list_history") {
          if (box.expireHistory) { box.expireHistory = false; throw provider404("/gmail/v1/users/me/history"); }
          const records = box.history.shift() ?? [];
          return { historyId: String(++box.historyId), history: records };
        }
        if (name === "gmail__get_message") {
          const mail = box.messages.get(String(input.messageId));
          if (!mail) throw provider404(`/gmail/v1/users/me/messages/${String(input.messageId)}`);
          return { id: mail.id, threadId: mail.threadId ?? `t-${mail.id}`, labelIds: mail.labelIds ?? ["INBOX"], snippet: (mail.text ?? "").slice(0, 160), headers: { Subject: mail.subject, From: mail.from } };
        }
        if (name === "gmail__read_message") {
          if (box.failNextRead === input.messageId) { box.failNextRead = undefined; throw new SourceUnavailable("Ri had a problem (504). Trying again later."); }
          const mail = box.messages.get(String(input.messageId));
          if (!mail) throw provider404(`/gmail/v1/users/me/messages/${String(input.messageId)}`);
          return gmailMessage(mail);
        }
        if (name === "gmail__get_attachment") {
          if (!services.includes("attachments")) throw new Error(`MCP error -32602: Tool ${name} not found`);
          const mail = box.messages.get(String(input.messageId));
          const attachment = mail?.attachments?.find((item) => item.attachmentId === input.attachmentId);
          if (!attachment) throw provider404("/gmail/v1/users/me/messages/attachments");
          return { data: Buffer.from(attachment.data, "utf8").toString("base64url"), size: attachment.data.length };
        }
      }
      if (name.startsWith("google_calendar__")) {
        const [, box] = pick(options.calendars, requested, name);
        if (name === "google_calendar__list_calendars") return { calendars: box.calendars };
        if (name === "google_calendar__sync_events") {
          if (input.syncToken && box.expireSync) { box.expireSync = false; throw provider410("/calendar/v3/calendars/primary/events"); }
          if (input.syncToken) return { events: [], nextSyncToken: "sync-2" };
          return { events: box.events, nextSyncToken: "sync-1", calendarTimeZone: "America/Denver" };
        }
      }
      if (name.startsWith("ri__") && !services.includes(name.slice(4) as never)) throw new Error(`MCP error -32602: Tool ${name} not found`);
      if (name === "ri__create_task") {
        if (options.approveTasks === false) throw new ApprovalPending({ id: "approval-1", tool: name, description: "ri create task. This action needs the user's approval." });
        const key = String(input.operationId);
        if (!tasks.has(key)) tasks.set(key, { id: `task-${tasks.size + 1}`, title: String(input.title) });
        return { ...tasks.get(key)!, status: "todo" };
      }
      if (name === "ri__get_task") {
        const found = [...tasks.values()].find((task) => task.id === input.id);
        if (!found) throw new Error("That Ri record is no longer available");
        return found;
      }
      if (name === "ri__ai_text") {
        if (!options.ai) throw new Error("Ri's model service for apps needs the Claude subscription harness");
        const reply = options.ai(String(input.prompt));
        if (reply instanceof Error) throw reply;
        return { text: reply };
      }
      if (name === "ri__extract_text") {
        if (!options.extract) throw new Error("This file could not be read. Enter the details by hand instead");
        const reply = options.extract(input as never);
        if (reply instanceof Error) throw reply;
        return reply;
      }
      throw new Error(`MCP error -32602: Tool ${name} not found`);
    },
  };
  return hub;
}
