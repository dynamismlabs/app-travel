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
import { fixtureSource, jobStatus, runDueJobs, runJobNow, type ConnectorFixtures } from "@app-builder/core";
import { application } from "../src/app.js";
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
    const t = await h.travel();
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
    // Approved in Ri: the runner checks the grant again and repeats the identical call.
    data.tools!.ri__create_task = { result: { id: "task-approved", title: "Book the airport transfer" } };
    await runDueJobs(application, h.platform, { now: () => start + 3 * 60_000 });
    expect(await status(h, "follow_ups", start + 3 * 60_000)).toMatchObject({ status: "succeeded" });
    expect((await h.call("list_follow_ups", { limit: 50 })).items[0]).toMatchObject({ state: "created", taskId: "task-approved" });
  });

  it("retries when Ri is down, keeping where each account was, and fails the run when the connection was revoked", async () => {
    const data = fixtures();
    const h = await harness({ hub: fixtureSource(data) });
    await (await runJobNow(application, h.platform, "sync_sources")).done;
    const t = await h.travel();
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
