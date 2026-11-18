/**
 * Travel against the kit's own fixture source (`fixtureSource`, what
 * APP_CONNECTORS=fixtures serves), with the kit's real job runner. The
 * fixture source offers the kit's mail and calendar capabilities, so Travel
 * reads through those adapters here; tests/sync.test.ts covers Ri's fuller
 * Gmail and Calendar tools. All data is fictional.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureSource, jobStatus, runDueJobs, runJobNow, type ConnectorFixtures, type Context } from "@app-builder/core";
import { application } from "../src/app.js";
import { failureKind, hubFor, providerStatus } from "../src/lib/sources.js";
import { cleanup, harness, owner } from "./helpers.js";

afterEach(cleanup);
const fixtures = (): ConnectorFixtures => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/connectors.json"), "utf8"));
const status = async (h: Awaited<ReturnType<typeof harness>>, name: string, now?: number) =>
  (await jobStatus(application, h.platform, now ? { now: () => now } : {})).jobs.find((job: { name: string }) => job.name === name)!.lastRun;

describe("the kit's fixture source", () => {
  it("imports confirmations and calendar events through the kit's mail and calendar capabilities, on the kit's job runner", async () => {
    const h = await harness({ hub: fixtureSource(fixtures()) });
    const run = await runJobNow(application, h.platform, "sync_sources");
    await run.done;
    expect((await status(h, "sync_sources"))).toMatchObject({ status: "succeeded" });
    const bookings = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items.map((booking: { title: string }) => booking.title).sort();
    expect(bookings).toEqual(["Alder Street Inn", "Dinner at Mesa", "Flight RA 204", "Riverside House", "Train Coast Line 11"]);
    // The newsletter was read and dropped, never kept.
    const t = h.travel();
    expect(t.repo.evidenceByExternal("account:alex.rivera@example.test", "fx-newsletter")).toBeNull();
    const sources = await h.call("list_sources", {}, owner());
    expect(sources.accounts.map((account: { id: string; status: string }) => [account.id, account.status]).sort()).toEqual([["calendar:default", "ready"], ["mail:alex.rivera@example.test", "ready"]]);
    const lisbon = (await h.call("list_trips", { limit: 50, when: "all" })).items.find((trip: { title: string }) => trip.title === "Lisbon");
    const detail = await h.call("get_trip", { id: lisbon.id });
    expect(detail.calendar.events.map((event: { summary: string; relation: string }) => [event.summary, event.relation])).toEqual([["Flight RA 204 to Lisbon", "matches_booking"], ["Quarterly planning", "during_trip"]]);
    // A second run reads nothing twice.
    await (await runJobNow(application, h.platform, "sync_sources")).done;
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(5);
  });

  it("reads a PDF through Ri's extract_text tool", async () => {
    const h = await harness({ hub: fixtureSource(fixtures()) });
    const preview = await h.call("preview_import", { kind: "file", fileName: "riverside.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-fictional").toString("base64") });
    expect(preview.items[0].draft).toMatchObject({ kind: "lodging", reference: "RH-4821", stay: { checkInDate: "2026-11-10", checkOutDate: "2026-11-14" } });
  });

  it("keeps a follow-up waiting for approval in Ri across the kit's runner, then creates it once approved", async () => {
    const data = fixtures();
    const h = await harness({ hub: fixtureSource(data) });
    const trip = await h.call("save_trip", { title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14" });
    const waiting = await h.call("create_follow_up", { subject: { type: "trip", id: trip.record.id }, title: "Book the airport transfer" });
    expect(waiting).toMatchObject({ status: "pending", followUp: { state: "pending" } });
    // The job's run waits for the person, as the kit runs it.
    const start = Date.now();
    await (await runJobNow(application, h.platform, "follow_ups", { now: () => start })).done;
    expect(await status(h, "follow_ups", start)).toMatchObject({ status: "waiting", approval: { tool: "ri__create_task" } });
    // Approved in Ri: the runner checks the grant again and repeats the identical call (every 5 minutes for the first hour).
    data.tools!.ri__create_task = { result: { id: "task-approved", title: "Book the airport transfer" } };
    await runDueJobs(application, h.platform, { now: () => start + 6 * 60_000 });
    expect(await status(h, "follow_ups", start + 6 * 60_000)).toMatchObject({ status: "succeeded" });
    expect((await h.call("list_follow_ups", { limit: 50 })).items[0]).toMatchObject({ state: "created", taskId: "task-approved" });
  });

  it("stops asking when the person declines the task in Ri", async () => {
    const data = fixtures();
    data.tools!.ri__create_task = { approval: "denied" } as never;
    const h = await harness({ hub: fixtureSource(data) });
    const trip = await h.call("save_trip", { title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14" });
    const declined = await h.call("create_follow_up", { subject: { type: "trip", id: trip.record.id }, title: "Book the airport transfer" });
    expect(declined).toMatchObject({ status: "failed", followUp: { state: "failed" }, message: "You declined this task in Ri, so Travel won't ask again. Create the follow-up again if you change your mind." });
    // The job doesn't repeat a declined call.
    await (await runJobNow(application, h.platform, "follow_ups")).done;
    expect(await status(h, "follow_ups")).toMatchObject({ status: "succeeded", result: { created: 0, waiting: 0 } });
  });

  it("names the accounts Ri lent from its account list, without asking an account", async () => {
    const data = fixtures();
    data.accounts = [
      { id: "acc_000000000000000000000001", name: "alex.rivera@example.test", provider: "google", tools: ["gmail__get_profile", "gmail__search_messages", "gmail__get_message", "google_calendar__list_events"] },
      { id: "acc_000000000000000000000002", name: "alex@work.example.test", provider: "google", tools: ["gmail__search_messages", "gmail__get_message"] },
    ];
    const source = fixtureSource(data);
    const called: string[] = [];
    const h = await harness({ hub: { ...source, callTool: (name, args, meta) => { called.push(name); return source.callTool(name, args, meta); } } });
    const found = await h.call("check_accounts", {});
    expect(found.accounts.map((account: { id: string }) => account.id).sort()).toEqual(["calendar:default", "mail:alex.rivera@example.test", "mail:alex@work.example.test"]);
    // Two mail accounts: Ri's list names them. Nothing was read from either mailbox to find them.
    expect(called).toEqual(["ri__list_accounts"]);
  });

  it("takes the accounts Ri names when a hub without the list asks Travel to choose", async () => {
    const data = fixtures();
    data.tools!.gmail__get_profile = { result: { status: "choose_account", accounts: ["alex.rivera@example.test", "alex@work.example.test"], message: "Multiple accounts are connected. Ask the user which one, then retry with the `account` field set to that exact value." } };
    const h = await harness({ hub: fixtureSource(data) });
    const found = await h.call("check_accounts", {});
    expect(found.accounts.map((account: { id: string }) => account.id).filter((id: string) => id.startsWith("mail:")).sort()).toEqual(["mail:alex.rivera@example.test", "mail:alex@work.example.test"]);
  });

  it("asks the person to reconnect an account Ri says must sign in again, keeping its records", async () => {
    // Ri sends authorization_required as a result, not an error; the core makes it a setup state.
    const data: ConnectorFixtures = { tools: {
      gmail__get_profile: { result: { emailAddress: "alex.rivera@example.test", historyId: "1" } },
      gmail__search_messages: { result: { status: "authorization_required", provider: "gmail", message: "This needs a connected gmail account. The app is prompting the user to authorize, tell them to complete it, then retry." } },
      gmail__get_message: { result: {} },
    } };
    const h = await harness({ hub: fixtureSource(data) });
    await h.call("save_trip", { title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14" });
    const { step } = await h.call("continue_import", { source: "account:alex.rivera@example.test", kind: "mail" }, owner());
    expect(step).toMatchObject({ summary: "Reconnect this account in Ri to continue updates. Records already imported are kept." });
    expect((await h.call("list_sources", {}, owner())).accounts.find((account: { id: string }) => account.id === "mail:alex.rivera@example.test")).toMatchObject({ status: "reconnect" });
    expect((await h.call("list_trips", { limit: 50, when: "all" })).items).toHaveLength(1);
  });

  it("reads a provider's 404 or 410 from the code and status Ri sends, as the kit's client passes them on", async () => {
    const data = fixtures();
    // Answers by arguments: only the deleted message, the expired sync token and the deleted task fail.
    data.tools!.gmail__read_message = { cases: [
      { args: { messageId: "fx-deleted" }, error: { code: "not_found", message: "The provider couldn't find that.", httpStatus: 404 } },
      { args: { messageId: "fx-flight-lisbon" }, result: { id: "fx-flight-lisbon" } },
    ] };
    data.tools!.google_calendar__sync_events = { cases: [
      { args: { syncToken: "sync-expired" }, error: { code: "not_found", message: "That's no longer available at the provider.", httpStatus: 410 } },
      { args: { syncToken: "sync-1" }, result: { events: [], nextSyncToken: "sync-2" } },
    ] };
    data.tools!.ri__get_task = { ...data.tools!.ri__get_task, cases: [{ args: { id: "task-deleted" }, error: { code: "not_found", message: "That task doesn't exist." } }] };
    const h = await harness({ hub: fixtureSource(data) });
    const hub = hubFor({ platform: h.platform } as Context);
    const failure = (tool: string, args: Record<string, unknown>) => hub.call(tool, args).then(() => null, (error: unknown) => error);
    try {
      expect(providerStatus(await failure("gmail__read_message", { messageId: "fx-deleted" }))).toBe(404);
      expect(await hub.call("gmail__read_message", { messageId: "fx-flight-lisbon" })).toEqual({ id: "fx-flight-lisbon" });
      expect(providerStatus(await failure("google_calendar__sync_events", { syncToken: "sync-expired" }))).toBe(410);
      expect(await hub.call("google_calendar__sync_events", { syncToken: "sync-1" })).toEqual({ events: [], nextSyncToken: "sync-2" });
      // A Ri record that no longer exists has no provider status, and is still not_found. Others still answer.
      const task = await failure("ri__get_task", { id: "task-deleted" });
      expect(providerStatus(task)).toBeNull();
      expect(failureKind(task)).toBe("not_found");
      expect(await hub.call("ri__get_task", { id: "fx-task-1" })).toEqual({ id: "fx-task-1", title: "Fictional task" });
      // A call no case answers fails, naming its arguments, rather than borrowing another's answer.
      expect(String(await failure("gmail__read_message", { messageId: "fx-unknown" }))).toContain('"messageId":"fx-unknown"');
    } finally { await hub.close(); }
  });

  it("marks a linked Ri task missing when Ri answers not_found", async () => {
    const data = fixtures();
    data.tools!.ri__create_task = { result: { id: "task-1", title: "Book the airport transfer" } };
    // Only the task this follow-up created is gone.
    data.tools!.ri__get_task = { ...data.tools!.ri__get_task, cases: [{ args: { id: "task-1" }, error: { code: "not_found", message: "That task doesn't exist." } }] };
    const h = await harness({ hub: fixtureSource(data) });
    const trip = await h.call("save_trip", { title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14" });
    const created = await h.call("create_follow_up", { subject: { type: "trip", id: trip.record.id }, title: "Book the airport transfer" });
    expect(created).toMatchObject({ status: "created", followUp: { taskId: "task-1" } });
    expect((await h.call("check_follow_up", { id: created.followUp.id })).availability).toBe("missing");
  });

  it("retries when Ri is down, keeping where each account was, and fails the run when the connection was revoked", async () => {
    const data = fixtures();
    const h = await harness({ hub: fixtureSource(data) });
    await (await runJobNow(application, h.platform, "sync_sources")).done;
    const t = h.travel();
    const checkpoint = JSON.stringify(t.accounts.get("alex.rivera@example.test", "mail")!.checkpoint);
    data.unavailable = true;
    const start = Date.now();
    await (await runJobNow(application, h.platform, "sync_sources", { now: () => start })).done;
    expect(await status(h, "sync_sources", start)).toMatchObject({ status: "retrying" });
    expect(JSON.stringify(t.accounts.get("alex.rivera@example.test", "mail")!.checkpoint)).toBe(checkpoint);
    data.unavailable = false;
    data.revoked = true;
    await runDueJobs(application, h.platform, { now: () => start + 10 * 60_000 });
    expect(await status(h, "sync_sources", start + 10 * 60_000)).toMatchObject({ status: "failed", error: "Ri needs you to connect this app again. Open Settings and reconnect." });
    // Records stay readable.
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(5);
  });
});
