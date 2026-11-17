/**
 * Travel on App Builder: every action (the same ones over tRPC for the
 * app's own pages and over MCP for assistants), the `show_*` cards, the
 * sources a connection can be limited to, what Travel reads through the
 * person's hub, and its declared jobs.
 *
 * Importing this module opens nothing: the build imports it to write
 * dist/contract.json. Each action opens Travel's records for its request
 * (services/core.ts).
 */
import { z } from "zod/v3";
import { TRPCError } from "@trpc/server";
import { defineAction, defineJob, defineView, SetupRequired, SourceUnavailable, type Application, type Context } from "@app-builder/core";
import { appConfig } from "../app.config";
import { AppError, allows, allowsAll, decodeCursor, encodeCursor, type AccessScope } from "./lib/data.js";
import { formatDate } from "./lib/time.js";
import { HUB_TOOLS, hubFor } from "./lib/sources.js";
import * as s from "./actions/schemas.js";
import { MANUAL_SOURCE } from "./domain/model.js";
import { MIGRATIONS } from "./db/migrations.js";
import { travelFor, type Travel } from "./services/core.js";
import { createFollowUps } from "./services/followups.js";
import { createImports } from "./services/imports.js";
import { reviewVisible } from "./services/ingest.js";
import { clip, createReadModel, priceLabel } from "./services/records.js";
import { createSources, requireOwner } from "./services/sources.js";
import { createSync, type StepSummary } from "./services/sync.js";
import { createView, scopedRevision } from "./services/view.js";
import { createWrites } from "./services/writes.js";

// ─── Plumbing ───────────────────────────────────────────────────────────────

const TRPC_CODES = {
  invalid_input: "BAD_REQUEST", not_found: "NOT_FOUND", forbidden: "FORBIDDEN", revoked: "FORBIDDEN", conflict: "CONFLICT",
  busy: "SERVICE_UNAVAILABLE", timeout: "TIMEOUT", unsupported: "NOT_IMPLEMENTED", app_failed: "INTERNAL_SERVER_ERROR",
  interrupted: "CLIENT_CLOSED_REQUEST", approval_required: "PRECONDITION_FAILED",
} as const;

/** Travel's own errors become the kit's; the kit's hub errors pass through for the job runner. */
async function guard<T>(work: () => Promise<T> | T): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof AppError) throw new TRPCError({ code: TRPC_CODES[error.code], message: error.message, cause: error });
    throw error;
  }
}

type Audience = ("user" | "agent")[];
const both: Audience = ["user", "agent"];
/** The person decides these in Travel's screen. Ri's Travel kept them from chats too. */
const viewOnly: ("model" | "app")[] = ["app"];
const userOnly: Audience = ["user"];
interface Def<I extends z.AnyZodObject, O extends z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  effect: "read" | "write" | "delete";
  audience?: Audience;
  retry?: "safe" | "unsafe";
  /**
   * `["app"]`: the person's own decision, callable from Travel's screen but
   * kept from the assistant's model by a host that follows MCP Apps (Ri does).
   * The app's own checks still apply.
   */
  visibility?: ("model" | "app")[];
  handler(ctx: Context, input: z.infer<I>, t: Travel): Promise<z.input<O>> | z.input<O>;
}
const act = <I extends z.AnyZodObject, O extends z.ZodTypeAny>(def: Def<I, O>) => defineAction({
  name: def.name, title: def.title, description: def.description, input: def.input, output: def.output, effect: def.effect,
  audience: def.audience ?? both, retry: def.retry ?? "safe", ...(def.visibility ? { visibility: def.visibility } : {}),
  handler: (ctx, input) => guard(async () => def.handler(ctx, input, await travelFor(ctx))) as Promise<z.infer<O>>,
});

const listCoverage = (complete: boolean, note: string | null = null) => ({ complete, note });
function page<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = decodeCursor(z.object({ o: z.number().int().min(0) }).strict(), cursor)?.o ?? 0;
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? encodeCursor({ o: start + limit }) : null };
}
const services = (t: Travel, ctx: Context) => ({
  read: createReadModel(t), writes: createWrites(t), sources: createSources(t), view: createView(t),
  followUps: createFollowUps(t), imports: createImports(t), sync: createSync(t, ctx),
});
const owner = (t: Travel, ctx: Context, operation: "read" | "write") => {
  const scope = t.resolve(ctx, operation);
  requireOwner(scope);
  return scope;
};

// ─── Trips ──────────────────────────────────────────────────────────────────

