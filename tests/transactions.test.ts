/**
 * Travel's writes on the core's transaction(): each key multi-step write
 * commits whole or not at all. A temporary SQLite trigger refuses the last
 * write of each one, so everything it wrote before that must be undone,
 * including the view revision its triggers move and the search index. Then
 * the same write succeeds once the refusal is lifted.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fakeHub, gmailAccount, harness, owner, type FakeMail, type Harness } from "./helpers.js";
import * as fx from "../src/fixtures/messages.js";

afterEach(cleanup);

const mail = (message: fx.FixtureMessage): FakeMail => ({ id: message.id, subject: message.subject, from: message.from, receivedAt: message.receivedAt, text: message.text });
const asPaste = (message: fx.FixtureMessage) => `Subject: ${message.subject}\nFrom: ${message.from}\n\n${message.text}`;

/** Make SQLite refuse one write, as a full disk or a broken file would, until it's lifted. */
function refuse(h: Harness, name: string, write: string) {
  const t = h.travel();
  t.db.prepare(`CREATE TEMP TRIGGER ${name} ${write} BEGIN SELECT RAISE(ABORT, 'Injected failure'); END`).run();
  return () => { t.db.prepare(`DROP TRIGGER temp.${name}`).run(); };
}
/** Why a call failed, from the innermost error. */
const failure = (promise: Promise<unknown>) => promise.then(() => "succeeded", (error: unknown) => {
  let inner = error as { message?: string; cause?: unknown };
  while (inner?.cause) inner = inner.cause as typeof inner;
  return String(inner?.message ?? inner);
});
/** Everything a write could leave behind, including the view revision and the search index. */
function records(h: Harness): Record<string, number> {
  const t = h.travel();
  const count = (table: string) => Number(t.repo.get(`SELECT COUNT(*) AS count FROM ${table}`)!.count);
  return {
    revision: t.repo.dataRevision(),
    ...Object.fromEntries(["trips", "bookings", "segments", "stays", "evidence", "booking_sources", "booking_changes", "review_items", "bookings_fts", "travel_blobs", "app_mail_messages", "app_jobs", "app_source_accounts"].map((table) => [table, count(table)])),
  };
}
const continueMail = async (h: Harness, account: string) => (await h.call("continue_import", { source: `account:${account}`, kind: "mail" }, owner())).step;

