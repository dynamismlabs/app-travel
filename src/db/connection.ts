/**
 * Travel's own connection to the app's database.
 *
 * The kit gives actions an async database that works on both native SQLite
 * and Cloudflare D1, so it has no interactive transactions: a batch is
 * atomic, but an action can't read, decide and write inside one transaction.
 * Travel's writes are exactly that (match a confirmation against recorded
 * bookings, then create, merge or send to Review, with history and the
 * import checkpoint, all or nothing), and Ri ran them as synchronous SQLite
 * transactions. To keep them, Travel opens a second, synchronous connection
 * to the same data.sqlite file the kit opened, in the same process.
 *
 * - It uses better-sqlite3, the same SQLite library as the kit (one copy in
 *   the process, so SQLite's file locks stay consistent).
 * - Its transactions are synchronous, so no other request's statements can
 *   interleave with one.
 * - Data, migrations, backups, restore and change snapshots are still the
 *   kit's: this is only another way into the same file.
 * - It means Travel runs on the Node service only, not on Cloudflare. This is
 *   recorded in docs/parity.md as a finding for the kit.
 */
import Database from "better-sqlite3";
import type { Platform } from "@app-builder/core";
import type { SqlDatabase, SqlValue } from "../lib/data.js";

const open = new Map<string, { connection: Database.Database; db: SqlDatabase }>();
const known = new WeakMap<object, string>();

function wrap(connection: Database.Database): SqlDatabase {
  return {
    exec: (sql) => { connection.exec(sql); },
    prepare(sql) {
      const statement = connection.prepare(sql);
      const bind = (params: SqlValue[]) => params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));
      return {
        run: (...params) => statement.run(...bind(params)),
        get: (...params) => statement.get(...bind(params)) as Record<string, unknown> | undefined,
        all: (...params) => statement.all(...bind(params)) as Record<string, unknown>[],
      };
    },
    get isTransaction() { return connection.inTransaction; },
  };
}

/** The file the kit's connection uses, read once per platform. */
async function fileOf(platform: Platform): Promise<string> {
  const cached = known.get(platform.driver);
  if (cached) return cached;
  let file = "";
  try {
    const result = await platform.driver.query({ sql: "PRAGMA database_list", params: [], method: "all" });
    const main = (result.rows as unknown[][]).find((row) => row[1] === "main");
    file = String(main?.[2] ?? "");
  } catch { /* D1 has no file. */ }
  if (!file) throw new Error("Travel keeps its records in a local SQLite file and runs as a service on this computer, not on Cloudflare.");
  known.set(platform.driver, file);
  return file;
}

/** Travel's synchronous connection to this platform's database. */
export async function travelDatabase(platform: Platform): Promise<SqlDatabase> {
  const file = await fileOf(platform);
  const existing = open.get(file);
  if (existing && existing.connection.open) return existing.db;
  const connection = new Database(file);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  const db = wrap(connection);
  open.set(file, { connection, db });
  return db;
}

/** Close Travel's connections, as the server stops or a test ends. */
export function closeTravelDatabases(file?: string) {
  for (const [key, entry] of open) {
    if (file && key !== file) continue;
    if (entry.connection.open) entry.connection.close();
    open.delete(key);
  }
}