function tripList(t: Travel, scope: AccessScope, input: { when: "upcoming" | "past" | "all" | "archived"; query?: string }) {
  const read = createReadModel(t);
  const today = t.today();
  const query = input.query?.trim().toLowerCase();
  const records = t.repo.trips()
    .map((trip) => ({ trip, view: read.visibleTrip(scope, trip) }))
    .filter(({ view }) => view.visible)
    .map(({ trip, view }) => read.stripCoverage(read.tripRecord(scope, trip, view)))
    .filter((trip) => {
      if (query && !`${trip.title} ${trip.destinations.join(" ")}`.toLowerCase().includes(query)) return false;
      if (input.when === "archived") return trip.state === "archived";
      if (trip.state === "archived") return false;
      if (input.when === "upcoming") return !trip.endDate || trip.endDate >= today;
      if (input.when === "past") return !!trip.endDate && trip.endDate < today;
      return true;
    });
  const upcoming = records.filter((trip) => !trip.endDate || trip.endDate >= today).sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  const past = records.filter((trip) => trip.endDate && trip.endDate < today).sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  return [...upcoming, ...past];
}

const listTrips = act({
  name: "list_trips", title: "List trips",
  description: "List trips with dates, recorded reservation counts and one attention summary. Filter by upcoming, past, archived or a text query. Only trips this connection may see.",
  input: s.listTripsInput, output: s.listTripsOutput, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const result = page(tripList(t, scope, input), input.cursor, input.limit);
    return { ...result, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const getTrip = act({
  name: "get_trip", title: "Read a trip",
  description: "Read one trip: the chronological itinerary by local date with zone labels, every recorded booking with sources and coverage, night coverage and overlap checks, open review items, calendar events during the trip and linked Ri follow-ups. To show it to the person, use show_trip.",
  input: s.getTripInput, output: s.tripDetailSchema, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const trip = t.repo.trip(input.id);
    if (!trip || !read.visibleTrip(scope, trip).visible) throw new AppError("not_found", "That trip is no longer available");
    return { ...read.tripDetail(scope, trip), revision: scopedRevision(t, scope) };
  },
});

const saveTrip = act({
  name: "save_trip", title: "Save a trip",
  description: "Create a trip (pass newId, a UUID you generate, and keep it on a retry), or rename one, set inclusive trip dates, home time zone, travelers and notes, or archive it. Updates need the revision you edited and return the current trip on conflict.",
  input: s.saveTripInput, output: s.writeTrip, effect: "write",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "write");
    return t.mutate(() => createWrites(t).saveTrip(scope, t.actor(ctx), input));
  },
});

// ─── Bookings ───────────────────────────────────────────────────────────────

function bookingFilter(t: Travel, scope: AccessScope, input: z.infer<typeof s.listBookingsInput>) {
  let bookings = t.repo.bookings(scope, input.unassigned ? { tripId: null } : input.tripId ? { tripId: input.tripId } : {});
  if (input.query?.trim()) {
    const ids = new Set(t.repo.searchBookingIds(scope, input.query));
    bookings = bookings.filter((booking) => ids.has(booking.id));
  }
  if (input.kind !== "all") bookings = bookings.filter((booking) => booking.kind === input.kind);
  if (input.status === "needs_review") {
    const open = new Set(t.repo.reviews({ open: true }).filter((item) => reviewVisible(scope, item, t.repo)).flatMap((item) => (item.bookingId ? [item.bookingId] : [])));
    bookings = bookings.filter((booking) => open.has(booking.id));
  } else if (input.status !== "all") bookings = bookings.filter((booking) => booking.status === input.status);
  return bookings;
}

const listBookings = act({
  name: "list_bookings", title: "List bookings",
  description: "List recorded bookings in chronological order, for one trip, unassigned, or across trips. Filter by status (confirmed, planned, canceled, needs review), kind or a text query over titles, providers, references, travelers and places. Every booking includes its source references and coverage.",
  input: s.listBookingsInput, output: s.listBookingsOutput, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const labels = read.accountLabels();
    const result = page(bookingFilter(t, scope, input), input.cursor, input.limit);
    const titles = new Map<string, string | null>();
    return { items: result.items.map((booking) => read.bookingRecord(scope, booking, { labels, titles })), nextCursor: result.nextCursor, coverage: listCoverage(true, input.query ? "Search covers recorded bookings. A reservation that was never imported cannot appear." : null), revision: scopedRevision(t, scope) };
  },
});

