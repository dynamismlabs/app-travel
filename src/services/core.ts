/**
 * The Travel instance for one request: storage, settings and the helpers
 * every action uses. It runs on the app's database through the core's
 * transaction() (db/connection.ts). Opening it does no work: no timers, no
 * sync.
 *
 * Who is calling comes from the kit's context:
 * - the person's own browser (no connection) and the app's jobs see everything
 * - an assistant connection (a Ri place, Claude, ChatGPT) sees the sources
 *   the person chose for it on the consent screen, and may change records
 *   only if they allowed that
 */
import { z } from "zod/v3";
import type { Context } from "@app-builder/core";
import { AppError, createBlobStore, createJobQueue, createSettings, type AccessScope, type Operation, type SqlDatabase } from "../lib/data.js";
import { createAccountStore, createMailIndex } from "../lib/sources.js";
import { isValidZone, todayIn } from "../lib/time.js";
import { travelDatabase } from "../db/connection.js";
import { createRepo } from "../db/repo.js";
import { createIngest } from "./ingest.js";

export interface TravelSettings { homeZone: string | null; ownerNames: string[]; aiExtraction: boolean }
/** Policy defaults live here, not in SQL. */
export const DEFAULT_SETTINGS: TravelSettings = { homeZone: null, ownerNames: [], aiExtraction: false };
export const DEFAULT_HISTORY_DAYS = 90;
export const CALENDAR_PAST_DAYS = 30;
export const CALENDAR_FUTURE_DAYS = 365;

/** The caller as stored with authored records and decisions. */
export function actorOf(ctx: Pick<Context, "viewer" | "connection" | "job">): string {
  if (ctx.job) return `job:${ctx.job.name}`;
  if (ctx.connection) return `chat:${ctx.connection.clientId}`;
  return `owner-ui:${ctx.viewer.id}`;
}

/** What this caller may see and do. */
export function scopeFor(ctx: Pick<Context, "viewer" | "connection" | "job">, operation: Operation): AccessScope {
  const actorId = actorOf(ctx);
  const connection = ctx.connection;
  if (!connection) return { kind: "owner", actorId };
  if (operation === "write" && !connection.write)
    throw new AppError("forbidden", `${connection.name} can read but not make changes. Reconnect it and allow changes to do this.`);
  // All sources, including ones added later: the same view as the person's own.
  if (connection.sources === null) return { kind: "owner", actorId };
  return {
    kind: "sources", actorId, scopeRef: connection.clientId,
    sources: new Set(connection.sources), operations: new Set<Operation>(connection.write ? ["read", "write"] : ["read"]),
  };
}

export interface OpenOptions { now?: () => Date }

export function createTravel(db: SqlDatabase, options: OpenOptions = {}) {
  const now = options.now ?? (() => new Date());
  const repo = createRepo(db, now);
  const blobs = createBlobStore(db);
  const settingsStore = createSettings(db);
  const jobs = createJobQueue(db);
  const accounts = createAccountStore(db);
  const mailIndex = createMailIndex(db);

  const settings = {
    get(): TravelSettings {
      return {
        homeZone: settingsStore.get("travel.homeZone", z.string().nullable(), DEFAULT_SETTINGS.homeZone),
        ownerNames: settingsStore.get("travel.ownerNames", z.array(z.string()), DEFAULT_SETTINGS.ownerNames),
        aiExtraction: settingsStore.get("travel.aiExtraction", z.boolean(), DEFAULT_SETTINGS.aiExtraction),
      };
    },
    set(patch: Partial<TravelSettings>) {
      if (patch.homeZone !== undefined) settingsStore.set("travel.homeZone", patch.homeZone && isValidZone(patch.homeZone) ? patch.homeZone : null);
      if (patch.ownerNames !== undefined) settingsStore.set("travel.ownerNames", patch.ownerNames);
      if (patch.aiExtraction !== undefined) settingsStore.set("travel.aiExtraction", patch.aiExtraction);
    },
    lastTripId(): string | null {
      return settingsStore.get("view.lastTripId", z.string().nullable(), null);
    },
    setLastTripId(id: string | null) {
      settingsStore.set("view.lastTripId", id);
    },
    fixtureSeeded(): boolean {
      return settingsStore.get("fixture.seeded", z.boolean(), false);
    },
    markFixtureSeeded() {
      settingsStore.set("fixture.seeded", true);
    },
    raw: settingsStore,
  };

  const travel = {
    db, repo, blobs, settings, jobs, accounts, mailIndex, now,
    /** The zone for "today" and date-only reasoning: the home zone, else the process zone. */
    zone(): string {
      const home = settings.get().homeZone;
      return home ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    },
    today(): string {
      return todayIn(travel.zone(), now());
    },
    ingest(actor: string) {
      const current = settings.get();
      return createIngest({ repo, settings: { ownerNames: current.ownerNames, homeZone: current.homeZone }, actor });
    },
    resolve(ctx: Pick<Context, "viewer" | "connection" | "job">, operation: Operation): AccessScope {
      return scopeFor(ctx, operation);
    },
    actor(ctx: Pick<Context, "viewer" | "connection" | "job">) {
      return actorOf(ctx);
    },
    /**
     * Run one write as one transaction, or as part of the action's own. Ri
     * kept a receipt per invocation so a retried call returned its first
     * result; MCP has no invocation IDs, so creates take a client-made ID and
     * updates take the revision they edited.
     */
    mutate<T>(work: () => T): T {
      return db.transaction(work);
    },
  };
  return travel;
}
export type Travel = ReturnType<typeof createTravel>;

/** Clocks for tests, keyed by the database file the platform uses. */
const clocks = new WeakMap<object, () => Date>();
export function setTravelClock(platform: Context["platform"], now: (() => Date) | null) {
  if (now) clocks.set(platform.driver, now); else clocks.delete(platform.driver);
}

/**
 * TRAVEL_NOW pins "today" for trip dates in a preview or a test, so the
 * fictional November 2026 trips stay upcoming whatever the real date. Nobody
 * sets it for real use.
 */
const pinned = () => {
  const value = process.env.TRAVEL_NOW;
  return value && !Number.isNaN(Date.parse(value)) ? () => new Date(value) : undefined;
};

/** The Travel instance for this request. */
export function travelFor(ctx: Pick<Context, "platform">): Travel {
  return createTravel(travelDatabase(ctx), { now: clocks.get(ctx.platform.driver) ?? pinned() });
}
