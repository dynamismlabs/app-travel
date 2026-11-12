/**
 * Synchronous building blocks for Travel's backend: transactions, list
 * cursors, settings, the per-account work queue, retained source files and
 * error redaction. Everything here runs inside one SQLite transaction on
 * Travel's own connection to the app's database (db/connection.ts). Nothing
 * starts a timer or a loop: the app's declared jobs run each step.
 *
 * These helpers came from Ri's old app kit, which Travel no longer uses.
 * Their tables are created by Travel's own migrations (db/migrations.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v3";

/** The subset of a synchronous SQLite connection these helpers use. */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SqlValue[]): Record<string, unknown> | undefined;
    all(...params: SqlValue[]): Record<string, unknown>[];
  };
  readonly isTransaction: boolean;
}
export type SqlValue = string | number | bigint | null | Uint8Array;

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** An error the caller can act on, with a code that maps to the action's answer. */
export class AppError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "revoked" | "conflict" | "busy" | "timeout" | "unsupported" | "app_failed" | "interrupted" | "approval_required", message: string) {
    super(message);
    this.name = "AppError";
  }
}

/** Run `work` in one immediate transaction, or join the caller's. */
export function transaction<T>(db: SqlDatabase, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Common list input: an opaque cursor and a limit (default 50, maximum 100). */
export const listInputShape = {
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
};
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeCursor<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, cursor: string | undefined | null): T | null {
  if (!cursor) return null;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new AppError("invalid_input", "This list position expired. Reload the list");
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function createSettings(db: SqlDatabase) {
  return {
    get<T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): T {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
      if (!row) return fallback;
      const parsed = schema.safeParse(JSON.parse(String(row.value)));
      return parsed.success ? parsed.data : fallback;
    },
    set(key: string, value: unknown) {
      const time = nowIso();
      db.prepare(
        "INSERT INTO app_settings (key, created_at, updated_at, value) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).run(key, time, time, JSON.stringify(value));
    },
    remove(key: string) {
      db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    },
  };
}

// ─── Access ──────────────────────────────────────────────────────────────────

/** Source keys are Travel's own strings. Account sources use this form. */
export const accountSource = (account: string) => `account:${account}`;
export type Operation = "read" | "write";
/**
 * What one caller may see. The person's own browser and the app's jobs see
 * everything. An assistant connection (a Ri place, Claude, ChatGPT) sees the
 * sources the person chose for it on the consent screen.
 */
export type AccessScope =
  | { kind: "owner"; actorId: string }
  | { kind: "sources"; actorId: string; scopeRef: string | null; sources: ReadonlySet<string>; operations: ReadonlySet<Operation> };
export function allows(scope: AccessScope, source: string | null | undefined): boolean {
  return scope.kind === "owner" || (!!source && scope.sources.has(source));
}
/** True when every source of a mixed record is allowed. */
export function allowsAll(scope: AccessScope, sources: Iterable<string>): boolean {
  if (scope.kind === "owner") return true;
  for (const source of sources) if (!scope.sources.has(source)) return false;
  return true;
}
/** A stable key for what a reader may see. */
export function scopeFingerprint(scope: AccessScope): string {
  return scope.kind === "owner" ? "owner" : sha256(JSON.stringify([...scope.sources].sort()));
}

// ─── Work queue ──────────────────────────────────────────────────────────────

export type JobState = "pending" | "running" | "paused" | "failed";
export interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: string;
  sourceKey: string;
  state: JobState;
  attempts: number;
  nextEligibleAt: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  idempotent: boolean;
}
const jobRow = (row: Record<string, unknown>): JobRecord => ({
  id: String(row.id),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  kind: String(row.kind),
  sourceKey: String(row.source_key),
  state: String(row.state) as JobState,
  attempts: Number(row.attempts),
  nextEligibleAt: String(row.next_eligible_at),
  lastRunAt: row.last_run_at === null ? null : String(row.last_run_at),
  lastSuccessAt: row.last_success_at === null ? null : String(row.last_success_at),
  lastError: row.last_error === null ? null : String(row.last_error),
  idempotent: Number(row.idempotent) === 1,
});
/**
 * One persistent unit of work per (kind, source): mail import, calendar
 * import or enrichment for one account. The app's declared job runs one step
 * at a time, picking the fairest due unit. This decides which account goes
 * next; the kit's runner decides when the job runs.
 */
