# Travel: parity with Ri's Travel app

Ri's Travel app (`apps/travel` at Ri commit `3c442810`) ported onto App Builder. Ported November 12 on kit core 0.2.0; moved November 16 to core 0.2.2 (kit `main` at `1713f6a`), which added the full app in every host (shared spec §5). This lists every feature and behavior from the old README, AGENTS.md, plugin.json and tests, and whether it works here.

- **Works**: same behavior on the new path.
- **Works in hosts**: works inside an assistant too, verified in the kit's strict test host (a scripts-only sandbox, no network, and Ri's rules for visibility, drafts, links, files and host links). The real Ri, ChatGPT and Claude check is the next step, so these say "real hosts pending".
- **Works differently**: the outcome is there, but reached another way. Says how.
- **Blocked**: not possible on the new path today. Says why: a kit gap, or a host's own rule.

## Summary

Everything Travel did in Ri works on the new path except one thing. The domain logic, data model, screens and almost all tests came over unchanged: trips, itineraries in local time, bookings, Review, corrections, coverage, ideas, imports, Gmail and Calendar sync, the AI fallback, follow-ups and export.

On core 0.2.2 the whole app also works inside an assistant, verified in the kit's strict test host: Ask in chat, links and maps out, Export, Open in browser, opening at a trip or booking, the @ menu, and the person's own decisions kept from the model. Real hosts are the next check.

