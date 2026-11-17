/**
 * Travel's way into the app's database: the core's own connection, through
 * `transaction(ctx, work)` from @app-builder/core.
 *
 * Travel's writes read, decide and write across many tables (match a
 * confirmation against recorded bookings, then create, merge or send to
 * Review, with history and the import checkpoint, all or nothing), as Ri ran
 * them. So they run as synchronous SQLite transactions:
 * - `db.transaction(work)` is the core's `transaction()`: BEGIN IMMEDIATE,
 *   then COMMIT, or ROLLBACK when `work` throws. One inside another joins it.
 * - Each action's synchronous body is one transaction (`act` in app.ts).
 *   Actions that wait on Ri run theirs around the calls, never across one.
 * - A statement outside any transaction, such as a read before a network
 *   call in a sync step, runs as a transaction of its own, as it did in
 *   autocommit on the connection Travel used to open itself.
 *
 * The core runs `transaction()` on Node only for now, so app.config.ts
 * declares `platforms: ["node"]`. Data, migrations, backups, restore and
 * change snapshots are the kit's.
 */
import { transaction, type Context, type Transaction } from "@app-builder/core";
import type { SqlDatabase, SqlValue } from "../lib/data.js";

const bind = (params: SqlValue[]) => params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));

/** Travel's synchronous database for this request's platform. */
export function travelDatabase(ctx: Pick<Context, "platform">): SqlDatabase {
  const within = <T>(work: (tx: Transaction) => T): T => transaction(ctx, work);
  return {
    transaction: (work) => within(() => work()),
    prepare(sql) {
      // Compiled once per transaction: the core's statements end with their transaction.
      let compiled: { tx: Transaction; statement: ReturnType<Transaction["prepare"]> } | null = null;
      const statement = (tx: Transaction) => (compiled?.tx === tx ? compiled : (compiled = { tx, statement: tx.prepare(sql) })).statement;
      return {
        run: (...params) => within((tx) => statement(tx).run(...bind(params))),
        get: (...params) => within((tx) => statement(tx).get(...bind(params))),
        all: (...params) => within((tx) => statement(tx).all(...bind(params))),
      };
    },
  };
}
