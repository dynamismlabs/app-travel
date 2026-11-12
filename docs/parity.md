# Travel: parity with Ri's Travel app

Ri's Travel app (`apps/travel` at Ri commit `3c442810`) ported onto App Builder, kit core 0.2.0 at kit commit `bc2c7f4`. This lists every feature and behavior from the old README, AGENTS.md, plugin.json and tests, and whether it works here.

- **Works**: same behavior on the new path.
- **Works differently**: the outcome is there, but reached another way. Says how.
- **Can't work**: not possible on the new path today. Says why, and what the kit or Ri would need.

## Summary

Nearly everything Travel did in Ri works on the new path. The domain logic, data model, screens and almost all tests came over unchanged: trips, itineraries in local time, bookings, Review, corrections, coverage, ideas, imports, Gmail and Calendar sync, the AI fallback, follow-ups and export.

**Four things can't work today:**
1. **"Ask Ri" and "What is missing?"** can't stage a question in the chat. The kit's view client has no way to send text to the host.
2. **Open directions, Open in Gmail and Export** don't work inside an assistant's frame. They work in Travel's own page. The kit's view client can't open links or save files.
3. **The person and the model can't be told apart.** Review decisions, deleting bookings and managing sources were for the person only in Ri. Now they're open to any connection allowed to see everything, and that includes its model. MCP Apps has app-only tools, but the kit doesn't support them.
4. **Travel can't run on Cloudflare.** Its writes need real transactions, which the kit's database API doesn't offer, so Travel opens its own synchronous connection on the Mac.

The rest of the findings are things Travel works around itself that the kit or Ri should fix; they're under "What the kit and Ri should change".