**Still blocked:**
1. **Travel can't run on Cloudflare** (kit gap). Its writes need transactions that read and write together, which the kit's database API doesn't offer, so Travel keeps its own synchronous connection on the Mac.
2. **Export inside Ri** (Ri's host). Ri doesn't save files from a view yet ([dynamismlabs/ri#2](https://github.com/dynamismlabs/ri/pull/2)). Until it does, Travel offers "Export in browser" there. It works in a host that saves files.
3. **A host that ignores tool visibility** (that host's rule). Review decisions, deleting, imports and settings are view-only. A host that doesn't honor that would let its model call them. Travel's own access checks still apply. Ri honors it. ChatGPT and Claude are part of the real-host check.

The other findings are things Travel works around itself that the kit or Ri should fix; they're under "What the kit and Ri should change".

### What moved on core 0.2.2

| Line | Was | Now |
| --- | --- | --- |
| "Ask Ri" button | Can't work | Works in hosts: drafted in the chat where the host drafts, shown to copy elsewhere |
| "What is missing?" and the other questions for the chat | Can't work | Works in hosts, the same way |
| Open directions | Can't work inside an assistant | Works in hosts: opened through the host, or the address shows to copy |
| Open in Gmail | Can't work inside an assistant | Works in hosts, the same way |
| Export, downloaded | Can't work inside an assistant | Works in hosts that save files. Blocked in Ri until its host saves files; "Export in browser" there |
| Owner-only: review decisions, deletion, source management | Can't work as before | Works in hosts: view-only, kept from the model by the host |
| `delete_booking`, `review_change`, imports, export, sources and settings actions | Open to a full-access connection's model | View-only |
| Location kept in the host's address | Works differently: reopening started at `/` | Works in hosts: `open_travel` opens at a place, and host links move it |
| Selection reaches the chat | Works differently: only one record's id and title | Works in hosts: the place, its path and filters, the selected booking or trip, and the ideas chosen to compare |
| Entities with open paths (deep links) | None | Works in hosts: `records`, `open_travel`'s path, host links and the @ menu |
| Sources: chats with access | Works differently, no way to Settings from a host | Works differently: "Open Settings in browser" from a host |
| Follow-ups waiting for approval | 5-minute single-use approval, retried every 2 minutes | Ri's approval IDs: an approved call stays open 24 hours; a declined one stops |
| Kit findings 2 and 3 (app-only tools; messages, links and downloads) | Open | Closed by the kit. Finding 4 partly closed (approval IDs). Finding 9's "no starting address" closed. |

**How this was checked** (all with fictional data):
- 106 tests in 9 files: `pnpm test`, run two files at a time. The browser checks need a build and Chrome: `pnpm test:view`.
- The core upgrade ran through the kit's `upgrade --core ~/dynamism/app-builder --json`. Travel isn't installed as a service, so it only type-checked and tested. Its tests stopped it once: the fictional November trips had turned past on the real date, and the kit's approval timing had changed. Both are fixed in Travel, and the upgrade commit was then taken as it was.
- On core 0.2.0, `serve --install --service process` passed every step and an outside MCP SDK client did the full OAuth flow against the installed service. Not repeated on 0.2.2; the in-process OAuth test passes on it.
- The view ran in Chrome inside the kit's strict test host (`tests/support/view-host.ts`, the kit's `browser-host.ts`), matching the kit's own host tests. Travel's own page was checked at phone and desktop widths.
- Hub features were tested against the kit's own fixture source and job runner, and against a fake of Ri's hub with Ri's tool names.
- Ri, ChatGPT and Claude weren't run.

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
| Sources: chats with access | Works differently | Each assistant connection and its access is in the kit's Settings, at `/settings`. Choices are made on Travel's consent screen when a place connects. Sources points there, and inside an assistant offers "Open Settings in browser". |
| Sources: Travel settings (home zone, your names, AI fallback) | Works | |
| Calendars to check, per calendar account | Works | |
| Add booking: paste, file, or the manual form | Works | Paste-and-apply on an empty install checked in Chrome. |
| Picking a file inside an assistant's frame | Pending (host's rule) | A file input in the frame. Whether a host's sandbox allows picking a file is the host's rule, so it's part of the real-host check. In Travel's own page it works, and Open in browser gets there from any host. |
| Location kept in the host's address, so reopening returns to the same place | Works in hosts: verified in the test host; real hosts pending | In Travel's own page the browser address keeps the place, with Back and Forward. Inside an assistant, `open_travel` opens at a path (`/trips/<id>`, `/bookings/<id>`, `/ideas/<id>`, `/review`) and the view follows the host's later links there. Opening from the app list starts at `/`, which reopens the one upcoming trip or the last one viewed, as in Ri. |
| Back closes a booking opened beside the itinerary | Works | |
| Neutral palette, light and dark | Works | Inside an assistant the host's style variables come first. No `color-scheme`, per the kit's rule. |
| Copy has no long dashes or semicolons | Works | Tested over every generated text and tool description. |
| "Ask Ri" button (stage a question about a booking in the chat, never send) | Works in hosts: verified in the test host; real hosts pending | Now "Ask in chat": `client.draftMessage`, `ui/message` with `openai/message` `send: false`, only in a host that drafts (Ri does). A host that can't shows the question to copy. Travel's own page has no chat, so no button. Checked: the draft arrives unsent, and nothing is sent in a host without drafts. |
| "What is missing?" prompt for a trip or day | Works in hosts: verified in the test host; real hosts pending | Same as Ask in chat, for the trip, a day, a gap, an idea, a Review item and a calendar event. `describe_view_context` gives the chat the "No booking recorded" coverage to answer with. |
| Open directions (external map through Ri) | Works in hosts: verified in the test host; real hosts pending | Through the host's `ui/open-link`, in the person's browser. A host that can't, or refuses the link, gets the map address to copy. In Travel's own page, a new tab. Checked all three. |
| Open in Gmail, from a source | Works in hosts: verified in the test host; real hosts pending | Same as Open directions. |
| Export a trip as CSV or JSON, downloaded | Works in hosts: verified in the test host; real hosts pending, except Ri today | Through the host's `ui/download-file`, the file embedded (checked: `travel-lisbon.csv` arrives). A host without save-file gets "Export in browser" instead, which opens the same trip in Travel's own page. **Blocked in Ri (host):** Ri's host doesn't save files from a view until [dynamismlabs/ri#2](https://github.com/dynamismlabs/ri/pull/2) merges. In Travel's own page, an ordinary download. |
| Ri's "Try" preview with fictional trips | Works differently | `pnpm preview` runs Travel on a new data directory, with Alex Rivera's fictional trips and the fixture hub. `TRAVEL_PREVIEW=fictional` does the same for any server. No account is read. |
| Catalog demo rows (Day, Time, Item, Status) | Works differently | The kit has no catalog entry format. The shared spec's catalog lists apps by git URL and version. |
| Open in browser (new) | Works in hosts: verified in the test host; real hosts pending | In the header inside an assistant and in every card's footer, through the host's open-link, at the place the person is in. Not offered where the address can't be reached (a phone, for an app on this Mac) or the host can't open links. Checked: it opens `http://127.0.0.1:<port>/trips/<id>?selected=<booking>`. |

## Cards and the assistant's view (new on this path)

| Feature | Status | Notes |
| --- | --- | --- |
| `show_trip`: a trip's itinerary by local day, coverage prompts and Review count | Works in hosts: verified in the test host; real hosts pending | New. "Open this trip", and each entry opens the whole app at its booking. |
| `show_trips`: trips with dates and attention | Works in hosts: verified in the test host; real hosts pending | New. A trip opens the whole app there. |
| `show_review`: what waits in Review | Works in hosts: verified in the test host; real hosts pending | New. "Open Review" opens the whole app there, where the person decides. |
| `open_travel` opens the whole app full screen, at a place when given | Works in hosts: verified in the test host; real hosts pending | Added by the kit. Checked at a booking, and following a host link to another booking. |
| The host's @ menu offers trips and bookings | Works in hosts: verified in the test host; real hosts pending | New: `records` in `src/app.ts`. `search_mentions` is view-only and read-only; a chosen record is read as the connection (`app://travel/trips/<id>`), so it never shows what the connection can't see. |
| Selection reaches the chat | Works in hosts: verified in the test host; real hosts pending | The place (for example "Lisbon trip, November 9 to 14, 2026"), its path and filters (tab, day, status, search), the selected booking or trip, and the ideas chosen to compare as several records. This is what Ri's view context carried, except record revisions. `describe_view_context` still gives a chat the rich description of a place, re-resolved under its own access. |
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
| `delete_booking` | Same name, view-only | Works: the person's, from Travel's screen, kept from the model by the host. A retried delete gets "not found" rather than the first result. |
| `review_change` | Same name, view-only | Works: the person's, from Travel's screen, kept from the model by the host. A retry gets the conflict answer with the current item, instead of the first result. |
| `dismiss_gap`, `create_follow_up`, `check_follow_up` | Same names | Works (follow-ups: see below) |
| `preview_import`, `apply_import` | Same names, view-only | Works: the person's, from Travel's screen in any connection allowed to change imported files, the scope rule Ri's code enforced (`imports`). `apply_import` still applies a preview once. |
| `export_trip` | Same name, view-only | Works |
| `open_view` | Same name, view-only | Works differently: Travel's own screen calls it to place an address. It's no longer the host's opener: `open_travel` (kit) opens the app, at a place when given, and the `show_*` cards draw parts of it. |
| `describe_view_context` | Same name | Works differently: a tool a chat can call with a path and selection. Ri called it for the view's context. The kit now sends the place and selection itself. |
| `list_sources`, `setup_source`, `list_calendars`, `pause_source`, `delete_source_data`, `continue_import`, `save_settings`, `remember_view`, and the new `check_accounts` | Same names, view-only | Works: the person's, from Travel's screen, as in Ri (`visibility: app`). Also need a connection allowed to see everything. |
| `create_scope`, `list_scopes`, `revoke_scope` | Gone | Works differently: the kit's consent screen sets each connection's sources and write access. Settings lists and disconnects connections. |
| `run_background_step`, `sync_step`, `enrich_step` (Ri's schedule) | `sync_sources`, run by the declared job `sync_sources` every 5 minutes | Works differently: the app runs its own job. Each run takes up to 8 bounded steps in 50 seconds, picking accounts fairly. It's not offered over MCP. |
| (new) `check_accounts` | Asks Ri which accounts Travel may read | New |
| (new) `retry_follow_ups` | Run by the declared job `follow_ups` | New: see follow-ups |
| (new) `show_trip`, `show_trips`, `show_review`, `open_travel` | Cards and the whole app | New |
| (new) `search_mentions` | The host's @ menu (added by the kit from `records`) | New, view-only |

## Follow-ups (Ri tasks)

| Behavior | Status | Notes |
| --- | --- | --- |
| Create one Ri task linked to a trip, booking, idea or review item, with an optional due date. Nothing is sent | Works differently | Through the hub's `ri__create_task`, with an operation id, so a retry returns the same task. When Ri asks the person to approve it, the first answer is "Waiting for your approval in Ri" with an approval ID. Travel saves the follow-up as pending and its `follow_ups` job repeats the identical call. While a run waits, the kit's runner re-checks the grant and tries again every 5 minutes for the first hour, then every 30. Ri keeps an approved call open for 24 hours. The dialog says "Waiting for approval" rather than "Created". If Ri creates it at once, it's created at once. Tested with the fake hub and with the kit's fixture source and runner. |
| The person declines the task in Ri | Works | New on core 0.2.2: the follow-up fails with "You declined this task in Ri", and the job never asks again on its own. |
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
| Owner-only: source management, scope creation, review decisions, deletion | Works in hosts: verified in the test host; real hosts pending | These are view-only (`visibility: ["app"]`): the host keeps them out of the model's tool list and refuses the model's call, while Travel's screen still calls them. Checked: the model's call to `review_change` is refused, and "Use 16:00" works from the view. They also still need "the owner": the person's own browser, or a connection allowed to see everything, so a limited connection's view shows Review read-only. **Blocked in a host that ignores visibility (that host's rule):** its model could call them, within Travel's own checks. Ri honors visibility. |
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
| Kit updates | The kit's `upgrade --core` | Works: core 0.2.0 to 0.2.2 through the safe-change checks. |
| Records in `records.db` in Ri's instance folder (`node:sqlite`) | The kit's `data.sqlite`, with Travel's tables in kit migration `app-0001` | Works differently. Same data model. Ri's three migrations are one, since no old data exists. Ri's third migration only rewrote first-release review reasons, so it isn't carried and its test is dropped. |
| Synchronous transactions for every write | Travel's own synchronous connection to the kit's `data.sqlite` | **Works, but Node only.** Blocked on Cloudflare (kit gap, finding 1). Still needed on core 0.2.2. |
| Content-addressed evidence files in a blobs folder | A `travel_blobs` table in the same database | Works differently: files commit with the records that cite them, and travel with backups and change snapshots. |
| `@ri/app-kit` data, sources, time and UI | Moved into Travel (`src/lib`, `src/ui`) | Works differently |
| `plugin.json` requests: Gmail, Calendar and Ri actions | The application's `connectors`: purpose, `mail.read`, `calendar.read` and Ri's tool names. Ri's consent screen pre-ticks them. | Works differently |
| Ri asked the person to grant accounts per app | Travel connects to Ri's hub once, from Settings, with OAuth | Works differently. Not run against Ri's real hub here. |
| `contract.json` for Ri's package format | The kit's `dist/contract.json` and MCP tool list | Works differently |
| Entities with open paths (deep links) | `records`: paths, search and read | Works in hosts: verified in the test host; real hosts pending: `open_travel`'s path, the host's links (`openai/deepLink`) and the @ menu. In Travel's own page the same addresses work. |
| Bundled skill `trip-check` | Kept in `skills/trip-check` | Works. Nothing loads it automatically: the kit has no skill format for apps. It's guidance for an assistant that reads Travel's tools. |
| Error codes for Ri (`not_found`, `forbidden`, `conflict`, …) | Kit errors with Travel's own messages | Works |

## What the kit and Ri should change

Ordered by impact. None was worked around in the kit or Ri; each is handled inside Travel or listed above as blocked. Status as of kit `1713f6a`.

1. **Transactions (kit), still open.** The kit's database API is async and D1-compatible, with atomic batches but no transaction that can read inside it. Travel's writes read, decide and write together: match a confirmation, then create, merge or send to Review, with history and the import checkpoint, all or nothing. Rewriting them as batches would change the logic, not just the plumbing. So Travel opens a second, synchronous better-sqlite3 connection to the kit's own `data.sqlite`, in the same process, using the same SQLite library copy as the kit (checked again on 0.2.2). The cost: Travel runs only as a Node service, and its Worker build is a stub that says so. The kit's build still always produces a Worker, with no way for an app to say it's Node-only. **Kit option:** a `transaction(ctx, work)` on Node that runs on the kit's own connection, or a supported way to get that connection, plus a way to declare an app Node-only.
2. **App-only tools (kit, then Ri): closed.** Core 0.2.2 has `visibility: ["app"]`, and Ri's host enforces it. Travel uses it.
3. **Messages, links and downloads from a view (kit, then Ri): closed in the kit.** Core 0.2.2 has `draftMessage`, `openLink`, `download`, `openInBrowser`, `setSection` and `selectMany`. Travel uses them all. Ri's host drafts and opens links; saving files waits on [dynamismlabs/ri#2](https://github.com/dynamismlabs/ri/pull/2).
4. **Approvals (Ri): partly closed.** Ri's approvals now carry IDs, an approved call stays open 24 hours, and a declined call is refused; core 0.2.2 follows them. Whether Ri still asks before an app adds a task to the person's own Ri wasn't checked here (Ri wasn't run). Travel handles either.
5. **Which accounts an app may use (kit and Ri), still open.** The hub names the granted accounts only in a tool's `account` description, or in a `choose_account` answer. The kit's client returns tool names only, and turns `choose_account` into a message string. Travel parses "Choose which account to use (a, b)". **Kit:** expose the accounts, for example `connectors(ctx).accounts(capability)` or structured data on `SetupRequired`. **Ri:** could also list the granted accounts.
6. **Status answers passed as success (kit), still open.** Ri's hub answers `authorization_required`, `additional_permission_required` and `choose_connection_method` without `isError`. The kit maps `approval_required`, `choose_account` and now `denied`, so the others still reach the app as results. Travel maps them to setup states itself.
7. **Error codes dropped (kit and Ri), still open.** Ri's model-safe outcome leaves out the provider's HTTP status, so a deleted message or an expired sync token is only "provider error 404 for GET …" in text. The kit's client keeps only `denied` from Ri's `code` (not `not_found` from `ri__get_task`). Travel matches on text. **Ri:** include `not_found` or `gone`. **Kit:** keep `code` on the error it throws.
8. **The kit's fixture source is narrow, still open.** It serves the mail and calendar capabilities and fixed results by tool name. It can't stand in for Ri's history, full messages, attachments or sync tokens. Its mail search understands plain words only, so a Gmail query with `{a b}` groups matches nothing. Travel tests Ri's fuller tools with its own fake hub, and the capability path with the kit's fixture source.
9. **Smaller kit notes.**
   - Still open: the Node server isn't built with `NODE_ENV=production`, so tRPC error responses include stack traces with file paths.
   - Closed: views can now be handed a starting address (`open_<app>`'s path, host links).
   - Travel's tool list is 36 tools and 187 KB, and its view resource is about 1 MB. Ri's per-chat tool loading keeps the list out of chats until needed.
   - A `show_*` card's `data` is validated against its full output schema. Travel reuses its detailed trip schema, so cards are large but exact.
   - Still open: `create` defaults every app to port 4310. Travel uses 4334.
10. **Fictional dates (Travel's own).** The preview's trips are in November 2026, so they turn past. `TRAVEL_NOW` pins "today" for the preview and tests.

## Tests

| Old suite (92 tests) | New suite (106 tests) | Notes |
| --- | --- | --- |
| domain (19) | domain (19) | Unchanged |
| parse (14) | parse (14) | Unchanged |
| workflow (20) | workflow (22) | The invocation-retry assertion became "a retry returns the first result as already applied". New permission copy. Added: waiting for approval, then the job's identical call. The preview test seeds with `seedPreview` instead of Ri's fixture principal. |
| sync (17) | sync (18) | Accounts come from the fake hub's grant, with Ri's tool names. Account labels are the names Ri shows. Every granted account is automatic. Reconnect and removal go through `check_accounts`. Fair rotation runs through the `sync_sources` job. Added: not connected to Ri. |
| scope (15) | access (11) | Scopes became connections with chosen sources. "Revoked scope" and "no scope" moved to the kit's OAuth (`mcp.test.ts`) and an empty source list. "Job limited to its accounts" is now the hub's grant. "Access view" is now the consent screen's sources. The three replay tests became one retried-create test. The stored-reasons migration test is dropped (no old data). |
| contract (5) | contract (6) | Checks the kit's contract and MCP tools instead of Ri's package format. Added: exactly which tools are view-only, and `open_travel`'s paths. |
| view (2, Ri's packaged view in Chrome) | browser (8) | In the kit's strict host: the model's tool list and refused call, the @ menu and record reading, cards opening the app at a booking and at Review, `open_travel` at a booking, the place and selection reaching the assistant, a draft in the chat, directions and Open in browser through the host, Export saved through the host, a host link, and the same view in a host without drafts, links or files and in one that refuses links. Travel's own page at narrow and wide widths, and adding a pasted booking on an empty install. |
| none | MCP with OAuth (3) | The real server, with the MCP SDK's OAuth client and sources chosen on consent. |
| none | kit fixture source (5) | Import through the kit's capabilities on the kit's runner, PDF through `ri__extract_text`, approval wait across the runner, a declined approval, Ri down and connection revoked. |

## Not checked here

- Travel connected to Ri's real hub: its consent screen, a real Gmail account, real approvals. Ri wasn't run, as asked. The hub client was exercised with the kit's fixture source and a fake of Ri's hub built from Ri's code (branch `claude/single-path-ri-hub`).
- Ri, ChatGPT and Claude drawing Travel's view: every "Works in hosts" line above, file picking in their frames, light and dark at phone and desktop widths, and the view's size and load time. Checked in the kit's strict test host only. This is the next step (shared spec §5, "Done when").
- `serve --install` on core 0.2.2 (it passed on 0.2.0).
- A real launchd service. `--service process` only, as asked.
- A file picker inside a real host's sandboxed frame.
