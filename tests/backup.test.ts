/**
 * Backups and restores, with the code behind the kit's `backup` and `restore`
 * commands. Travel's view revision is a counter its triggers move on every
 * change to a record, and its booking search is a full-text index, so a
 * restored Travel must keep both: an edit after the restore still moves the
 * revision, and search still finds what it found. Core 0.2.2 and earlier left
 * triggers out of backups and couldn't restore the index's internal tables.
 * All data is fictional.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { coreMigrations } from "@app-builder/core";
import { backupNode, restoreNode } from "@app-builder/core/node";
import { application } from "../src/app.js";
import { seedPreview } from "../src/fixtures/preview.js";
import { cleanup, harness, type Harness } from "./helpers.js";

const scratch: string[] = [];
afterEach(() => {
  cleanup();
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const folder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-backup-"));
  scratch.push(dir);
  return dir;
};

/** What a restore must keep: the triggers and views, the revision, and what search finds. */
async function observe(h: Harness) {
  const t = h.travel();
  const schema = t.db.prepare("SELECT type, name FROM sqlite_schema WHERE type IN ('trigger', 'view') ORDER BY name").all().map((row) => `${row.type}:${row.name}`);
  const trips = await h.call("list_trips", { limit: 50, when: "all" });
  const search = (query: string) => h.call("list_bookings", { limit: 50, query }).then((result) => result.items.map((booking: { title: string }) => booking.title).sort());
  return { schema, revision: trips.revision as string, trips: trips.items.map((trip: { title: string }) => trip.title).sort(), riverside: await search("Riverside"), lisbon: await search("Lisbon") };
}
const revisionOf = (revision: string) => Number(revision.slice(1));

/** An edit and a new booking after the restore: the revision moves, and search finds the booking. */
async function stillWorks(h: Harness, before: string) {
  const lisbon = (await h.call("list_trips", { limit: 50, when: "all" })).items.find((trip: { title: string }) => trip.title === "Lisbon");
  const detail = await h.call("get_trip", { id: lisbon.id });
  await h.call("save_trip", { id: lisbon.id, expectedRevision: detail.trip.revision, notes: "Edited after the restore" });
  const edited = (await h.call("list_trips", { limit: 50, when: "all" })).revision;
  expect(revisionOf(edited)).toBeGreaterThan(revisionOf(before));
  await h.call("save_booking", { tripId: lisbon.id, draft: { kind: "activity", title: "Fado at Tasca Azul", segments: [{ startLocal: "2026-11-12T21:00", startZone: "Europe/Lisbon", address: "Rua de São Miguel, Lisbon" }] } });
  expect(revisionOf((await h.call("list_trips", { limit: 50, when: "all" })).revision)).toBeGreaterThan(revisionOf(edited));
  expect((await h.call("list_bookings", { limit: 50, query: "Tasca" })).items.map((booking: { title: string }) => booking.title)).toEqual(["Fado at Tasca Azul"]);
}

describe("backups", () => {
  it("restores Travel with its revision triggers and booking search, and an edit after the restore still moves the revision", async () => {
    const h = await harness();
    await seedPreview(h.platform);
    const before = await observe(h);
    expect(before.schema.filter((name) => name.startsWith("trigger:"))).toHaveLength(39);
    expect(before.riverside).toEqual(["Riverside House"]);
    const dir = folder();
    await backupNode(h.platform, application.config.id, path.join(dir, "backup"));
    const archive = JSON.parse(fs.readFileSync(path.join(dir, "backup", "snapshot.json"), "utf8")) as { tables: { name: string }[]; triggers?: unknown[] };
    // The index's own rows are kept, its internal tables aren't, and the triggers are in the backup.
    expect(archive.tables.map((table) => table.name)).toContain("bookings_fts");
    expect(archive.tables.map((table) => table.name).filter((name) => name.startsWith("bookings_fts_"))).toEqual([]);
    expect(archive.triggers).toHaveLength(39);

    await restoreNode(path.join(dir, "backup"), path.join(dir, "restored"), application.config.id);
    const restored = await harness({ dataDir: path.join(dir, "restored") });
    // Nothing fired while the rows went back in: the same revision, triggers and search results.
    expect(await observe(restored)).toEqual(before);
    await stillWorks(restored, before.revision);
  });

  it("restores a backup an older core made, without triggers, getting them back from Travel's migrations", async () => {
    const h = await harness();
    await seedPreview(h.platform);
    const before = await observe(h);
    const dir = folder();
    await backupNode(h.platform, application.config.id, path.join(dir, "backup"));
    // Core 0.2.2 wrote no triggers or views, no rowids, and the full-text index's internal tables.
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, "backup", "snapshot.json"), "utf8")) as { tables: { name: string; sql: string; columns: string[]; rows: unknown[][] }[]; triggers?: unknown; views?: unknown };
    const t = h.travel();
    const tables = snapshot.tables.map((table) => table.columns[0] !== "rowid" ? table : { ...table, columns: table.columns.slice(1), rows: table.rows.map((row) => row.slice(1)) });
    const internal = t.db.prepare("PRAGMA table_list").all().filter((row) => row.type === "shadow").map((row) => String(row.name));
    expect(internal.length).toBeGreaterThan(0);
    for (const name of internal) {
      const sql = String(t.db.prepare("SELECT sql FROM sqlite_schema WHERE name = ?").get(name)!.sql);
      const columns = t.db.prepare(`PRAGMA table_info("${name}")`).all().map((column) => String(column.name));
      const rows = t.db.prepare(`SELECT * FROM "${name}"`).all().map((row) => columns.map((column) => (ArrayBuffer.isView(row[column]) ? Array.from(row[column] as Uint8Array) : row[column])));
      tables.push({ name, sql, columns, rows });
    }
    fs.mkdirSync(path.join(dir, "older"));
    fs.writeFileSync(path.join(dir, "older", "snapshot.json"), JSON.stringify({ ...snapshot, tables: tables.sort((a, b) => a.name.localeCompare(b.name)), triggers: undefined, views: undefined }));

    // The kit's `restore` passes the app's migrations, as here.
    await restoreNode(path.join(dir, "older"), path.join(dir, "restored"), application.config.id, [...coreMigrations, ...application.migrations]);
    const restored = await harness({ dataDir: path.join(dir, "restored") });
    expect(await observe(restored)).toEqual(before);
    await stillWorks(restored, before.revision);
  });
});