**How this was checked** (all with fictional data):
- 102 tests: `pnpm test`. The browser checks need a build and Chrome: `pnpm test:view`.
- `serve --install --service process` from a commit passed every step (install, typecheck, test, build, rehearse, switch). Release `773b8b97e403` answered `/api/health`.
- An outside MCP client (the MCP SDK's OAuth client) connected to that installed service. It went through the 401 challenge, discovery, registration, PKCE, Travel's consent screen with its sources, and the token. Then it listed tools, saved and listed a trip, drew `show_trips` and read the view resource.
- The view was checked in Chrome inside a strict MCP Apps host (scripts-only sandbox, page blocking all network). Travel's own page was checked at phone and desktop widths.
- Hub features were tested against the kit's own fixture source and job runner, and against a fake of Ri's hub with Ri's tool names.
- Ri itself wasn't run, as asked.

## Screens

| Feature | Status | Notes |
| --- | --- | --- |
| Trips: upcoming and past, dates, reservation counts, one attention summary each | Works | |
| One upcoming trip reopens it. Several reopen the last one viewed, else the list | Works | `open_view` places `/`, as before. |
| Trip: itinerary grouped by local date, with a day rail | Works | Checked in Chrome. |
| Trip: Bookings table, filtered by confirmed, planned, canceled or needs review, with search | Works | |
| Trip: Ideas tab | Works | |
| Booking inspector beside the itinerary when wide, its own screen with Back when narrow | Works | Checked at 390 px and 1300 px. |
| Review: reservations without a trip, changes and cancellations, duplicates, extracted details | Works | |
| Review compares recorded and proposed values with the source before anything changes | Works | "Use 16:00" checked in Chrome. |
| Sources: accounts, imported files, history range, coverage, last update, pending and failed counts, pause, continue import, delete imported data | Works differently | Accounts are the ones Ri's hub lets Travel read. Sources asks Ri when it opens, and has "Check Ri for accounts". |
| Sources: chats with access | Works differently | Each assistant connection and its access is in the kit's Settings, at `/settings`. Choices are made on Travel's consent screen when a place connects. Sources points there. |
| Sources: Travel settings (home zone, your names, AI fallback) | Works | |
| Calendars to check, per calendar account | Works | |
| Add booking: paste, file, or the manual form | Works | Paste-and-apply on an empty install checked in Chrome. |
| Picking a file inside an assistant's frame | Works differently | A file input in the frame. Not checked inside a real host's sandbox. In Travel's own page it works. |
| Location kept in the host's address, so reopening returns to the same place | Works differently | In Travel's own page the browser address keeps the place, with Back and Forward. Inside an assistant the place lives in memory, so reopening the view starts at `/`. The kit gives views no address. |
| Back closes a booking opened beside the itinerary | Works | |
| Neutral palette, light and dark | Works | Inside an assistant the host's style variables come first. No `color-scheme`, per the kit's rule. |
| Copy has no long dashes or semicolons | Works | Tested over every generated text and tool description. |
| "Ask Ri" button (stage a question about a booking in the chat, never send) | **Can't work** | The kit's view client doesn't expose MCP Apps' `ui/message`. The button is hidden. Needs a kit `client.sendMessage` (or "stage") mapped to `ui/message`, and Ri's host honoring it. |
| "What is missing?" prompt for a trip or day | **Can't work** | Same reason as Ask Ri. The data side works: `describe_view_context` gives a chat the "No booking recorded" coverage. |
| Open directions (external map through Ri) | **Can't work inside an assistant** | Works in Travel's own page, which opens Google Maps in a new tab. Inside an assistant it's hidden: the kit's client doesn't expose `ui/open-link`, and the frame can't open windows. Needs a kit `client.openLink`. |
| Open in Gmail, from a source | **Can't work inside an assistant** | Same as Open directions. |
| Export a trip as CSV or JSON, downloaded | **Can't work inside an assistant** | Download works in Travel's own page. `export_trip` still returns the text to any full-access connection. Inside an assistant the Export menu is hidden: the kit has no download path for views. |
| Ri's "Try" preview with fictional trips | Works differently | `pnpm preview` runs Travel on a new data directory, with Alex Rivera's fictional trips and the fixture hub. `TRAVEL_PREVIEW=fictional` does the same for any server. No account is read. |
| Catalog demo rows (Day, Time, Item, Status) | Works differently | The kit has no catalog entry format. The shared spec's catalog lists apps by git URL and version. |

## Cards and the assistant's view (new on this path)

| Feature | Status | Notes |
| --- | --- | --- |
| `show_trip`: a trip's itinerary by local day, coverage prompts and Review count | Works | New. Checked in the strict host. |
| `show_trips`: trips with dates and attention | Works | New. |
| `show_review`: what waits in Review | Works | New. Decisions happen in the full app. |
| `open_travel` opens the whole app full screen | Works | Added by the kit. Checked in the strict host. |
| Selection reaches the chat | Works differently | The kit's bounded selection carries the selected booking, or the trip, as id and title. Ri's view context carried the section, day, tab, filters, selected records and their revisions. A model can ask `describe_view_context` for the rich description of a place, re-resolved under its own access. |
| The view never reaches the network | Works | Checked: no request left the frame. |

## Time

| Behavior | Status | Notes |
| --- | --- | --- |
| Each segment keeps local wall time, IANA zone and resolved instant | Works | |
| Overnight journeys appear on both local dates with zone labels (17:55 MST, 08:40 WET next day) | Works | |
| A hotel is a date span with an exclusive check-out | Works | |
| All-day items use dates, never midnight timestamps | Works | |
| A time in a DST gap moves forward and says so; a repeated hour uses the earlier one and says so | Works | |
| A time without a zone has no instant, is placed by local time, is marked and never used for overlaps | Works | |
| Sorted by instant where known, then local order, with a stable tie-breaker | Works | |
| Zone labels such as WET | Works differently | Node 24 on this Mac names Lisbon "GMT" in en-US, where Ri's Node said "WET". Travel now prefers a regional abbreviation over plain GMT, so labels read the same on every runtime (`src/lib/time.ts`). |

## Inputs

| Input | Status | Notes |
| --- | --- | --- |
| Gmail: 30, 90 or 365 days of history, default 90 | Works | |
| Gmail: search for confirmations from airlines, hotels, rail, car rental and booking platforms, by subject terms | Works | Same query, sent to Ri's `gmail__search_messages`. |
| Gmail: new mail checked against its headers before a body is read | Works | |
| Gmail: history sync, deletions, moves to Trash and back | Works | Ri's `gmail__list_history` through the hub. |
| Gmail: history expiry rescans the window, never the whole mailbox | Works | Ri reports an expired history only as text ("provider error 404"). Travel reads the status from the message. |
| Gmail through Ri's hub instead of Ri's per-invocation capabilities | Works differently | Travel calls Ri's tools by name through the kit's connector client (`connectors(ctx).call`), with its own OAuth token for the hub. The kit's mail adapter returns only plain text, and Travel needs Gmail's MIME parts for attachments, invitations and HTML. |
| Booking attachments: a PDF read through Ri's `extract_text` when the body has no details | Works | Ri's `gmail__get_attachment` and `ri__extract_text`. |
| Calendar invitations in mail: zones, and a suggested booking | Works | |
| Google Calendar: chosen calendars read for events while away. Nothing is written | Works | Ri's `google_calendar__sync_events`, with sync tokens and expiry. |
| A hub that offers only the kit's mail and calendar capabilities | Works differently (new) | Travel falls back to the kit's adapters: search and plain text, and the calendar window. There is no deletion tracking, attachments or invitations then. This is how it runs on the kit's fixture source. |
| File: PDF (through Ri's `extract_text`), text, HTML and saved email, up to 512 KB, previewed first, original kept | Works | |
| Paste any confirmation text, previewed first | Works | |
| Manual form: flights, trains, stays, car rentals, activities | Works | |
| Several Gmail or Calendar accounts | Works differently | Ri's grant decides which accounts. The kit's connector client can't list them. With one account, Travel reads its address (`gmail__get_profile`, or the primary calendar's id). With several, it reads the names from Ri's "Choose which account to use (a, b)" message. See finding 5. |
| Per-account "automatic updates" set in Ri | Works differently | Ri's hub grant has no automatic flag: a granted account works the same from a button, a job or a chat (shared spec, Decision 3). Every account Ri grants updates on Travel's job. The person pauses an account in Travel. Ri's "Found in this account: … Check it before turning on automatic updates" notice no longer appears, since accounts start updating on their own. |
| Microsoft accounts, live fares, flight status, maps, weather, booking or cancelling, shared editing, passports | Not part of Travel | Same as in Ri. |

## Extraction

| Behavior | Status | Notes |
| --- | --- | --- |
| Deterministic first: flight numbers, airlines, IATA airports, local times, references, travelers, hotels, addresses, check-in and out, cars, trains, activities and restaurants, Portuguese, Spanish, French and German month names | Works | Parser unchanged. 14 parser tests pass. |
| Optional AI fallback, off by default, using Ri's model | Works | `ri__ai_text` through the hub. Same bounded prompt, strict schema and exact passages. |
| AI suggestions always wait in Review | Works | |
| "Extraction unavailable" when AI is off or unavailable, everything else keeps working | Works | Also when Travel isn't connected to Ri, or Ri doesn't allow the model. |
| Invalid or partial extraction leaves a reviewable source, never a fabricated booking | Works | |

## Rules

| Rule | Status | Notes |
| --- | --- | --- |
| Grouping: source first, then provider, reference, travelers and dates. A reference alone is never a global id | Works | |
| Several possible bookings, several travelers, a forwarded confirmation, someone else's booking or overlapping trips go to Review | Works | |
| A matching provider confirmation updates the booking with a visible change record | Works | |
| A change to a field you corrected waits in Review. Your correction stays until you choose | Works | |
| A cancellation needs matching reservation evidence, keeps the booking in history and leaves a gap | Works | |
| A message deleted upstream marks its source unavailable and never cancels | Works | |
| Gaps: uncovered nights within trip dates and overlapping timed bookings. A rental counts at pick-up and return only | Works | |
| A dismissed gap holds until the bookings around it change | Works | |
| "No booking recorded" wording | Works | |
| Ideas never count as confirmed | Works | |
| Prices are integer minor units with their currency, never converted or added | Works | |
| Compare shows known values and "Not provided", with no ratings or rankings | Works | |

## Actions

Every old action is a kit action. Unless noted, each is an MCP tool and also callable from Travel's own page.

| Ri action | Here | Status |
| --- | --- | --- |
| `list_trips`, `get_trip`, `list_bookings`, `get_booking`, `list_ideas`, `compare_ideas`, `list_review_items`, `list_follow_ups`, `get_evidence` | Same names | Works |
| `save_trip`, `save_booking`, `save_idea` | Same names | Works differently: creates take `newId`, a UUID the caller makes, so a retry returns the same record. Ri kept a receipt per invocation. MCP has no invocation ids. |
| `delete_booking` | Same name | Works differently: a full-access connection can call it too, not only the person (see "Data access"). A retried delete gets "not found" rather than the first result. |
| `review_change` | Same name | Works differently: a full-access connection can call it too, not only the person. A retry gets the conflict answer with the current item, instead of the first result. |
| `dismiss_gap`, `create_follow_up`, `check_follow_up` | Same names | Works (follow-ups: see below) |
| `preview_import`, `apply_import` | Same names | Works differently: open to any connection allowed to change imported files, not only the person's page. Ri's old code enforced the same scope rule (`imports`). `apply_import` still applies a preview once. |
| `export_trip` | Same name | Works differently: a full-access connection can also read the export as text. |
| `open_view` | Same name | Works differently: Travel's own screen calls it to place an address. It's no longer the host's opener: `open_travel` (kit) opens the app, and the `show_*` cards draw parts of it. |
| `describe_view_context` | Same name | Works differently: a tool a chat can call with a path and selection. Ri called it for the view's context. The kit sends the bounded selection instead. |
| `list_sources`, `setup_source`, `list_calendars`, `pause_source`, `delete_source_data`, `continue_import`, `save_settings`, `remember_view` | Same names | Works differently: open to the person and to a full-access connection. In Ri they were for the person's view only (`visibility: app`). |
| `create_scope`, `list_scopes`, `revoke_scope` | Gone | Works differently: the kit's consent screen sets each connection's sources and write access. Settings lists and disconnects connections. |
| `run_background_step`, `sync_step`, `enrich_step` (Ri's schedule) | `sync_sources`, run by the declared job `sync_sources` every 5 minutes | Works differently: the app runs its own job. Each run takes up to 8 bounded steps in 50 seconds, picking accounts fairly. It's not offered over MCP. |
| (new) `check_accounts` | Asks Ri which accounts Travel may read | New |
| (new) `retry_follow_ups` | Run by the declared job `follow_ups` | New: see follow-ups |
| (new) `show_trip`, `show_trips`, `show_review`, `open_travel` | Cards and the whole app | New |

## Follow-ups (Ri tasks)

| Behavior | Status | Notes |
| --- | --- | --- |
| Create one Ri task linked to a trip, booking, idea or review item, with an optional due date. Nothing is sent | Works differently | Through the hub's `ri__create_task`, with an operation id, so a retry returns the same task. Ri's hub as built asks the person to approve every app write, including a task, so the first answer is "Waiting for your approval in Ri". Travel saves the follow-up as pending. Its `follow_ups` job repeats the identical call every 5 minutes. While a run waits, the kit's runner re-checks the grant and retries every 2 minutes, inside Ri's 5-minute single-use approval. The dialog says "Waiting for approval" rather than "Created". The shared spec says writes to the person's own data should follow their normal settings, so this may become immediate again. Tested with the fake hub and with the kit's fixture source and runner. |
| Retries and second clicks return the same task | Works | Same operation id. |
| Not allowed: asks for permission and keeps the same operation | Works | "Allow 'Add tasks' for Travel in Ri." |
| Check whether a linked task still exists | Works | `ri__get_task`. The kit's client drops Ri's `not_found` code, so Travel reads Ri's message (finding 7). |

## Data access

| Behavior | Status | Notes |
| --- | --- | --- |
| The owner's view sees everything | Works | The person's own browser, and the app's jobs. |
| A chat sees only the accounts and collections shared with it (`account:<id>`, `manual`, `imports`) | Works differently | Per connection, chosen on Travel's consent screen when a place connects (a Ri workspace, Claude, ChatGPT), and enforced on every call. The sources offered are the same keys. Verified over real OAuth. |
| Read-only versus write access | Works | The kit refuses writes for a read-only connection with its own message. |
| A booking is visible only when all its contributing sources are shared | Works | |
| A trip from an unshared source shows only through the shared bookings in it, without its title or notes | Works | |
| Trip names in reviews, previews, results and history follow the caller's projection | Works | |
| Review reasons never name another booking or trip | Works | |
| A narrower caller's revision doesn't move when others change things | Works | |
| The scheduled job reads only its own automatic accounts and reads no records | Works differently | Jobs run as the installation's owner, which the kit decides. The hub limits them to the accounts Ri granted. They read records to match and place bookings. |
| Owner-only: source management, scope creation, review decisions, deletion | **Can't work as before** | Ri told the person's view apart from a chat. Inside an assistant, Travel's view calls tools with the same connection token as the chat's model, and the kit has no app-only tools. So these need "the owner": the person's own browser, or a connection allowed to see everything. That connection's model can also call them. `review_change`'s description asks the model to decide only when the person asked for that exact decision. Needs kit support for MCP Apps' `_meta.ui.visibility: ["app"]`, and Ri honoring it. A limited connection's view in Ri shows Review read-only. |
| A retried write returns its first result only while the caller's access is unchanged | Works differently | No invocation receipts. Creates replay by `newId` and are shown under the caller's current access, so a narrower caller never sees what it can't. |
| Deleting an account's data removes it from every chat scope that shared it | Works differently | Connection choices belong to the kit, and Travel can't edit them. Deleting the data pauses the account. A connection that chose that account sees it again only if the person resumes and it re-imports. Needs a kit hook to forget a source in connection choices, if this matters. |
| Revoked scopes refuse further calls | Works | The kit: disconnecting in Settings, or an expired token, gets 401. |

## Limits and bounded work

| Behavior | Status | Notes |
| --- | --- | --- |
| One mail page and at most ten bodies per step, within 20 seconds | Works | |
| One calendar page per step | Works | |
| Enrichment reads at most three saved sources per step | Works | |
| Fair rotation between accounts, and kinds alternate | Works | |
| Backoff after failures, idle wait after a finished page | Works | Travel's own per-account queue, inside the kit's job. |
| Interrupted step resumes from its committed checkpoint | Works | Records and checkpoint commit in one transaction, as in Ri. |
| Ri unreachable: retry later, keeping the checkpoint | Works | The job run is "retrying" in the kit's runner. Tested on the kit's fixture source. |
| Travel's hub connection revoked: setup state, records kept | Works | The run fails with "Ri needs you to connect this app again." Settings says so. |
| One account must sign in again in Ri: that account shows "Reconnect this account in Ri" | Works differently | Ri answers with `authorization_required` as a normal result, which the kit passes through as success. Travel treats it as a setup state itself (finding 6). |
| Travel not connected to Ri at all | Works | Everything except mail, calendar, PDFs, the model and Ri tasks works. Sources says to connect in Settings. |
| Files up to 512 KB, text kept up to 64,000 characters, previews expire after an hour | Works | |

## Plumbing (what Ri provided, and what replaced it)

| Ri | Here | Status |
| --- | --- | --- |
| Runtime: Ri started the app on demand over its private IPC | The kit's Node server, run as the person's service (`serve --install`) | Works differently |
| Records in `records.db` in Ri's instance folder (`node:sqlite`) | The kit's `data.sqlite`, with Travel's tables in kit migration `app-0001` | Works differently. Same data model. Ri's three migrations are one, since no old data exists. Ri's third migration only rewrote first-release review reasons, so it isn't carried and its test is dropped. |
| Synchronous transactions for every write | Travel's own synchronous connection to the kit's `data.sqlite` | **Works, but Node only** (finding 1) |
| Content-addressed evidence files in a blobs folder | A `travel_blobs` table in the same database | Works differently: files commit with the records that cite them, and travel with backups and change snapshots. |
| `@ri/app-kit` data, sources, time and UI | Moved into Travel (`src/lib`, `src/ui`) | Works differently |
| `plugin.json` requests: Gmail, Calendar and Ri actions | The application's `connectors`: purpose, `mail.read`, `calendar.read` and Ri's tool names. Ri's consent screen pre-ticks them. | Works differently |
| Ri asked the person to grant accounts per app | Travel connects to Ri's hub once, from Settings, with OAuth | Works differently. Not run against Ri's real hub here. |
| `contract.json` for Ri's package format | The kit's `dist/contract.json` and MCP tool list | Works differently |
| Entities with open paths (deep links) | None | Works differently: addresses `/trips/<id>` and `/bookings/<id>` work in Travel's own page. The kit adds no `openai/deepLink`. |
| Bundled skill `trip-check` | Kept in `skills/trip-check` | Works. Nothing loads it automatically: the kit has no skill format for apps. It's guidance for an assistant that reads Travel's tools. |
| Error codes for Ri (`not_found`, `forbidden`, `conflict`, …) | Kit errors with Travel's own messages | Works |

## What the kit and Ri should change

Ordered by impact. None was worked around in the kit or Ri; each is handled inside Travel or listed above as can't work.

1. **Transactions (kit).** The kit's database API is async and D1-compatible, with atomic batches but no transaction that can read inside it. Travel's writes read, decide and write together: match a confirmation, then create, merge or send to Review, with history and the import checkpoint, all or nothing. Rewriting them as batches would have changed the logic, not just the plumbing. So Travel opens a second, synchronous better-sqlite3 connection to the kit's own `data.sqlite`, in the same process. It uses the same SQLite library copy as the kit, checked. The cost: Travel runs only as a Node service, and its Worker build is a stub that says so. The kit's build always produces a Worker, with no way for an app to say it's Node-only. **Kit option:** a `transaction(ctx, work)` on Node that runs on the kit's own connection, or a supported way to get that connection, plus a way to declare an app Node-only.
2. **App-only tools (kit, then Ri).** MCP Apps lets a tool be callable by the view but hidden from the model (`_meta.ui.visibility`). The kit doesn't support it, so the person's clicks and the chat's model can't be told apart. That's why Review decisions, deletion and source management now open to any full-access connection. **Kit:** declare actions as view-only. **Ri:** honor it in the host.
3. **Messages, links and downloads from a view (kit, then Ri).** The kit's client exposes `select`, `didChange` and full screen, but not `ui/message`, `ui/open-link` or a download. This is what makes Ask Ri, What is missing, Open directions, Open in Gmail and Export unavailable inside an assistant.
4. **Approvals for an app's own-data writes (Ri).** The hub asks for every app write, including creating a Ri task. The approval has no id, and is single-use within 5 minutes. Travel copes through its job and the kit's runner. The shared spec says own-data writes should follow the person's normal settings, and that approvals should carry an id with a generous window. Branch `claude/single-path-ri-approval-id` may already do some of this.
5. **Which accounts an app may use (kit and Ri).** The hub names the granted accounts only in a tool's `account` description, or in a `choose_account` answer. The kit's client returns tool names only, and turns `choose_account` into a message string. Travel parses "Choose which account to use (a, b)". **Kit:** expose the accounts, for example `connectors(ctx).accounts(capability)` or structured data on `SetupRequired`. **Ri:** could also list the granted accounts.
6. **Status answers passed as success (kit).** Ri's hub answers `authorization_required`, `additional_permission_required` and `choose_connection_method` without `isError`. The kit maps only `approval_required` and `choose_account`, so the others reach the app as results. Travel maps them to setup states itself. The kit should too.
7. **Error codes dropped (kit and Ri).** Ri's model-safe outcome leaves out the provider's HTTP status, so a deleted message or an expired sync token is only "provider error 404 for GET …" in text. The kit's client also drops Ri's `code` (such as `not_found` from `ri__get_task`) and keeps only the message. Travel matches on text. **Ri:** include `not_found` or `gone`. **Kit:** keep `code` on the error it throws.
8. **The kit's fixture source is narrow.** It serves the mail and calendar capabilities and fixed results by tool name. It can't stand in for Ri's history, full messages, attachments or sync tokens. Its mail search understands plain words only, so a Gmail query with `{a b}` groups matches nothing. Travel tests Ri's fuller tools with its own fake hub, and the capability path with the kit's fixture source.
9. **Smaller kit notes.**
   - The Node server isn't built with `NODE_ENV=production`, so tRPC error responses include stack traces with file paths. Seen under `app-builder serve`.
   - There's no way to hand a view its starting address, so reopening Travel inside an assistant starts at `/`.
   - Travel's tool list is 35 tools and 185 KB, and its view resource is about 1 MB. Ri's per-chat tool loading keeps the list out of chats until needed.
   - A `show_*` card's `data` is validated against its full output schema. Travel reuses its detailed trip schema, so cards are large but exact.
   - `create` defaults every app to port 4310. Travel uses 4334.

## Tests

| Old suite (92 tests) | New suite (102 tests) | Notes |
| --- | --- | --- |
| domain (19) | domain (19) | Unchanged |
| parse (14) | parse (14) | Unchanged |
| workflow (20) | workflow (22) | The invocation-retry assertion became "a retry returns the first result as already applied". New permission copy. Added: waiting for approval, then the job's identical call. The preview test seeds with `seedPreview` instead of Ri's fixture principal. |
| sync (17) | sync (18) | Accounts come from the fake hub's grant, with Ri's tool names. Account labels are the names Ri shows. Every granted account is automatic. Reconnect and removal go through `check_accounts`. Fair rotation runs through the `sync_sources` job. Added: not connected to Ri. |
| scope (15) | access (11) | Scopes became connections with chosen sources. "Revoked scope" and "no scope" moved to the kit's OAuth (`mcp.test.ts`) and an empty source list. "Job limited to its accounts" is now the hub's grant. "Access view" is now the consent screen's sources. The three replay tests became one retried-create test. The stored-reasons migration test is dropped (no old data). |
| contract (5) | contract (5) | Checks the kit's contract and MCP tools instead of Ri's package format. |
| view (2, Ri's packaged view in Chrome) | browser (6) | Cards and the full app in a strict MCP Apps host. Travel's own page at narrow and wide widths: booking, accept a change, compare ideas, add a pasted booking. Ask Ri staging isn't tested, since it isn't offered. |
| none | MCP with OAuth (3) | The real server, with the MCP SDK's OAuth client and sources chosen on consent. |
| none | kit fixture source (4) | Import through the kit's capabilities on the kit's runner, PDF through `ri__extract_text`, approval wait across the runner, Ri down and connection revoked. |

## Not checked here

- Travel connected to Ri's real hub: its consent screen, a real Gmail account, real approvals. Ri wasn't run, as asked. The hub client was exercised with the kit's fixture source and a fake of Ri's hub built from Ri's code (branch `claude/single-path-ri-hub`).
- Ri, Claude or ChatGPT drawing Travel's view. Checked in a strict test host only.
- A real launchd service. `--service process` only, as asked.
- A file picker inside a real host's sandboxed frame.
