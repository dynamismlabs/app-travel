# Maintaining Travel

Travel is a personal app built with App Builder (core 0.2.2 from kit `e44b499`, starter 0.2.0, pinned in vendor/). Take a newer core with the kit's `upgrade --core <kit checkout> --json`. It was Ri's built-in Travel app, and docs/parity.md lists every feature and what changed. Use pnpm. Read the build skill in .agents/skills/build-personal-app before changing how Travel runs, connects or changes.

## Layout

- `app.config.ts`: id `travel` (keep it), name, port 4334, and `instructions`, what an assistant needs across the tools (below).
- `src/app.ts`: every action, the `show_*` views, the prompts, the sources a connection can be limited to, the hub `connectors` and the two jobs. Importing it opens nothing.
- `src/prompts.ts`: `trip-check`, the skill Ri's Travel bundled, as an MCP prompt with an optional `trip`.
- `src/actions/schemas.ts`: strict input and output schemas (zod/v3, as the kit expects). `src/actions/examples.ts`: fictional examples the contract test validates.
- `src/domain/`: pure. Time (`clock.ts`), places and zones, effective bookings with corrections, itinerary, coverage and gaps, matching, and deterministic extraction (`parse/`).
- `src/db/`: `migrations.ts` (kit migrations, append only), `repo.ts` (row access), `connection.ts` (the app's database through the core's `transaction()`, below).
- `src/services/`: ingestion, sync, imports, writes, follow-ups, sources, the read model and the view opener. `core.ts` builds the Travel instance for a request and resolves the caller's access from the kit's context.
- `src/lib/`: what Ri's old app kit used to provide. `time.ts`, `mail.ts` (MIME, HTML, invitations), `sources.ts` (Gmail and Calendar sync through the hub, accounts, the message index), `data.ts` (transactions, cursors, settings, the per-account work queue, retained files, redaction).
- `src/ui/`: the UI components, with `app.tsx`, the bridge from the screens to the kit's client and React Router. `src/view/`: Travel's screens. `src/screens.tsx`: routes and the `show_*` cards.
- `src/fixtures/`: fictional messages and the preview seed. `TRAVEL_NOW` pins today for the preview and tests. `fixtures/connectors.json`: what `APP_CONNECTORS=fixtures` serves.
- `src/worker.ts` is a stub. Travel runs on Node only (`platforms: ["node"]` in app.config.ts).

## Database

Travel's writes are synchronous SQLite transactions through the core's `transaction(ctx, work)`, on the kit's own connection (`src/db/connection.ts`). That runs on Node only for now, so app.config.ts declares `platforms: ["node"]`.
- An action's synchronous body is `handler` in `act` (src/app.ts), and runs as one transaction. So do the `show_*` views, the @ menu, the source list and export.
- An action that waits on Ri is a `run` instead. It wraps each write in `t.mutate(() => …)` between the calls, never across one.
- A transaction inside another joins it, and rolls back with it. Never await inside one: the core refuses work that returns a promise.
- A statement outside any transaction runs as one of its own.
- Never open your own connection to `data.sqlite`, and never open the data directory from another process. Migrations still go through the kit (`application.migrations`).

The view revision is a counter moved by triggers, and booking search is an FTS5 index (`bookings_fts`). The kit's `backup` and `restore` keep both, and `tests/backup.test.ts` checks it, including a backup in the older format. `tests/transactions.test.ts` checks that a failure at the last write of each key write leaves nothing behind.

## Access

- The person's own browser and the app's jobs see everything (`kind: "owner"`).
- An assistant connection sees the sources chosen on the consent screen: `account:<address>`, `manual` and `imports`. It may write only if allowed. A connection allowed all sources is treated as the owner. Deleting an account's imported data marks it `deleted` and leaves it out of `sources.list` until it's resumed, so the core drops it from every connection's choice for good.
- Filter by access before assembling any list, search, count, snippet, export or context. Use `repo.bookings(scope, ...)`, `read.visibleTrip` and `reviewVisible`. Never return a record because it was named in input.
- Name a trip shown beside anything else with `read.tripTitle` or `read.tripHeading`, never `trip.title`.
- Review decisions, deletion, source management, settings and export call `requireOwner`.