const getBooking = act({
  name: "get_booking", title: "Read a booking",
  description: "Read one booking with its segments or stay, local times and zones, corrections beside source values, every source reference, its change history, open review items and linked follow-ups.",
  input: s.getBookingInput, output: s.bookingDetailSchema, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const booking = t.repo.booking(input.id);
    if (!booking || !allowsAll(scope, booking.sourceKeys)) throw new AppError("not_found", "That booking is no longer available");
    const changes = t.repo.changes(booking.id).filter((change) => change.sourceKey === MANUAL_SOURCE || allows(scope, change.sourceKey)).slice(-200).map((change) => {
      const evidence = change.evidenceId ? t.repo.evidence(change.evidenceId) : null;
      return {
        id: change.id, at: change.createdAt, kind: change.kind,
        fields: change.fields.slice(0, 60).map((field) => {
          // A move names trips, which each reader sees under their own projection.
          const trip = field.field === "trip";
          return { field: clip(field.field, 60), label: clip(field.label, 80), before: clip(trip ? read.historyTrip(scope, field.beforeId, field.before) : field.before, 400), after: clip(trip ? read.historyTrip(scope, field.afterId, field.after) : field.after, 400) };
        }),
        note: change.note ? clip(change.note, 600) : null,
        actorLabel: change.actor.startsWith("owner-ui:") || change.actor.startsWith("fixture:") ? (["corrected", "edited", "moved", "kept", "correction_removed"].includes(change.kind) ? "You" : "Travel") : change.actor.startsWith("job:") ? "Automatic update" : change.actor.startsWith("chat:") ? "An assistant" : "Travel",
        source: evidence && allows(scope, evidence.sourceKey) ? { evidenceId: evidence.id, title: clip(evidence.title, 300) } : null,
      };
    });
    const review = t.repo.reviews({ bookingId: booking.id, open: true }).filter((item) => reviewVisible(scope, item, t.repo)).map((item) => read.reviewRecord(scope, item));
    const followUps = t.repo.followUps({ subjectType: "booking", subjectId: booking.id }).filter((row) => allows(scope, row.sourceKey)).map(read.followUpRecord);
    const address = booking.stay?.address ?? booking.segments.find((segment) => segment.address)?.address ?? null;
    return { booking: read.bookingRecord(scope, booking), changes, review, followUps, directionsAddress: address ? clip(address, 400) : null, revision: scopedRevision(t, scope) };
  },
});

const saveBooking = act({
  name: "save_booking", title: "Save a booking",
  description: "Add a booking by hand (pass newId, a UUID you generate, and keep it on a retry), or correct one. A correction to an imported booking is saved beside the original value and survives later imports. Also moves a booking between trips without losing sources or corrections, and clears corrections. Updates need the revision you edited.",
  input: s.saveBookingInput, output: s.writeBooking, effect: "write",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "write");
    return t.mutate(() => createWrites(t).saveBooking(scope, t.actor(ctx), input));
  },
});

const deleteBooking = act({
  name: "delete_booking", title: "Remove a booking",
  description: "Remove a booking from Travel. Its sources stay recorded. Needs the revision you saw. Only a connection allowed to see all of Travel can do this.",
  input: s.deleteBookingInput, output: s.deleteOutput, effect: "delete", visibility: viewOnly,
  handler(ctx, input, t) {
    const scope = owner(t, ctx, "write");
    return t.mutate(() => createWrites(t).deleteBooking(scope, t.actor(ctx), input));
  },
});

// ─── Ideas ──────────────────────────────────────────────────────────────────

const listIdeas = act({
  name: "list_ideas", title: "List saved ideas",
  description: "List saved ideas for a trip. Ideas are visibly unbooked and never count as confirmed bookings. Prices are as observed, in integer minor units with their currency.",
  input: s.listIdeasInput, output: s.listIdeasOutput, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const result = page(t.repo.ideas(scope, input.tripId ? { tripId: input.tripId } : {}), input.cursor, input.limit);
    return { items: result.items.map(read.ideaRecord), nextCursor: result.nextCursor, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const saveIdea = act({
  name: "save_idea", title: "Save an idea",
  description: "Save an idea for a trip (pass newId, a UUID you generate, and keep it on a retry), or update or remove one: title, note, an optional https source link, an observed price in integer minor units with its currency, location and check-in conditions. Ideas are never bookings.",
  input: s.saveIdeaInput, output: s.writeIdea, effect: "write",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "write");
    return t.mutate(() => createWrites(t).saveIdea(scope, input));
  },
});

const compareIdeas = act({
  name: "compare_ideas", title: "Compare ideas",
  description: "Compare two to four saved ideas side by side: known price and currency, location, check-in conditions and source date. Unknown values say Not provided. Prices in different currencies are never converted or added. No ratings or rankings.",
  input: s.compareIdeasInput, output: s.compareOutput, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const ideas = input.ids.map((id) => {
      const idea = t.repo.idea(id);
      if (!idea || idea.removedAt || !allows(scope, idea.sourceKey)) throw new AppError("not_found", "One of these ideas is no longer available");
      return read.ideaRecord(idea);
    });
    const given = (value: string | null | undefined) => (value && value.trim() ? clip(value, 500) : "Not provided");
    const rows = [
      { label: "Price", values: ideas.map((idea) => priceLabel(idea.priceMinor, idea.currency)) },
      { label: "Location", values: ideas.map((idea) => given(idea.location)) },
      { label: "Check-in and conditions", values: ideas.map((idea) => given(idea.conditions)) },
      { label: "Source date", values: ideas.map((idea) => (idea.observedAt ? formatDate(idea.observedAt.slice(0, 10), "medium") : "Not provided")) },
      { label: "Source", values: ideas.map((idea) => given(idea.sourceLabel)) },
      { label: "Note", values: ideas.map((idea) => given(idea.note)) },
    ];
    const currencies = [...new Set(ideas.map((idea) => idea.currency).filter((value): value is string => !!value))];
    const note = currencies.length > 1 ? `Prices are in ${currencies.join(" and ")}. They are not converted or added together. Ideas are not bookings.` : "Prices are as observed on the source date. Ideas are not bookings.";
    return { ideas, rows, currencies, note };
  },
});