export function createJobQueue(db: SqlDatabase, options: { now?: () => Date } = {}) {
  const clock = options.now ?? (() => new Date());
  const stamp = () => clock().toISOString();
  const settings = createSettings(db);
  const get = (id: string) => {
    const row = db.prepare("SELECT * FROM app_jobs WHERE id = ?").get(id);
    return row ? jobRow(row) : null;
  };
  return {
    /** Create the unit if missing. An existing paused or failed unit keeps its state. */
    ensure(kind: string, sourceKey: string, options: { idempotent: boolean; eligibleAt?: string }): JobRecord {
      const time = stamp();
      db.prepare(
        "INSERT INTO app_jobs (id, created_at, updated_at, kind, source_key, state, attempts, next_eligible_at, last_run_at, last_success_at, last_error, idempotent) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?) ON CONFLICT(kind, source_key) DO NOTHING",
      ).run(randomUUID(), time, time, kind, sourceKey, options.eligibleAt ?? time, options.idempotent ? 1 : 0);
      return jobRow(db.prepare("SELECT * FROM app_jobs WHERE kind = ? AND source_key = ?").get(kind, sourceKey)!);
    },
    get,
    find(kind: string, sourceKey: string) {
      const row = db.prepare("SELECT * FROM app_jobs WHERE kind = ? AND source_key = ?").get(kind, sourceKey);
      return row ? jobRow(row) : null;
    },
    list(sourcePrefix?: string): JobRecord[] {
      return (sourcePrefix
        ? db.prepare("SELECT * FROM app_jobs WHERE source_key LIKE ? ORDER BY kind, source_key LIMIT 500").all(`${sourcePrefix}%`)
        : db.prepare("SELECT * FROM app_jobs ORDER BY kind, source_key LIMIT 500").all()
      ).map(jobRow);
    },
    /**
     * The next due unit. Kinds alternate when several have work, so enrichment
     * cannot starve ingestion, and within a kind the source that ran longest
     * ago goes first, so a large mailbox cannot starve another account.
     */
    next(now: string, options: { kinds?: string[]; sources?: ReadonlySet<string> } = {}): JobRecord | null {
      const due = db
        .prepare("SELECT * FROM app_jobs WHERE state = 'pending' AND next_eligible_at <= ? ORDER BY COALESCE(last_run_at, '') ASC, created_at ASC, id ASC LIMIT 200")
        .all(now)
        .map(jobRow)
        .filter((job) => (!options.kinds || options.kinds.includes(job.kind)) && (!options.sources || options.sources.has(job.sourceKey)));
      if (!due.length) return null;
      const lastKind = settings.get("jobs.lastKind", z.string(), "");
      return due.find((job) => job.kind !== lastKind) ?? due[0];
    },
    claim(id: string): JobRecord {
      return transaction(db, () => {
        const job = get(id);
        if (!job || job.state !== "pending") throw new AppError("conflict", "This background step is no longer pending");
        const time = stamp();
        db.prepare("UPDATE app_jobs SET state = 'running', attempts = attempts + 1, last_run_at = ?, updated_at = ? WHERE id = ?").run(time, time, id);
        settings.set("jobs.lastKind", job.kind);
        return get(id)!;
      });
    },
    /** Finish a successful step. `more` keeps it immediately eligible, otherwise it waits `idleMs`. */
    finish(id: string, options: { more: boolean; idleMs?: number; now?: Date }) {
      const now = options.now ?? clock();
      const next = options.more ? now.toISOString() : new Date(now.getTime() + (options.idleMs ?? 0)).toISOString();
      db.prepare(
        "UPDATE app_jobs SET state = CASE WHEN state = 'running' THEN 'pending' ELSE state END, attempts = 0, last_error = NULL, last_success_at = ?, next_eligible_at = ?, updated_at = ? WHERE id = ?",
      ).run(now.toISOString(), next, now.toISOString(), id);
    },
    /** Record a failure. Retryable failures back off exponentially (1 minute to 1 hour) for up to 8 attempts. */
    fail(id: string, error: unknown, options: { retryable: boolean; now?: Date }) {
      const job = get(id);
      if (!job) return;
      const now = options.now ?? clock();
      const retry = options.retryable && job.attempts < 8;
      const delay = Math.min(3_600_000, 60_000 * 2 ** Math.max(0, job.attempts - 1));
      db.prepare(
        "UPDATE app_jobs SET state = CASE WHEN state = 'paused' THEN 'paused' WHEN ? THEN 'pending' ELSE 'failed' END, last_error = ?, next_eligible_at = ?, updated_at = ? WHERE id = ?",
      ).run(retry ? 1 : 0, redact(error), new Date(now.getTime() + delay).toISOString(), now.toISOString(), id);
    },
    pause(sourceKey: string) {
      db.prepare("UPDATE app_jobs SET state = 'paused', updated_at = ? WHERE source_key = ?").run(stamp(), sourceKey);
    },
    /** Resume paused or failed units for a source and make them eligible now. */
    resume(sourceKey: string) {
      const time = stamp();
      db.prepare("UPDATE app_jobs SET state = 'pending', attempts = 0, next_eligible_at = ?, updated_at = ? WHERE source_key = ? AND state IN ('paused','failed')").run(time, time, sourceKey);
    },
    /** Make a pending unit eligible now, for a person's Continue. */
    wake(id: string) {
      const time = stamp();
      db.prepare("UPDATE app_jobs SET next_eligible_at = ?, updated_at = ? WHERE id = ? AND state = 'pending'").run(time, time, id);
    },
    remove(sourceKey: string) {
      db.prepare("DELETE FROM app_jobs WHERE source_key = ?").run(sourceKey);
    },
    /** After a restart a running step was interrupted. Idempotent steps resume from their committed checkpoint. */
    recover() {
      const time = stamp();
      db.prepare("UPDATE app_jobs SET state = 'pending', next_eligible_at = ?, updated_at = ? WHERE state = 'running' AND idempotent = 1").run(time, time);
      db.prepare("UPDATE app_jobs SET state = 'failed', last_error = 'Interrupted by a restart. Continue to retry', updated_at = ? WHERE state = 'running' AND idempotent = 0").run(time);
    },
    counts(): Record<JobState, number> {
      const result: Record<JobState, number> = { pending: 0, running: 0, paused: 0, failed: 0 };
      for (const row of db.prepare("SELECT state, COUNT(*) AS count FROM app_jobs GROUP BY state").all()) result[String(row.state) as JobState] = Number(row.count);
      return result;
    },
  };
}
export type JobQueue = ReturnType<typeof createJobQueue>;

