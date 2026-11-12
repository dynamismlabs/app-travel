/**
 * Linked Ri follow-ups. The link row, its operation ID and the exact request
 * are stored first, then Ri's create_task runs through the hub with that
 * operation ID, so a retry or a second click returns the same task.
 * Availability is checked with get_task.
 *
 * Ri's hub asks the person before an app creates a task. The first call
 * answers "waiting for approval"; Travel keeps the follow-up pending and its
 * declared job (follow_ups) repeats the identical call, which the kit's runner
 * retries every two minutes until the person approves in Ri.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { ApprovalPending, type Context } from "@app-builder/core";
import { AppError, allows, allowsAll, redact, transaction, type AccessScope } from "../lib/data.js";
import { failureKind, hubFor, HUB_TOOLS } from "../lib/sources.js";
import { formatDateRange } from "../lib/time.js";
import type { createFollowUpInput } from "../actions/schemas.js";
import type { FollowUpRow } from "../db/repo.js";
import type { Travel } from "./core.js";
import { createReadModel } from "./records.js";
import { reviewVisible } from "./ingest.js";

type CreateInput = z.infer<typeof createFollowUpInput>;
const taskSchema = z.object({ id: z.string().min(1).max(128) }).passthrough();
const requestSchema = z.object({ title: z.string(), description: z.string().optional(), body: z.string().optional(), dueAt: z.string().optional(), operationId: z.string() }).strict();
type TaskRequest = z.infer<typeof requestSchema>;

export const WAITING_APPROVAL = "Waiting for your approval in Ri. Travel adds the task as soon as you approve it.";

export function createFollowUps(t: Travel) {
  const { repo } = t;
  const read = createReadModel(t);
  const requestKey = (id: string) => `followUp.request.${id}`;

  /** The subject under the caller's scope, with its source key and a plain description. */
  function subject(scope: AccessScope, input: CreateInput["subject"]): { sourceKey: string; label: string } {
    if (input.type === "trip") {
      const trip = repo.trip(input.id);
      if (!trip || !read.visibleTrip(scope, trip).visible) throw new AppError("not_found", "That trip is no longer available");
      const record = read.tripRecord(scope, trip);
      return { sourceKey: allows(scope, trip.sourceKey) ? trip.sourceKey : repo.bookings(scope, { tripId: trip.id })[0]?.sourceKey ?? trip.sourceKey, label: `${record.title}${record.startDate && record.endDate ? `, ${formatDateRange(record.startDate, record.endDate)}` : ""}` };
    }
    if (input.type === "booking") {
      const booking = repo.booking(input.id);
      if (!booking || !allowsAll(scope, booking.sourceKeys)) throw new AppError("not_found", "That booking is no longer available");
      return { sourceKey: booking.sourceKey, label: `${booking.title}${booking.reference ? `, confirmation ${booking.reference}` : ""}` };
    }
    if (input.type === "idea") {
      const idea = repo.idea(input.id);
      if (!idea || !allows(scope, idea.sourceKey)) throw new AppError("not_found", "That idea is no longer available");
      return { sourceKey: idea.sourceKey, label: `Idea: ${idea.title}` };
    }
    const item = repo.review(input.id);
    if (!item || !reviewVisible(scope, item, repo)) throw new AppError("not_found", "That review item is no longer available");
    return { sourceKey: item.sourceKey, label: `Review item: ${item.reason.slice(0, 120)}` };
  }

  /** The exact call this follow-up makes. Identical every time, so an approval in Ri covers the retry. */
  function requestFor(row: FollowUpRow): TaskRequest {
    const stored = t.settings.raw.get(requestKey(row.id), requestSchema, null as unknown as TaskRequest);
    return stored ?? { title: row.title, ...(row.dueAt ? { dueAt: row.dueAt } : {}), operationId: row.operationId };
  }

  type Attempt = { status: "created" | "pending" | "needs_permission" | "failed"; message: string };
  async function attempt(ctx: Context, row: FollowUpRow, options: { rethrowApproval?: boolean } = {}): Promise<Attempt> {
    const hub = hubFor(ctx);
    try {
      if (!(await hub.tools()).includes(HUB_TOOLS.createTask)) throw new AppError("forbidden", "Adding Ri tasks isn't allowed");
      const task = taskSchema.parse(await hub.call(HUB_TOOLS.createTask, requestFor(row)));
      transaction(t.db, () => repo.updateFollowUp(row.id, { taskId: task.id, state: "created", availability: "available", checkedAt: repo.iso(), lastError: null }));
      return { status: "created", message: "Created one Ri task linked to this record." };
    } catch (error) {
      const kind = failureKind(error);
      const state: FollowUpRow["state"] = kind === "approval" || kind === "busy" ? "pending" : kind === "not_allowed" || kind === "reconnect" || kind === "choose_account" ? "needs_permission" : "failed";
      const message = kind === "approval" ? WAITING_APPROVAL
        : kind === "busy" ? "Ri isn't answering right now. Travel will try again with the same task."
        : kind === "not_allowed" ? "Travel isn't allowed to add Ri tasks. Allow \"Add tasks\" for Travel in Ri, then try again."
        : kind === "reconnect" || kind === "choose_account" ? "Connect Travel to Ri in Settings, then try again. The same task will be used."
        : redact(error);
      transaction(t.db, () => repo.updateFollowUp(row.id, { state, lastError: message }));
      if (error instanceof ApprovalPending && options.rethrowApproval) throw error;
      return { status: state === "needs_permission" ? "needs_permission" : state === "pending" ? "pending" : "failed", message };
    } finally { await hub.close(); }
  }

  async function create(ctx: Context, scope: AccessScope, input: CreateInput) {
    const about = subject(scope, input.subject);
    const actor = t.actor(ctx);
    // The link, its operation ID and the exact request exist before Ri is asked.
    const link = t.mutate(() => {
      const operationId = input.operationId ?? randomUUID();
      const existing = repo.followUpByOperation(operationId);
      if (existing) {
        if (existing.subjectId !== input.subject.id) throw new AppError("conflict", "This follow-up belongs to another record");
        return { id: existing.id };
      }
      const row = repo.insertFollowUp({ subjectType: input.subject.type, subjectId: input.subject.id, operationId, title: input.title, dueAt: input.dueAt ?? null, sourceKey: about.sourceKey, actor });
      const request: TaskRequest = {
        title: input.title,
        description: `From Travel: ${about.label}`.slice(0, 4000),
        ...(input.description ? { body: input.description.slice(0, 64000) } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        operationId,
      };
      t.settings.raw.set(requestKey(row.id), request);
      return { id: row.id };
    });
    const row = repo.followUp(link.id)!;
    if (row.taskId) return { status: "created" as const, followUp: read.followUpRecord(row), message: "This follow-up already has its Ri task." };
    const result = await attempt(ctx, row);
    return { status: result.status, followUp: read.followUpRecord(repo.followUp(row.id)!), message: result.message };
  }

  /** The follow_ups job: repeat the identical call for each follow-up still waiting. */
  async function retryPending(ctx: Context) {
    const waiting = repo.followUps({}).filter((row) => row.state === "pending" && !row.taskId);
    let created = 0;
    for (const row of waiting) if ((await attempt(ctx, row, { rethrowApproval: true })).status === "created") created++;
    const left = waiting.length - created;
    return { created, waiting: left, summary: !waiting.length ? "No follow-ups are waiting." : `Created ${created} Ri task${created === 1 ? "" : "s"}${left ? `, ${left} still waiting` : ""}.` };
  }

  async function check(ctx: Context, scope: AccessScope, id: string) {
    const row = repo.followUp(id);
    if (!row || !allows(scope, row.sourceKey)) throw new AppError("not_found", "That follow-up is no longer available");
    if (!row.taskId) return read.followUpRecord(row);
    let availability: FollowUpRow["availability"] = "unknown";
    const hub = hubFor(ctx);
    try {
      taskSchema.parse(await hub.call(HUB_TOOLS.getTask, { id: row.taskId }));
      availability = "available";
    } catch (error) {
      // Ri answers a deleted task with not_found; the kit's client passes on only its message.
      const message = error instanceof Error ? error.message : "";
      if (/no longer available|not found/i.test(message)) availability = "missing";
      else if (!["not_allowed", "reconnect", "choose_account", "busy"].includes(failureKind(error))) throw error;
    } finally { await hub.close(); }
    transaction(t.db, () => repo.updateFollowUp(row.id, { availability, checkedAt: repo.iso() }));
    return read.followUpRecord(repo.followUp(row.id)!);
  }

  function list(scope: AccessScope, subjectId?: string) {
    return repo.followUps({ subjectId, sourceKeys: scope.kind === "owner" ? null : [...scope.sources] }).map(read.followUpRecord);
  }

  return { create, check, list, retryPending };
}