// ─── Review and coverage ────────────────────────────────────────────────────

function reviewList(t: Travel, scope: AccessScope, input: { state: "open" | "decided" | "all"; tripId?: string }) {
  const items = t.repo.reviews({ open: input.state === "open", tripId: input.tripId, limit: 1000 }).filter((item) => (input.state !== "decided" || !!item.decision) && reviewVisible(scope, item, t.repo));
  if (input.state === "decided") items.reverse();
  return items;
}

const listReview = act({
  name: "list_review_items", title: "List review items",
  description: "List items waiting in Review: unassigned reservations, changes and cancellations to confirm, possible duplicates and extracted details to check. Each item compares current and proposed values with its sources. To show them to the person, use show_review.",
  input: s.listReviewInput, output: s.listReviewOutput, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const result = page(reviewList(t, scope, input), input.cursor, input.limit);
    const labels = read.accountLabels();
    return { items: result.items.map((item) => read.reviewRecord(scope, item, labels)), nextCursor: result.nextCursor, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const reviewChange = act({
  name: "review_change", title: "Decide a review item",
  description: "Decide a review item: accept a change or keep current values, assign a reservation to a trip or start a new one, link a possible duplicate or keep it separate, confirm extracted details, or dismiss. Needs the item's revision. The person decides Review in Travel's screen, so hosts keep this from the assistant. Only a connection allowed to see all of Travel can do this.",
  input: s.reviewChangeInput, output: s.writeReview, effect: "write", visibility: viewOnly,
  handler(ctx, input, t) {
    const scope = owner(t, ctx, "write");
    return t.mutate(() => createWrites(t).reviewChange(scope, t.actor(ctx), input));
  },
});

const dismissGap = act({
  name: "dismiss_gap", title: "Dismiss a coverage prompt",
  description: "Dismiss a coverage prompt, such as a night with no booking recorded when staying with friends. The dismissal holds until the bookings around it change. Pass restore to show it again.",
  input: s.dismissGapInput, output: s.dismissGapOutput, effect: "write",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "write");
    return t.mutate(() => createWrites(t).dismissGap(scope, t.actor(ctx), input));
  },
});

// ─── Follow-ups ─────────────────────────────────────────────────────────────

const createFollowUp = act({
  name: "create_follow_up", title: "Add a Ri follow-up",
  description: "Create one Ri task linked to a trip, booking, idea or review item, with an optional due date. Ri asks the person to approve it first. Until then it waits as pending, and Travel adds it once approved. Pass the same operationId on a retry or second click to get the same task. Nothing is sent to anyone.",
  input: s.createFollowUpInput, output: s.followUpOutput, effect: "write",
  async handler(ctx, input, t) {
    return createFollowUps(t).create(ctx, t.resolve(ctx, "write"), input);
  },
});

const listFollowUps = act({
  name: "list_follow_ups", title: "List follow-ups",
  description: "List Ri follow-ups linked from Travel, with their last known task availability.",
  input: s.listFollowUpsInput, output: s.listFollowUpsOutput, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const result = page(createFollowUps(t).list(scope, input.subjectId), input.cursor, input.limit);
    return { ...result, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const checkFollowUp = act({
  name: "check_follow_up", title: "Check a follow-up",
  description: "Check whether a linked Ri task still exists and record its availability.",
  input: s.checkFollowUpInput, output: s.followUpSchema, effect: "write",
  async handler(ctx, input, t) {
    return createFollowUps(t).check(ctx, t.resolve(ctx, "write"), input.id);
  },
});

const retryFollowUps = act({
  name: "retry_follow_ups", title: "Add waiting follow-ups to Ri",
  description: "Repeat the identical Ri task request for each follow-up still waiting, so an approval in Ri takes effect. Run by the follow_ups job.",
  input: z.object({}).strict(), output: z.object({ created: z.number().int().min(0), waiting: z.number().int().min(0), summary: z.string() }).strict(), effect: "write", audience: userOnly,
  async handler(ctx, _input, t) {
    owner(t, ctx, "write");
    return createFollowUps(t).retryPending(ctx);
  },
});

// ─── Import ─────────────────────────────────────────────────────────────────

const previewImport = act({
  name: "preview_import", title: "Preview an import",
  description: "Read a chosen file (PDF, text, HTML or saved email, base64) or pasted confirmation and preview the bookings found, their source passages, matching bookings and trip placement. Nothing changes until apply_import. PDFs are read by Ri.",
  input: s.previewImportInput, output: s.previewOutput, effect: "write", visibility: viewOnly,
  async handler(ctx, input, t) {
    // Anyone who may write imported files: the person, or a connection given "Uploaded and pasted confirmations" and changes.
    return createImports(t).preview(ctx, t.resolve(ctx, "write"), input);
  },
});

const applyImport = act({
  name: "apply_import", title: "Apply an import",
  description: "Apply exactly the stored preview once, by preview ID and digest. Adds or updates the matching bookings, places them in trips and sends anything uncertain to Review. A repeat returns the first result.",
  input: s.applyImportInput, output: s.applyOutput, effect: "write", visibility: viewOnly,
  handler(ctx, input, t) {
    return createImports(t).apply(ctx, t.resolve(ctx, "write"), input);
  },
});

const getEvidence = act({
  name: "get_evidence", title: "Read a source",
  description: "Read a retained source: the excerpt kept from the original confirmation, its availability and the bookings it supports.",
  input: s.getEvidenceInput, output: s.evidenceDetailSchema, effect: "read",
  handler(ctx, input, t) {
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const evidence = t.repo.evidence(input.id);
    if (!evidence || !allows(scope, evidence.sourceKey)) throw new AppError("not_found", "That source is no longer available");
    const text = evidence.textBlob ? t.blobs.readText(evidence.textBlob) ?? "" : "";
    const links = t.repo.linksForEvidence(evidence.id);
    const bookings = links.map((link) => t.repo.booking(link.bookingId)).filter((booking): booking is NonNullable<typeof booking> => !!booking && allowsAll(scope, booking.sourceKeys));
    const account = evidence.account ? t.accounts.get(evidence.account, "mail") : null;
    const address = account?.checkpoint && typeof account.checkpoint === "object" ? (account.checkpoint as { emailAddress?: string | null }).emailAddress ?? null : null;
    const messageId = evidence.messageIdHeader?.replace(/^<|>$/g, "");
    const openUrl = evidence.origin === "gmail" && messageId && evidence.availability === "available" ? `https://mail.google.com/mail/${address ? `?authuser=${encodeURIComponent(address)}` : ""}#search/rfc822msgid%3A${encodeURIComponent(messageId)}` : null;
    return {
      source: read.sourceRef({ role: links[0]?.role ?? "linked", evidence }, read.accountLabels()),
      excerpt: clip(text || evidence.excerpt || "", 8000), truncated: text.length > 8000,
      passages: (evidence.excerpt ?? "").split("\n").filter(Boolean).slice(0, 20).map((line) => clip(line, 600)),
      fileName: evidence.fileName ? clip(evidence.fileName, 200) : null, mimeType: evidence.mimeType,
      note: evidence.availability === "unavailable" ? "Source unavailable. The original was deleted or moved to Trash. This excerpt was retained when it was imported." : evidence.fictional ? "Fictional example source." : evidence.parseNote ? clip(evidence.parseNote, 300) : null,
      openUrl: openUrl && openUrl.length <= 500 ? openUrl : null,
      bookings: bookings.slice(0, 20).map((booking) => ({ id: booking.id, title: clip(booking.title, 200) })),
    };
  },
});

const exportTrip = act({
  name: "export_trip", title: "Export a trip",
  description: "Export one trip's itinerary, bookings and ideas as JSON or CSV text. Local times keep their zones. Only a connection allowed to see all of Travel can do this.",
  input: s.exportTripInput, output: s.exportOutput, effect: "read", visibility: viewOnly,
  handler(ctx, input, t) {
    return createView(t).exportTrip(owner(t, ctx, "read"), input.id, input.format);
  },
});

// ─── The view ───────────────────────────────────────────────────────────────

const openView = act({
  name: "open_view", title: "Open Travel at a place",
  description: "Where Travel's screen opens for a path such as /, /trips/<id>, /bookings/<id>, /review or /sources, with small setup data and a revision that changes when records change. Travel's own screen calls this. Opening never starts an import.",
  input: s.openViewInput, output: s.openViewOutput, effect: "read", visibility: viewOnly,
  handler(ctx, input, t) {
    return createView(t).open(t.resolve(ctx, "read"), input);
  },
});

const describeContext = act({
  name: "describe_view_context", title: "Describe a Travel screen",
  description: "Describe a place in Travel for the chat: a trip (path /trips/<id>), a selected day or bookings, coverage gaps, review items and calendar events, re-resolved under this connection's access. Labeled app data with record references and revisions. Use it with the record the person selected in Travel's screen.",
  input: s.contextInput, output: s.contextOutput, effect: "read",
  handler(ctx, input, t) {
    return createView(t).describe(t.resolve(ctx, "read"), input);
  },
});

const rememberView = act({
  name: "remember_view", title: "Remember the last trip",
  description: "Remember the trip the person last opened so Travel can reopen it. Travel's own screen calls this.",
  input: s.rememberInput, output: s.okOutput, effect: "write", visibility: viewOnly,
  handler(ctx, input, t) {
    owner(t, ctx, "write");
    t.settings.setLastTripId(input.lastTripId);
    return { status: "saved" as const };
  },
});

// ─── Sources ────────────────────────────────────────────────────────────────

const listSources = act({
  name: "list_sources", title: "List Travel's sources",
  description: "List the mail and calendar accounts Travel reads through Ri, with history range, coverage, last update, pending and failed counts, plus imported files and collections. Only a connection allowed to see all of Travel can do this.",
  input: z.object({}).strict(), output: s.listSourcesOutput, effect: "read", visibility: viewOnly,
  handler(ctx, _input, t) {
    owner(t, ctx, "read");
    return createSources(t).list();
  },
});

const checkAccounts = act({
  name: "check_accounts", title: "Check Ri for accounts",
  description: "Ask Ri which mail and calendar accounts Travel may read now, and update Sources. Only a connection allowed to see all of Travel can do this.",
  input: z.object({}).strict(), output: s.listSourcesOutput.extend({ connected: z.boolean(), message: z.string().max(500).nullable() }), effect: "write", visibility: viewOnly,
  async handler(ctx, _input, t) {
    owner(t, ctx, "write");
    const sources = createSources(t);
    const hub = hubFor(ctx);
    try {
      const found = await sources.discover(hub);
      return { ...sources.list(), connected: found.connected, message: found.message ? clip(found.message, 500) : null };
    } finally { await hub.close(); }
  },
});

const setupSource = act({
  name: "setup_source", title: "Set up an account",
  description: "Choose the mail history range (30, 90 or 365 days) or the calendars to check for an account Travel reads. A wider range resumes import for the older mail only.",
  input: s.setupSourceInput, output: s.okOutput, effect: "write", visibility: viewOnly,
  handler(ctx, input, t) {
    owner(t, ctx, "write");
    return t.mutate(() => createSources(t).setup(input));
  },
});

const listCalendarsAction = act({
  name: "list_calendars", title: "List calendars",
  description: "List the calendars of a calendar account Travel reads, so the person can choose which to check for trip conflicts.",
  input: z.object({ sourceAccount: z.string().min(1).max(320) }).strict(), output: s.calendarsOutput, effect: "read", visibility: viewOnly,
  async handler(ctx, input, t) {
    owner(t, ctx, "read");
    return createSources(t).calendars(ctx, input.sourceAccount);
  },
});

const pauseSource = act({
  name: "pause_source", title: "Pause an account",
  description: "Pause or resume automatic updates for an account. Imported records stay readable.",
  input: s.pauseSourceInput, output: s.okOutput, effect: "write", visibility: viewOnly,
  handler(ctx, input, t) {
    owner(t, ctx, "write");
    return t.mutate(() => createSources(t).pause(input.sourceAccount, input.paused));
  },
});

const deleteSourceData = act({
  name: "delete_source_data", title: "Delete imported data",
  description: "Delete what Travel imported from one account (account:<id>), from all files (imports) or from one file (import:<id>): its bookings, sources, search entries and calendar events. Notes you wrote are kept. The account is paused so nothing re-imports.",
  input: s.deleteSourceInput, output: s.deleteSourceOutput, effect: "delete", visibility: viewOnly,
  handler(ctx, input, t) {
    owner(t, ctx, "write");
    return t.mutate(() => createSources(t).deleteImported(input.source));
  },
});

const continueImport = act({
  name: "continue_import", title: "Continue an import",
  description: "Run the next bounded import step for one account now, with the same limits as the automatic job: one mail page with at most ten messages read, or one calendar page.",
  input: s.continueImportInput, output: s.continueOutput, effect: "write", visibility: viewOnly,
  async handler(ctx, input, t) {
    owner(t, ctx, "write");
    const { sync, sources } = services(t, ctx);
    const account = input.source.slice("account:".length);
    const step = await sync.step({ only: { account, kind: input.kind } });
    const stored = t.accounts.get(account, input.kind);
    const { failure: _failure, ...summary } = step;
    return { step: summary, source: stored ? sources.accountRecord(account, input.kind, stored.status !== "reconnect" ? { automatic: true } : null) : null };
  },
});

const saveSettings = act({
  name: "save_settings", title: "Travel settings",
  description: "Set the home time zone, the names that appear on your own bookings, and whether the opted-in AI fallback (Ri's model) may read confirmations the built-in readers cannot.",
  input: s.settingsInput, output: s.settingsOutput, effect: "write", visibility: viewOnly,
  handler(ctx, input, t) {
    owner(t, ctx, "write");
    return t.mutate(() => {
      t.settings.set(input);
      return { status: "saved" as const, settings: t.settings.get() };
    });
  },
});

// ─── Jobs ───────────────────────────────────────────────────────────────────

const syncOutput = z.object({ steps: z.number().int().min(0), read: z.number().int().min(0), added: z.number().int().min(0), review: z.number().int().min(0), removed: z.number().int().min(0), summary: z.string().max(600) }).strict();
const syncSources = act({
  name: "sync_sources", title: "Import from Gmail and Calendar",
  description: "A few bounded import steps across the accounts Ri lets Travel read: Gmail pages with at most ten messages read each, Calendar pages, and saved sources whose booking is in an attachment or waits for the opted-in AI fallback. Records and each account's checkpoint commit together. Run by the sync_sources job.",
  input: z.object({}).strict(), output: syncOutput, effect: "write", audience: userOnly,
  async handler(ctx, _input, t) {
    owner(t, ctx, "write");
    const sync = createSync(t, ctx);
    const hub = hubFor(ctx);
    const started = Date.now(), budget = 50_000;
    const steps: StepSummary[] = [];
    try {
      for (let index = 0; index < 8 && Date.now() - started < budget - 5_000; index++) {
        const step = await sync.step({ hub, budgetMs: budget - (Date.now() - started) });
        steps.push(step);
        if (!step.ran || step.failure === "reconnect" || step.failure === "busy") break;
      }
    } finally { await hub.close(); }
    const ran = steps.filter((step) => step.ran);
    const total = (key: "read" | "added" | "review" | "removed") => ran.reduce((sum, step) => sum + step[key], 0);
    // Hub-wide problems go to the kit's runner, so its retries and Settings status apply.
    if (ran.length && ran.every((step) => step.failure === "busy")) throw new SourceUnavailable(ran.at(-1)!.summary);
    if (ran.length && ran.every((step) => step.failure === "reconnect")) throw new SetupRequired(ran.at(-1)!.summary);
    // Connected once and since revoked: the run fails, so Settings and the job's status say to connect again.
    const idle = steps.at(-1);
    if (!ran.length && idle && /connect this app again/i.test(idle.summary)) throw new SetupRequired(idle.summary);
    const summary = ran.length ? ran.map((step) => step.summary).filter(Boolean).slice(0, 4).join(". ") : steps.at(-1)?.summary ?? "Nothing to do.";
    return { steps: ran.length, read: total("read"), added: total("added"), review: total("review"), removed: total("removed"), summary: clip(summary, 600) };
  },
});

// ─── Cards for assistants (show_*) ──────────────────────────────────────────

const showTrip = defineView({
  name: "show_trip", title: "Show a trip",
  description: "Show the person one trip as a card: its itinerary by local day with zone labels, what still needs attention (nights with no booking recorded, overlaps, review items) and calendar events. Pass the trip's id from list_trips, or leave it out for the next upcoming trip. Use it when seeing the trip helps the person. To read it yourself, use get_trip.",
  input: z.object({ id: z.string().max(128).optional().describe("The trip to show. Leave out for the next upcoming trip."), title: z.string().max(80).optional().describe('A short heading, such as "Your Lisbon trip".') }),
  output: z.object({ title: z.string(), detail: s.tripDetailSchema.nullable(), message: z.string().nullable() }),
  invoking: "Getting your trip", invoked: "Your trip",
  handler: (ctx, input) => guard(async () => {
    const t = await travelFor(ctx);
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const id = input.id ?? tripList(t, scope, { when: "upcoming" })[0]?.id;
    const trip = id ? t.repo.trip(id) : null;
    if (!trip || !read.visibleTrip(scope, trip).visible) return { summary: id ? "That trip isn't available, so the card says so." : "No upcoming trip is recorded, so the card says so.", data: { title: input.title ?? "Your trip", detail: null, message: id ? "That trip is no longer available." : "No upcoming trip is recorded." } };
    const detail = { ...read.tripDetail(scope, trip), revision: scopedRevision(t, scope) };
    const gaps = detail.coverage.gaps.filter((gap) => !gap.dismissed).length;
    return {
      summary: `Showed ${detail.trip.title}, ${detail.trip.dateLabel}: ${detail.bookings.length} booking${detail.bookings.length === 1 ? "" : "s"} recorded${gaps ? `, ${gaps} coverage prompt${gaps === 1 ? "" : "s"}` : ""}${detail.review.length ? `, ${detail.review.length} in Review` : ""}.`,
      data: { title: input.title ?? detail.trip.title, detail, message: null },
    };
  }),
});

const showTrips = defineView({
  name: "show_trips", title: "Show trips",
  description: "Show the person a list of their trips as a card, each with its dates, recorded bookings and what needs attention. Filter by upcoming, past or all. Use it when seeing the trips helps the person. To read them yourself, use list_trips.",
  input: z.object({ when: z.enum(["upcoming", "past", "all"]).default("upcoming"), title: z.string().max(80).optional(), limit: z.number().int().min(1).max(20).default(8) }),
  output: z.object({ title: z.string(), trips: z.array(s.tripSchema), more: z.boolean() }),
  invoking: "Getting your trips", invoked: "Your trips",
  handler: (ctx, input) => guard(async () => {
    const t = await travelFor(ctx);
    const scope = t.resolve(ctx, "read");
    const all = tripList(t, scope, { when: input.when });
    const trips = all.slice(0, input.limit);
    return {
      summary: trips.length ? `Showed ${trips.length}${all.length > trips.length ? "+" : ""} trip${trips.length === 1 ? "" : "s"}: ${trips.map((trip) => `${trip.title} (${trip.dateLabel})`).join("; ")}.` : "No trips match, so the card says so.",
      data: { title: input.title ?? (input.when === "past" ? "Past trips" : input.when === "all" ? "Your trips" : "Upcoming trips"), trips, more: all.length > trips.length },
    };
  }),
});

const showReview = defineView({
  name: "show_review", title: "Show review items",
  description: "Show the person what waits in Travel's Review as a card: reservations without a trip, changes and cancellations to confirm, possible duplicates and extracted details to check, each comparing recorded and proposed values. The person decides each one. To read them yourself, use list_review_items.",
  input: z.object({ tripId: z.string().max(128).optional(), title: z.string().max(80).optional() }),
  output: z.object({ title: z.string(), items: z.array(s.reviewItemSchema), owner: z.boolean(), more: z.boolean() }),
  invoking: "Getting Review", invoked: "Review",
  handler: (ctx, input) => guard(async () => {
    const t = await travelFor(ctx);
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const all = reviewList(t, scope, { state: "open", tripId: input.tripId });
    const labels = read.accountLabels();
    const items = all.slice(0, 12).map((item) => read.reviewRecord(scope, item, labels));
    return {
      summary: items.length ? `Showed ${all.length} item${all.length === 1 ? "" : "s"} waiting in Review: ${items.slice(0, 6).map((item) => item.headline).join("; ")}.` : "Nothing waits in Review, so the card says so.",
      data: { title: input.title ?? "Waiting in Review", items, owner: scope.kind === "owner", more: all.length > items.length },
    };
  }),
});

// ─── The application ────────────────────────────────────────────────────────

export const application: Application = {
  config: appConfig,
  actions: [
    listTrips, getTrip, saveTrip, listBookings, getBooking, saveBooking, deleteBooking, listIdeas, saveIdea, compareIdeas,
    listReview, reviewChange, dismissGap, createFollowUp, listFollowUps, checkFollowUp, retryFollowUps, previewImport, applyImport, getEvidence, exportTrip,
    openView, describeContext, rememberView, listSources, checkAccounts, setupSource, listCalendarsAction, pauseSource, deleteSourceData, continueImport, saveSettings, syncSources,
  ],
  views: [showTrip, showTrips, showReview],
  /**
   * What a connection can be limited to on the consent screen: each account
   * Travel reads through Ri, the trips and bookings entered by hand, and
   * imported files. Every query applies the choice (lib/data.ts allows).
   */
  sources: {
    label: "accounts and collections",
    async list(ctx) {
      return createSources(await travelFor(ctx)).shareable();
    },
  },
  /**
   * Places a host can open Travel at (`open_travel`'s path, a host's link),
   * and records its @ menu offers. Both run as the connection, so they show
   * only what it may see.
   */
  records: {
    paths: "/trips/<id> opens a trip's itinerary, /bookings/<id> opens a booking beside its trip, /ideas/<id> opens a saved idea in its trip, /review opens Review",
    async search(ctx, query) {
      const t = await travelFor(ctx);
      const scope = t.resolve(ctx, "read");
      const read = createReadModel(t);
      const words = query.trim();
      const trips = tripList(t, scope, { when: "all", ...(words ? { query: words } : {}) }).slice(0, words ? 10 : 20)
        .map((trip) => ({ path: `/trips/${trip.id}`, title: trip.title, description: `Trip, ${trip.dateLabel}` }));
      if (!words) return trips;
      const ids = new Set(t.repo.searchBookingIds(scope, words));
      const bookings = t.repo.bookings(scope).filter((booking) => ids.has(booking.id)).slice(0, 10).map((booking) => {
        const record = read.bookingRecord(scope, booking);
        return { path: `/bookings/${booking.id}`, title: record.title, description: `${record.kindLabel}, ${record.dateLabel}` };
      });
      return [...trips, ...bookings].slice(0, 20);
    },
    async read(ctx, path) {
      const t = await travelFor(ctx);
      return createView(t).describeRecord(t.resolve(ctx, "read"), path);
    },
  },
  connectors: {
    purpose: "to find travel confirmations in your email, check your calendar during trips, read booking PDFs, and add follow-up tasks you ask for",
    capabilities: ["mail.read", "calendar.read"],
    tools: Object.values(HUB_TOOLS),
  },
  jobs: [
    defineJob({ name: "sync_sources", title: "Import from Gmail and Calendar", schedule: "every 5 minutes", action: "sync_sources" }),
    defineJob({ name: "follow_ups", title: "Add approved follow-ups to Ri", schedule: "every 5 minutes", action: "retry_follow_ups" }),
  ],
  migrations: MIGRATIONS,
  async exportData(ctx) {
    const t = await travelFor(ctx);
    const scope = t.resolve(ctx, "read");
    const read = createReadModel(t);
    const trips = tripList(t, scope, { when: "all" }).concat(tripList(t, scope, { when: "archived" }));
    return {
      records: {
        trips,
        bookings: t.repo.bookings(scope).map((booking) => read.bookingRecord(scope, booking)),
        ideas: t.repo.ideas(scope).map(read.ideaRecord),
        followUps: createFollowUps(t).list(scope),
      },
    };
  },
};