// ─── Retained source files ───────────────────────────────────────────────────

/**
 * Imported files and message text, stored once by their SHA-256 digest in
 * the app's own database, so they commit with the records that cite them and
 * travel with every backup and change snapshot.
 */
export function createBlobStore(db: SqlDatabase) {
  const check = (digest: string) => {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new AppError("invalid_input", "Invalid evidence reference");
    return digest;
  };
  return {
    put(data: string | Uint8Array): { digest: string; size: number } {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      const digest = sha256(bytes);
      db.prepare("INSERT INTO travel_blobs (digest, created_at, size, bytes) VALUES (?, ?, ?, ?) ON CONFLICT(digest) DO NOTHING").run(digest, nowIso(), bytes.byteLength, bytes);
      return { digest, size: bytes.byteLength };
    },
    read(digest: string): Buffer | null {
      const row = db.prepare("SELECT bytes FROM travel_blobs WHERE digest = ?").get(check(digest));
      return row ? Buffer.from(row.bytes as Uint8Array) : null;
    },
    readText(digest: string): string | null {
      return this.read(digest)?.toString("utf8") ?? null;
    },
    has(digest: string) {
      return !!db.prepare("SELECT 1 FROM travel_blobs WHERE digest = ?").get(check(digest));
    },
    remove(digest: string) {
      db.prepare("DELETE FROM travel_blobs WHERE digest = ?").run(check(digest));
    },
  };
}
export type BlobStore = ReturnType<typeof createBlobStore>;

// ─── Text and errors ─────────────────────────────────────────────────────────

/** A short reason safe for logs and the Sources screen: no addresses, tokens or URLs. */
export function redact(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "The step failed";
  return raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[address]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
/** Bound text for storage or a model, cutting at a word boundary. */
export function boundText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const room = Math.max(1, max - 1);
  const cut = text.slice(0, room);
  const space = cut.lastIndexOf(" ");
  return { text: `${(space >= room / 2 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true };
}