## The hub

Travel reads Gmail, Calendar, PDFs (`ri__extract_text`), the model (`ri__ai_text`) and Ri tasks through the person's hub, by Ri's tool names (`HUB_TOOLS` in `src/lib/sources.ts`), with `hubFor(ctx)`. `failureKind` maps hub failures from the core's errors and Ri's `code` on them: `SetupRequired` (an account to reconnect or choose, with `accounts` for a choice), `SourceUnavailable`, `ConnectorError` (`not_found` for a deleted Ri task or a provider's 404 or 410). `providerStatus` gives the provider's status from the `httpStatus` Ri sends with `not_found` (dynamismlabs/ri#7), or from the "provider error 404" text an older hub sends. Calendar restarts its window only on 410 (an expired sync token). A 404 there means the calendar is gone. Gmail answers an expired history ID with 404, which rescans the window, and a message deleted after it was listed with 404, which drops it. When a hub offers only the kit's mail and calendar capabilities, Travel falls back to those adapters. Accounts come from the accounts Ri lent (`hub.accounts()`, the core's `connectors(ctx).accounts()`) in `createSources(t).discover`: with several, Ri's names; with one, the mailbox's own address or the primary calendar's id, so stored accounts keep their keys. Writes that reach Ri (tasks) wait for the person's approval: the follow-up stays pending, and the `follow_ups` job repeats the identical call.

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

Actions are data tools. `show_trip`, `show_trips` and `show_review` draw cards (`src/screens.tsx`), and a card opens the whole app at a trip, booking or Review. `open_travel` (from the kit) opens the whole app full screen, optionally at a path (`records.paths` in `src/app.ts`), and `src/main.tsx` follows the host there and to its later links. `records` also gives the host's @ menu trips and bookings.

Inside an assistant the view reaches nothing on the network; everything leaves through the kit's host calls in `src/ui/app.tsx`: Ask in chat drafts a question only where the host drafts (else it shows the question to copy), links and maps open through the host (else the address shows), Export saves through the host (else "Export in browser"), and Open in browser in the header goes to the same place in Travel's own page. Settings, beside it and on Sources, opens the kit's Settings inside the view (connections, the Ri link and automations) through the core's view-only `read_settings` and `change_settings`. Name no action of Travel's either of those. What the person is looking at reaches the assistant through `select` (the booking or trip), `selectMany` (ideas chosen to compare) and `setSection` (the place, its path and filters).

Person-only actions are `visibility: ["app"]` (`viewOnly` in `src/app.ts`): Review decisions, deleting, imports, export, sources and settings. A host that follows MCP Apps keeps them from the model; Travel's own checks (`requireOwner`, write access) still apply. Mark nothing else view-only.

## What assistants are told

`instructions` in app.config.ts goes to every assistant when it connects, and hosts may add it to the model's context: records only, local times with their zones, "No booking recorded", look before adding by hand, and what stays in Travel's own screen. Keep it to what holds across tools, never a tool's own description, and under 2,000 characters (the core refuses more). The `trip-check` prompt (`src/prompts.ts`) is a request the person picks in the assistant. It names the tools and reads nothing itself, so it can't show more than the connection may see. Its optional `trip` is the person's words for `list_trips`' search, quoted, and limited to that search's 200 characters. Without it the text is the same as before the argument. Change nothing in a prompt's `messages`. The contract test checks that every tool either names exists.

## Check a change

`pnpm typecheck`, `pnpm test`, `pnpm build`, then `pnpm test:view` for the browser checks. Use a disposable `APP_DATA_DIR`, never the person's data. Commit, then `pnpm exec app-builder change` (or `serve --install` the first time). Use `--service process` while developing; never install a launchd service from a development session.
