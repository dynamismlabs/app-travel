# Maintaining Travel

Travel is a personal app built with App Builder (core 0.2.0, starter 0.2.0, pinned in vendor/). It was Ri's built-in Travel app; docs/parity.md lists every feature and what changed. Use pnpm. Read the build skill in .agents/skills/build-personal-app before changing how Travel runs, connects or changes.

## Layout

- `app.config.ts`: id `travel` (keep it), name, port 4334.
- `src/app.ts`: every action, the `show_*` views, the sources a connection can be limited to, the hub `connectors` and the two jobs. Importing it opens nothing.
- `src/actions/schemas.ts`: strict input and output schemas (zod/v3, as the kit expects). `src/actions/examples.ts`: fictional examples the contract test validates.
- `src/domain/`: pure. Time (`clock.ts`), places and zones, effective bookings with corrections, itinerary, coverage and gaps, matching, and deterministic extraction (`parse/`).
- `src/db/`: `migrations.ts` (kit migrations, append only), `repo.ts` (row access), `connection.ts` (Travel's synchronous connection, below).
- `src/services/`: ingestion, sync, imports, writes, follow-ups, sources, the read model and the view opener. `core.ts` builds the Travel instance for a request and resolves the caller's access from the kit's context.
- `src/lib/`: what Ri's old app kit used to provide. `time.ts`, `mail.ts` (MIME, HTML, invitations), `sources.ts` (Gmail and Calendar sync through the hub, accounts, the message index), `data.ts` (transactions, cursors, settings, the per-account work queue, retained files, redaction).
- `src/ui/`: the UI components, with `app.tsx`, the bridge from the screens to the kit's client and React Router. `src/view/`: Travel's screens. `src/screens.tsx`: routes and the `show_*` cards.
- `src/fixtures/`: fictional messages and the preview seed. `fixtures/connectors.json`: what `APP_CONNECTORS=fixtures` serves.
- `src/worker.ts` is a stub. Travel runs on Node only.

## Database

Travel's writes are synchronous SQLite transactions on its own better-sqlite3 connection to the kit's `data.sqlite` (`src/db/connection.ts`), in the same process and with the same SQLite library copy as the kit. The kit's async database has no transactions that can read inside them. Wrap each write in `t.mutate(() => …)`. Never await inside a transaction. Migrations still go through the kit (`application.migrations`). Never open the data directory from another process.

## Access

- The person's own browser and the app's jobs see everything (`kind: "owner"`).
- An assistant connection sees the sources chosen on the consent screen: `account:<address>`, `manual` and `imports`. It may write only if allowed. A connection allowed all sources is treated as the owner.
- Filter by access before assembling any list, search, count, snippet, export or context. Use `repo.bookings(scope, ...)`, `read.visibleTrip` and `reviewVisible`. Never return a record because it was named in input.
- Name a trip shown beside anything else with `read.tripTitle` or `read.tripHeading`, never `trip.title`.
- Review decisions, deletion, source management, settings and export call `requireOwner`.

## The hub

Travel reads Gmail, Calendar, PDFs (`ri__extract_text`), the model (`ri__ai_text`) and Ri tasks through the person's hub, by Ri's tool names (`HUB_TOOLS` in `src/lib/sources.ts`), with `hubFor(ctx)`. `failureKind` maps hub failures. When a hub offers only the kit's mail and calendar capabilities, Travel falls back to those adapters. Accounts come from what the hub grants (`createSources(t).discover`). Writes that reach Ri (tasks) wait for the person's approval: the follow-up stays pending, and the `follow_ups` job repeats the identical call.

## Jobs

- `sync_sources` runs every 5 minutes: up to 8 bounded steps in 50 seconds across granted accounts, with per-account checkpoints committed with their records.
- `follow_ups` runs every 5 minutes: it repeats waiting Ri task requests.

Each step reads at most one provider page and ten message bodies. No loops or timers outside the kit's runner.

## Rules kept from Ri

- Policy defaults live in the query layer (`DEFAULT_SETTINGS`, `DEFAULT_HISTORY_DAYS`, initial booking status), never as SQL defaults.
- Review reasons never name another booking or trip. Candidates carry those, projected per reader.
- Creates take a caller-made `newId`, so a retry returns the same record. Updates take the revision they edited.
- Never overwrite a correction from a source. Store the source value with `repo.setBase`, keep the override, and open a Review item.
- Never create a booking from a cancellation, and never cancel because a source disappeared.
- Keep local wall times, zones and instants separate, using `src/lib/time.ts`. Never turn a date into a midnight timestamp.
- Never sum or convert prices across currencies.
- Model output is untrusted: validate it with a strict schema and keep only values backed by exact passages.
- Copy has no em or long dashes and avoids semicolons.

## Views

Actions are data tools. `show_trip`, `show_trips` and `show_review` draw cards (`src/screens.tsx`). `open_travel` (from the kit) opens the whole app full screen. The view reaches nothing on the network. The selected booking, or the trip, reaches the assistant through `client.select`. Inside an assistant, Ask Ri, links, maps and downloads aren't offered: the kit's view client can't do them.

## Check a change

`pnpm typecheck`, `pnpm test`, `pnpm build`, then `pnpm test:view` for the browser checks. Use a disposable `APP_DATA_DIR`, never the person's data. Commit, then `pnpm exec app-builder change` (or `serve --install` the first time). Use `--service process` while developing; never install a launchd service from a development session.