describe("transactions", () => {
  it("joins a transaction inside another, so a later error undoes the inner writes, and refuses work that awaits", async () => {
    const h = await harness();
    const t = h.travel();
    expect(() => t.db.transaction(() => {
      t.mutate(() => t.settings.set({ homeZone: "Europe/Lisbon" }));
      throw new Error("A later step failed");
    })).toThrow("A later step failed");
    expect(t.settings.get().homeZone).toBeNull();
    // A statement outside any transaction commits on its own, as autocommit did.
    t.settings.set({ homeZone: "Europe/Lisbon" });
    expect(h.travel().settings.get().homeZone).toBe("Europe/Lisbon");
    // Work that waits on anything can't hold a transaction open, and what it wrote first is undone.
    expect(() => t.db.transaction(() => { t.settings.set({ homeZone: "Asia/Tokyo" }); return Promise.resolve(); })).toThrow(/must be synchronous/);
    expect(t.settings.get().homeZone).toBe("Europe/Lisbon");
  });

  it("adds a booking with its segments, search entry and history together, or none of them", async () => {
    const h = await harness();
    const trip = await h.call("save_trip", { title: "Porto", startDate: "2026-11-14", endDate: "2026-11-16", homeZone: "America/Denver" });
    const before = records(h);
    // The history entry is written after the booking, its segment and its search entry.
    const lift = refuse(h, "refuse_history", "BEFORE INSERT ON booking_changes");
    const input = { newId: crypto.randomUUID(), tripId: trip.record.id, draft: { kind: "train", title: "Lisbon to Porto", travelers: ["Alex Rivera"], segments: [{ number: "Alfa 123", originLabel: "Lisbon", destinationLabel: "Porto", startLocal: "2026-11-14T09:00", startZone: "Europe/Lisbon", endLocal: "2026-11-14T11:49", endZone: "Europe/Lisbon" }] } };
    expect(await failure(h.call("save_booking", input))).toBe("Injected failure");
    expect(records(h)).toEqual(before);
    lift();
    expect(await h.call("save_booking", input)).toMatchObject({ status: "saved", record: { id: input.newId, tripId: trip.record.id } });
    const after = records(h);
    expect(after).toMatchObject({ bookings: before.bookings + 1, segments: before.segments + 1, bookings_fts: before.bookings_fts + 1, booking_changes: before.booking_changes + 1 });
    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it("applies an import whole or not at all: its source, bookings, trip, Review and the preview's applied mark", async () => {
    const h = await harness();
    const preview = await h.call("preview_import", { kind: "paste", text: asPaste(fx.LISBON_FLIGHT) });
    const before = records(h);
    // Marking the preview applied is the last thing apply_import writes.
    const lift = refuse(h, "refuse_applied", "BEFORE UPDATE OF applied_at ON import_previews");
    expect(await failure(h.call("apply_import", { previewId: preview.previewId, digest: preview.digest }))).toBe("Injected failure");
    expect(records(h)).toEqual(before);
    expect(await h.call("list_trips", { limit: 50, when: "all" })).toMatchObject({ items: [] });
    lift();
    const applied = await h.call("apply_import", { previewId: preview.previewId, digest: preview.digest });
    expect(applied).toMatchObject({ status: "applied", outcomes: [{ action: "created" }] });
    expect(records(h)).toMatchObject({ trips: 1, bookings: 1, evidence: before.evidence + 1, bookings_fts: 1 });
  });

  it("commits a Gmail page's records with its checkpoint, so a page that fails at the checkpoint stores nothing and is read again", async () => {
    const account = gmailAccount([mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL)]);
    const hub = fakeHub({ gmail: { "acct-a": account } });
    const h = await harness({ hub });
    // The first steps find the mailbox's position and check new mail. The next reads the older mail's first page.
    expect((await continueMail(h, "acct-a")).summary).toBe("Found the mailbox position");
    expect((await continueMail(h, "acct-a")).summary).toBe("Checked new mail");
    const before = records(h);
    const checkpoint = h.travel().accounts.get("acct-a", "mail")!.checkpoint;
    const reads = () => hub.calls.filter((call) => call.name === "gmail__read_message").length;
    const read = reads();
    const lift = refuse(h, "refuse_checkpoint", "BEFORE UPDATE OF checkpoint ON app_source_accounts");
    const failed = await continueMail(h, "acct-a");
    expect(failed.summary).toBe("Injected failure");
    expect(reads()).toBe(read + 2);
    // The messages were read, matched and stored, then all undone with the checkpoint. The step's failure is recorded.
    expect(records(h)).toEqual(before);
    expect(h.travel().accounts.get("acct-a", "mail")).toMatchObject({ checkpoint, status: "error", lastError: "Injected failure" });
    expect(h.travel().mailIndex.counts("acct-a")).toEqual({ kept: 0, skipped: 0, removed: 0 });
    lift();
    while ((await continueMail(h, "acct-a")).more);
    const bookings = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items as { title: string }[];
    expect(bookings.map((booking) => booking.title).sort()).toEqual(["Flight RA 204", "Riverside House"]);
    expect(h.travel().mailIndex.counts("acct-a")).toEqual({ kept: 2, skipped: 0, removed: 0 });
  });

  it("deletes an account's data whole or not at all, keeping its bookings, search entries and checkpoint when the last step fails", async () => {
    const account = gmailAccount([mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL)]);
    const h = await harness({ hub: fakeHub({ gmail: { "acct-a": account } }) });
    while ((await continueMail(h, "acct-a")).more);
    const before = records(h);
    expect(before.bookings).toBe(2);
    const checkpoint = h.travel().accounts.get("acct-a", "mail")!.checkpoint;
    // Marking the account deleted is the last thing delete_source_data writes.
    const lift = refuse(h, "refuse_deleted", "BEFORE UPDATE OF status ON app_source_accounts WHEN NEW.status = 'deleted'");
    expect(await failure(h.call("delete_source_data", { source: "account:acct-a" }))).toBe("Injected failure");
    expect(records(h)).toEqual(before);
    expect(h.travel().accounts.get("acct-a", "mail")).toMatchObject({ checkpoint, paused: false, status: "ready" });
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all", query: "Riverside" })).items).toHaveLength(1);
    lift();
    expect(await h.call("delete_source_data", { source: "account:acct-a" })).toMatchObject({ status: "deleted", bookings: 2 });
    expect(records(h)).toMatchObject({ bookings: 0, evidence: 0, bookings_fts: 0, app_mail_messages: 0 });
    expect(h.travel().accounts.get("acct-a", "mail")).toMatchObject({ paused: true, status: "deleted" });
  });
});
