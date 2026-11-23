# Travel: parity with Ri's Travel app

Ri's Travel app (`apps/travel` at Ri commit `3c442810`) ported onto App Builder. Ported November 12 on kit core 0.2.0. Moved November 16 to core 0.2.2 (kit `main` at `1713f6a`), which added the full app in every host (shared spec §5). Moved November 17 to kit `main` at `ff47742` (still core 0.2.2), with the kit's fixes for the gaps the ports found ([dynamismlabs/mcp-app-builder#10](https://github.com/dynamismlabs/mcp-app-builder/pull/10)). Tagged `v0.1.0`. For `v0.1.1`, moved to kit `main` at `a8e9b5d` (kit #11 to #13, still core 0.2.2), after Ri sent a provider's 404 or 410 with its code and status ([dynamismlabs/ri#7](https://github.com/dynamismlabs/ri/pull/7)). For `v0.1.2`, moved to kit `main` at `023f92f` (kit #14 to #17, still core 0.2.2): Travel's transactions run on the core's `transaction()`, and Settings opens inside an assistant's view. `v0.1.3` is kit `main` at `7b1ba65` (kit #18 and the add-only follow-up, still core 0.2.2). For `v0.1.4`, moved to kit `main` at `73c5266` (kit #20 to #25, still core 0.2.2): assistants get Travel's `instructions` when they connect, and Ri's trip check is an MCP prompt. For `v0.1.5`, moved to kit `main` at `e44b499` (kit #26, still core 0.2.2): the core reads an app's own copy of zod, so the trip check takes the trip as an argument, and the running service answers a bad input with a 400 that names its first problem. For `v0.1.7`, moved to core 0.2.4 (kit `main` at `d2b87bf`, kit #28): Restart on a Mac waits for launchd to let the old process go. For `v0.1.6`, moved to core 0.2.3 (kit `main` at `b38d373`, kit #27): Ri, as the host that installed Travel on its computer, can allow itself in Travel without a browser, so "Allow Ri in Travel" works from any device. This lists every feature and behavior from the old README, AGENTS.md, plugin.json and tests, and whether it works here.

- **Works**: same behavior on the new path.
- **Works in hosts**: works inside an assistant too, verified in the kit's strict test host (a scripts-only sandbox, no network, and Ri's rules for visibility, drafts, links, files and host links). Ri was then checked on November 16, 2026 in a **disposable Ri at f55cdf96** on this Mac (not a Ri Home in everyday use, which runs on another computer), on the web and, partly, in its desktop app, with dummy records only. These lines say what Ri did. ChatGPT and Claude are still pending. Details in [Real hosts](#real-hosts), screenshots in `docs/parity/`.
- **Works differently**: the outcome is there, but reached another way. Says how.
- **Blocked**: not possible on the new path today. Says why: a kit gap, or a host's own rule.

## Summary

Everything Travel did in Ri works on the new path except one thing. The domain logic, data model, screens and almost all tests came over unchanged: trips, itineraries in local time, bookings, Review, corrections, coverage, ideas, imports, Gmail and Calendar sync, the AI fallback, follow-ups and export.

On core 0.2.2 the whole app also works inside an assistant, verified in the kit's strict test host: Ask in chat, links and maps out, Export, Open in browser, Settings, opening at a trip or booking, the @ menu, and the person's own decisions kept from the model. Since v0.1.4 an assistant also gets Travel's instructions when it connects, and can offer Ri's trip check as a prompt, which takes the trip since v0.1.5. Real hosts are the next check.

**Still blocked:**
1. **Travel can't run on Cloudflare** (kit gap). Its writes need transactions that read and write together. The core's `transaction()` gives them on Node only for now, so Travel declares itself Node-only (`platforms: ["node"]`).
2. **Export inside Ri** (Ri's host). Ri doesn't save files from a view yet ([dynamismlabs/ri#2](https://github.com/dynamismlabs/ri/pull/2)). Until it does, Travel offers "Export in browser" there. It works in a host that saves files.
3. **A host that ignores tool visibility** (that host's rule). Review decisions, deleting, imports and settings are view-only. A host that doesn't honor that would let its model call them. Travel's own access checks still apply. Ri honors it. ChatGPT and Claude are part of the real-host check.

The other findings are things Travel works around itself that the kit or Ri should fix; they're under "What the kit and Ri should change".

### What moved for v0.1.7 (kit #28, core 0.2.4)

| Line | Was | Now |
| --- | --- | --- |
| Restart on a Mac (kit #28) | Restart in Ri for People on a Mac mini failed with launchd's "Try re-running the command as root for richer errors." and left the app stopped | Core 0.2.4 waits for launchd to let the old process go and restarts a still-loaded service in place |
| The upgrade | Kit `b38d373`, core 0.2.3 | `upgrade` to core 0.2.4 (sha256 `0d5eaa94…`) committed `f79238f` and switched `local.travel` from `fc4c9fe`. Nothing in Travel needed changing |

### What moved for v0.1.6 (kit #27, core 0.2.3)

| Line | Was | Now |
| --- | --- | --- |
| Allowing Ri in Travel from another device (kit #27, the host grant) | "Allow Ri in Travel" opened Travel's consent screen at the Ri Home's `127.0.0.1`, which a laptop or phone can't load | Works on the installed service, with no change in Travel. The data folder has `host-key` (mode 600, kept across upgrades and changes), and `status --json` reports `hostKeyPath`. With the key, `GET /api/host/access-choices` answers Travel's two choices, "Read and make changes" (recommended) and "Read only", each covering all accounts and collections. Travel marks no action `adds`, so there's no add-only choice. No key, a wrong key, an Origin header or a forwarding header is refused. Approve wasn't called on the installed service, since it would add a connection. On a scratch copy with the fictional trips, in-process, an approve for "Read only" and the PKCE exchange gave a connection that lists the three trips and is refused `save_trip`, and no session was left behind. An add-only approve is refused. Ri's side (Ri #26) wasn't run here |
| The upgrade | Kit `e44b499`, core 0.2.2 | `upgrade` to core 0.2.3 committed `280ed22` and switched `local.travel` from `790c71a`. The 0.2.2 tarball is gone from `vendor/`. Nothing in Travel needed changing. Locally 126 tests pass in 11 files, browser included |

### What moved for v0.1.5 (kit #26)

| Line | Was | Now |
| --- | --- | --- |
| A prompt's arguments in the build (kit #26) | The build, `change` and `serve --install` refused every prompt argument. The CLI loads `src/app.ts` through tsx, so the app has its own copy of zod, and the core checked fields with `instanceof`. So `trip-check` took none | Works: `trip-check` takes an optional `trip`, the person's words, up to 200 characters as `list_trips`' search allows. Given, it goes to the search quoted, and if no trip matches the assistant says so instead of checking another. Left out or blank, the text is word for word v0.1.4's. The build passes and `dist/contract.json` lists the argument. The contract test checks both texts and the limit, and `tests/mcp.test.ts` lists the argument, fills it in and has an over-long one refused. Removing the limit, or ignoring the argument, fails both |
| A bad input on the running service (kit #26) | On the installed service, which loads Travel through tsx, a tool's bad input came back as a 500 with zod's issues as JSON (the kit's finding, not run for Travel). Travel's tests never saw it, since they load one zod | Works: the switched service answered `list_trips` with a text `limit` over the browser's tRPC with a 400, "Expected number, received string". Travel's tests still share one zod, so the kit's `tests/zod-copies.test.ts` covers the loader |
| The upgrade | Kit `73c5266` | `upgrade` to `e44b499` committed `ac08b8b` and switched `local.travel` from `77b3125`. Its copy ran 117 tests with the 9 browser tests skipped. Nothing in Travel needed changing for it |

### What moved for v0.1.3 and v0.1.4 (kit #18 to #25)

Each line is marked closed only where a Travel test or a run shows it.

| Line | Was | Now |
| --- | --- | --- |
| What an assistant knows across the tools (kit #22) | Nothing. Each tool described only itself | Works: `instructions` in app.config.ts, about 900 characters. It covers answering from records only, "No booking recorded" as something to check, local times with their zones, looking before adding a booking by hand, what stays in Travel's own screen, and imported text as data. The contract test keeps it under 2,000 characters and checks that every tool it names exists. `tests/mcp.test.ts` reads it from the MCP client at connect |
| Bundled skill `trip-check` (kit #23) | A `SKILL.md` that nothing loaded, kept in `skills/trip-check` | Works: the `trip-check` prompt (`src/prompts.ts`), "Check a trip". It carries the skill's steps and rules and names `list_trips`, `get_trip` and `create_follow_up`. It checks the trip the person names in the chat, or else the next upcoming one. It reads nothing itself, so a connection limited to some sources sees no more through it. `skills/` is gone. The contract test checks `mcp.prompts` and the text, and `tests/mcp.test.ts` lists and gets it over MCP. It took no `trip` argument then: the kit's build refused every prompt argument, since it loads `src/app.ts` through tsx's `tsImport` and checked the app's zod fields with `instanceof`. Kit #26 closed it for v0.1.5 (above) |
| Hub stubs that depend on their arguments (kit #24) | One answer for every call to a tool | Works: `tests/hub.test.ts` answers by arguments with `cases`. Only the deleted message, the expired sync token and the deleted task fail, others answer, and a call no case covers fails naming its arguments. The follow-up test's missing task is the one it created. Travel's fake of Ri's hub (`tests/helpers.ts`) stays as it is: it already answers by arguments, and it keeps state between calls (history that advances, a read that fails once), which `cases` can't hold |
| Cheaper transactions (kit #18) | 17 µs per one-statement transaction | Nothing changes in Travel's code. The core now prepares statements once and reuses them |
| Service definitions with a shape version (kit #18) | None | Nothing changes in Travel. The upgrades to `7b1ba65` (`b2ed6aa`) and `73c5266` (`9c66d8a`) switched `local.travel` |
| Get-session (kit #20) and token revocation (kit #21) | `get-session` answered a token's whole stored row. No revocation endpoint | Nothing changes in Travel. It never called `get-session`, which now answers 404, and no Travel test pins discovery's `revocation_endpoint` |
| What Settings says Travel asks Ri for (kit #25) | "use your accounts" | Nothing changes in Travel's code. From its capabilities and hub tools, Settings now says Travel asks Ri to read your mail, read your calendar, add tasks to Ri, open Ri tasks it already knows, use your model in Ri for short text and read the text of files it sends to Ri. Worked out from the core's rules, not looked at in a browser |

### What moved for v0.1.2 (kit #14 to #17)

Each line is marked closed only where a Travel test or a run shows it.

| Line | Was | Now |
| --- | --- | --- |
| Transactions for every write | Travel opened its own synchronous better-sqlite3 connection to the kit's `data.sqlite`, with its own `BEGIN IMMEDIATE` wrapper | Works, Node only: the core's `transaction(ctx, work)` on the kit's own connection, with the same rules. An inner transaction joins the outer one, and work must be synchronous. Each action's synchronous body is one transaction, and so are the cards, the @ menu, the source list and export. Actions that wait on Ri keep a transaction around each write between the calls. Travel's own connection is gone, and app.config.ts declares `platforms: ["node"]`. The revision triggers and search index are unchanged. `tests/transactions.test.ts` makes SQLite refuse the last write of a manual booking, an import, a Gmail page with its checkpoint, and deleting an account's data. Nothing earlier is kept, and every one of those tests fails with transactions turned off |
| Settings inside an assistant | "Open Settings in browser" from a host | Works in hosts: verified in the test host. Settings opens inside the view, from the header beside Open in browser and from Sources. It lists the connections with the view's own marked, and removes another at once, while the view's own asks first. It also covers the Ri link and automations. The account and downloads stay in the browser, through Open in browser. The core's `read_settings` and `change_settings` are view-only, and the model's call is refused (`tests/view.browser.test.ts`) |
| Builds during `upgrade` and `change` | Used whatever Node the shell had first | Works (kit #14): `upgrade` and `change` built with Node 24.2.0 from `local.travel`'s definition, as their `resolve` step says. Not run from a shell with another Node first |
| Browser clients and add-only connections (kit #17) | None | Nothing changes for Travel. It marks no action `adds`, so its consent screen is the same. The core's migration `core-0010` came with the upgrade (`migrations/0_core-0010.sql`) |

### What moved for v0.1.1 (Ri #7, kit #11 to #13)

Each line is marked closed only where a Travel test or a run shows it.

| Line | Was | Now |
| --- | --- | --- |
| A provider's 404 or 410 (a message deleted after it was listed, an expired Gmail history, an expired Calendar sync token) | Read from Ri's "provider error 404" text, and any 404 or 410 restarted a calendar | Works: from Ri's `not_found` code and the provider's `httpStatus`, with the text kept only for a hub from before Ri #7. Calendar restarts its window only on 410. A 404 there means the calendar is gone, so the step fails and keeps its place. Gmail's expired history answers 404 and rescans the window. A deleted message is dropped. Both hub shapes are tested (`tests/sync.test.ts`), and the kit's own client keeps Ri's status (`tests/hub.test.ts`) |
| Deleting an account's data takes it out of every chat's sources | Works differently: the account stayed in Travel's sources, so a connection limited to it kept it | Works: the account leaves Travel's sources list until it's resumed, and the core drops it from every connection's choice for good (`tests/mcp.test.ts`, with a real OAuth connection) |
| The lent account's type | Derived from `connectors()`, since the core didn't export it | Works: `ConnectorAccount` from `@app-builder/core` |
| The installed service's definition | Written by the older core: no `NODE_ENV=production`, and `upgrade` and `change` didn't rewrite it | Works: since kit #12 a change rewrites it. After the switch to `19bcb8c`, `local.travel`'s plist has `NODE_ENV` `production` and `ProcessType` `Interactive` (kit #13, so launchd doesn't hold the start back) |
| Accounts taking turns in the import job | Two steps stamped in the same millisecond tied, and the tie went to the same account every time. The rotation test failed about half the time under the tests' fixed clock | Works: a step is stamped later than any before it (Travel's own fix) |

### What moved with kit #10 (`ff47742`)

Each line is marked closed only where a Travel test or a run shows it.

| Line | Was | Now |
| --- | --- | --- |
| Backups and restores | A backup couldn't be restored: the kit refused the booking search index's internal tables. And backups left out triggers, so a restored Travel would have lost the revision counters | Works: restored with the 39 revision triggers and the search index, and an edit after the restore moves the revision (`tests/backup.test.ts`). The installed Travel's own nightly backup from November 17, written by the older core, restored into a scratch folder with its triggers back and a clean index (run, then deleted) |
| Several Gmail or Calendar accounts | Works differently: parsed from Ri's "Choose which account to use (a, b)" message | Works: from the accounts Ri lent (`connectors(ctx).accounts()`, Ri's `ri__list_accounts`), or the names on Ri's choice. The message parsing is gone |
| One account must sign in again in Ri | Works differently: Travel turned Ri's `authorization_required` result into a setup state itself | Works: the core does it, with Ri's code. Travel's own mapping is gone |
| Check whether a linked Ri task still exists | Works, by matching Ri's message | Works: by Ri's `not_found` code, which the core now keeps. The message matching is gone |
| Error responses | tRPC sent a stack trace with file paths | Works: no stack, path or internal message reaches the browser or an assistant (`tests/mcp.test.ts`, and the switched service answered a refusal without one) |
| Gmail history expiry and deleted messages | Matched on Ri's "provider error 404" text | Unchanged on purpose then. Closed in v0.1.1, above |

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
| Sources: chats with access | Works differently, no way to Settings from a host | Works in hosts since v0.1.2: Settings opens inside the view |
| Follow-ups waiting for approval | 5-minute single-use approval, retried every 2 minutes | Ri's approval IDs: an approved call stays open 24 hours; a declined one stops |
| Kit findings 2 and 3 (app-only tools; messages, links and downloads) | Open | Closed by the kit. Finding 4 partly closed (approval IDs). Finding 9's "no starting address" closed. |

**How this was checked** (all with fictional data):
- 126 tests in 11 files: `pnpm test`, run two files at a time. The browser checks need a build and Chrome: `pnpm test:view`.
- The core upgrades ran through the kit's `upgrade --core ~/dynamism/app-builder --json`. On November 16 Travel wasn't installed yet, so it only type-checked and tested, and its tests stopped it once (the fictional November trips had turned past, and the kit's approval timing had changed). Both are fixed in Travel. On November 17, to kit `ff47742`, it ran the full safe-change on the installed `local.travel`: install, typecheck, tests, build, rehearsal on a copy of the data, snapshot, switch and merge all passed, with no test to fix. For v0.1.1 the upgrade to kit `df533b0` rolled back at the switch: launchd loaded the new definition but never started it. Kit #13 fixed that, and the upgrade to kit `a8e9b5d` switched to `19bcb8c`. For v0.1.2 the upgrade to kit `023f92f` stopped at the tests, before anything changed: the contract test lists the view-only tools, and the core had added two. With the test updated, `change` switched to `598097c`. For v0.1.3 and v0.1.4 the upgrades to kit `7b1ba65` and `73c5266` passed and switched without a test to fix. The v0.1.4 changes then switched through `change`.
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
| Sources: chats with access | Works differently, and in hosts: verified in the test host | Each assistant connection and its access is in the kit's Settings, at `/settings`. Choices are made on Travel's consent screen when a place connects, or, since v0.1.6, in Ri's own screen when Ri installed Travel on its computer (the host grant, which covers all sources). Sources points there. Inside an assistant, Settings opens in the view itself, and the view's header has it too. |
| Sources: Travel settings (home zone, your names, AI fallback) | Works | |
| Calendars to check, per calendar account | Works | |
| Add booking: paste, file, or the manual form | Works | Paste-and-apply on an empty install checked in Chrome. |
| Picking a file inside an assistant's frame | Pending (host's rule) | A file input in the frame. Whether a host's sandbox allows picking a file is the host's rule, so it's part of the real-host check. In Travel's own page it works, and Open in browser gets there from any host. |
| Location kept in the host's address, so reopening returns to the same place | Works in hosts: verified in the test host, and in Ri on the web (`?open=open_travel&path=/bookings/<id>` opened the booking beside its trip). Ri's Reload starts the app over at `/`. ChatGPT and Claude pending. | In Travel's own page the browser address keeps the place, with Back and Forward. Inside an assistant, `open_travel` opens at a path (`/trips/<id>`, `/bookings/<id>`, `/ideas/<id>`, `/review`) and the view follows the host's later links there. Opening from the app list starts at `/`, which reopens the one upcoming trip or the last one viewed, as in Ri. |
| Back closes a booking opened beside the itinerary | Works | |
| Neutral palette, light and dark | Works | Inside an assistant the host's style variables come first. No `color-scheme`, per the kit's rule. |
| Copy has no long dashes or semicolons | Works | Tested over every generated text and tool description. |
| "Ask Ri" button (stage a question about a booking in the chat, never send) | Works in hosts: verified in the test host, and in Ri on the web: "Travel wrote a message for you. It's in your main chat's draft, ready when you are." ChatGPT and Claude pending. | Now "Ask in chat": `client.draftMessage`, `ui/message` with `openai/message` `send: false`, only in a host that drafts (Ri does). A host that can't shows the question to copy. Travel's own page has no chat, so no button. Checked: the draft arrives unsent, and nothing is sent in a host without drafts. |
| "What is missing?" prompt for a trip or day | Works in hosts: verified in the test host. Not clicked in Ri; it drafts the same way as Ask in chat, which works there. ChatGPT and Claude pending. | Same as Ask in chat, for the trip, a day, a gap, an idea, a Review item and a calendar event. `describe_view_context` gives the chat the "No booking recorded" coverage to answer with. |
| Open directions (external map through Ri) | Works in hosts: verified in the test host. Not clicked in Ri (the dummy booking had no address); it opens through the same `ui/open-link` as Open in browser, which works there. ChatGPT and Claude pending. | Through the host's `ui/open-link`, in the person's browser. A host that can't, or refuses the link, gets the map address to copy. In Travel's own page, a new tab. Checked all three. |
| Open in Gmail, from a source | Works in hosts: verified in the test host. Not checked in Ri (no Gmail source in the disposable Ri). ChatGPT and Claude pending. | Same as Open directions. |
| Export a trip as CSV or JSON, downloaded | Works in hosts: verified in the test host, and in Ri on the web ("Travel wants to save travel-seattle.csv (267 bytes)", Save wrote the file). ChatGPT and Claude pending. | Through the host's `ui/download-file`, the file embedded (checked: `travel-lisbon.csv` arrives). A host without save-file gets "Export in browser" instead, which opens the same trip in Travel's own page. Ri saves files since [dynamismlabs/ri#2](https://github.com/dynamismlabs/ri/pull/2). In Travel's own page, an ordinary download. |
| Ri's "Try" preview with fictional trips | Works differently | `pnpm preview` runs Travel on a new data directory, with Alex Rivera's fictional trips and the fixture hub. `TRAVEL_PREVIEW=fictional` does the same for any server. No account is read. |
| Catalog demo rows (Day, Time, Item, Status) | Works differently | The kit has no catalog entry format. The shared spec's catalog lists apps by git URL and version. |
| Open in browser (new) | Works in hosts: verified in the test host, and in Ri on the web (it opened `http://127.0.0.1:4313/trips/<id>` in a new tab). ChatGPT and Claude pending. | In the header inside an assistant and in every card's footer, through the host's open-link, at the place the person is in. Not offered where the address can't be reached (a phone, for an app on this Mac) or the host can't open links. Checked: it opens `http://127.0.0.1:<port>/trips/<id>?selected=<booking>`. |

## Cards and the assistant's view (new on this path)

| Feature | Status | Notes |
| --- | --- | --- |
| `show_trip`: a trip's itinerary by local day, coverage prompts and Review count | Works in hosts: verified in the test host. Not checked in Ri: a card needs a model's call, and the disposable Ri had no model. ChatGPT and Claude pending. | New. "Open this trip", and each entry opens the whole app at its booking. |
| `show_trips`: trips with dates and attention | Works in hosts: verified in the test host. Not checked in Ri (needs a model). ChatGPT and Claude pending. | New. A trip opens the whole app there. |
| `show_review`: what waits in Review | Works in hosts: verified in the test host. Not checked in Ri (needs a model). ChatGPT and Claude pending. | New. "Open Review" opens the whole app there, where the person decides. |
| `open_travel` opens the whole app full screen, at a place when given | Works in hosts: verified in the test host, and in Ri on the web, full screen and at a booking. Only when Travel is added with **Add MCP server**: through **Add app**, Ri opens no app's screen yet. In Ri's desktop app it didn't finish opening, because the disposable desktop's development server kept restarting under this Mac's load. ChatGPT and Claude pending. | Added by the kit. Checked at a booking, and following a host link to another booking. |
| The host's @ menu offers trips and bookings | Works in hosts: verified in the test host, and in Ri on the web: "@Seattle" found the trip and its flight. Reading an item at send needs a model harness, which the disposable Ri didn't have. ChatGPT and Claude pending. | New: `records` in `src/app.ts`. `search_mentions` is view-only and read-only; a chosen record is read as the connection (`app://travel/trips/<id>`), so it never shows what the connection can't see. |
| Selection reaches the chat | Works in the test host. **Not in Ri:** Ri drops a screen's context when it closes, and its full-page screen has no chat beside it, so the selection never reaches a message. ChatGPT and Claude pending. | The place (for example "Lisbon trip, November 9 to 14, 2026"), its path and filters (tab, day, status, search), the selected booking or trip, and the ideas chosen to compare as several records. This is what Ri's view context carried, except record revisions. `describe_view_context` still gives a chat the rich description of a place, re-resolved under its own access. |
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
| Gmail: history expiry rescans the window, never the whole mailbox | Works | Gmail answers an expired history ID with 404. Ri sends it as `not_found` with `httpStatus` 404 ([dynamismlabs/ri#7](https://github.com/dynamismlabs/ri/pull/7)), and Travel rescans the window. For a hub from before that, Travel still reads "provider error 404" from the message. Both are tested. |
| Gmail through Ri's hub instead of Ri's per-invocation capabilities | Works differently | Travel calls Ri's tools by name through the kit's connector client (`connectors(ctx).call`), with its own OAuth token for the hub. The kit's mail adapter returns only plain text, and Travel needs Gmail's MIME parts for attachments, invitations and HTML. |
| Booking attachments: a PDF read through Ri's `extract_text` when the body has no details | Works | Ri's `gmail__get_attachment` and `ri__extract_text`. |
| Calendar invitations in mail: zones, and a suggested booking | Works | |
| Google Calendar: chosen calendars read for events while away. Nothing is written | Works | Ri's `google_calendar__sync_events`, with sync tokens and expiry. |
| A hub that offers only the kit's mail and calendar capabilities | Works differently (new) | Travel falls back to the kit's adapters: search and plain text, and the calendar window. There is no deletion tracking, attachments or invitations then. This is how it runs on the kit's fixture source. |
| File: PDF (through Ri's `extract_text`), text, HTML and saved email, up to 512 KB, previewed first, original kept | Works | |
| Paste any confirmation text, previewed first | Works | |
| Manual form: flights, trains, stays, car rentals, activities | Works | |
| Several Gmail or Calendar accounts | Works | Ri's grant decides which accounts. Travel reads them from the core's `connectors(ctx).accounts()`, which uses Ri's `ri__list_accounts` ([dynamismlabs/ri#4](https://github.com/dynamismlabs/ri/pull/4)) and otherwise the names Ri puts on its tools. With several, each is named as the tools take it, without reading any mailbox. With one, Travel still reads its address (`gmail__get_profile`, or the primary calendar's id), as before, so an installed Travel's accounts keep their records whatever Ri calls them. A hub that can't list them asks Travel to choose, and the core passes the names it gives. Tested on the kit's fixture source (Ri's list, and Ri's choice) and on the fake hub. |
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
| Check whether a linked task still exists | Works | `ri__get_task`. Ri's `not_found` reaches Travel as the core's `ConnectorError` with that code, so a deleted task shows as missing whatever Ri's message says. Tested on the kit's fixture source. |

## Data access

| Behavior | Status | Notes |
| --- | --- | --- |
| The owner's view sees everything | Works | The person's own browser, and the app's jobs. |
| A chat sees only the accounts and collections shared with it (`account:<id>`, `manual`, `imports`) | Works differently | Per connection, chosen on Travel's consent screen when a place connects (a Ri workspace, Claude, ChatGPT), and enforced on every call. Since v0.1.6 the Ri that installed Travel can instead choose read or read and change in its own screen, for all sources. The sources offered are the same keys. Verified over real OAuth. |
| Read-only versus write access | Works | The kit refuses writes for a read-only connection with its own message. |
| A booking is visible only when all its contributing sources are shared | Works | |
| A trip from an unshared source shows only through the shared bookings in it, without its title or notes | Works | |
| Trip names in reviews, previews, results and history follow the caller's projection | Works | |
| Review reasons never name another booking or trip | Works | |
| A narrower caller's revision doesn't move when others change things | Works | |
| The scheduled job reads only its own automatic accounts and reads no records | Works differently | Jobs run as the installation's owner, which the kit decides. The hub limits them to the accounts Ri granted. They read records to match and place bookings. |
| Owner-only: source management, scope creation, review decisions, deletion | Works in hosts: verified in the test host, and in Ri on the web: the model's path refused `delete_booking` ("This tool is not available to this caller."), and the view's file import (`preview_import`, `apply_import`) and export went through. ChatGPT and Claude pending. | These are view-only (`visibility: ["app"]`): the host keeps them out of the model's tool list and refuses the model's call, while Travel's screen still calls them. Checked: the model's call to `review_change` is refused, and "Use 16:00" works from the view. They also still need "the owner": the person's own browser, or a connection allowed to see everything, so a limited connection's view shows Review read-only. **Blocked in a host that ignores visibility (that host's rule):** its model could call them, within Travel's own checks. Ri honors visibility. |
| A retried write returns its first result only while the caller's access is unchanged | Works differently | No invocation receipts. Creates replay by `newId` and are shown under the caller's current access, so a narrower caller never sees what it can't. |
| Deleting an account's data removes it from every chat scope that shared it | Works | Connection choices belong to the kit. Deleting the data pauses the account and leaves it out of Travel's `sources.list` until the person resumes it. The core then drops it from every connection's choice and never lets it back in, so a connection that chose it doesn't get it back after a resume. Tested with a real OAuth connection (`tests/mcp.test.ts`). |
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
| One account must sign in again in Ri: that account shows "Reconnect this account in Ri" | Works | Ri answers with `authorization_required` as a normal result. Since kit #10 the core turns it, `additional_permission_required` and `choose_connection_method` into a setup state with Ri's code, so Travel no longer maps them. Tested on the kit's fixture source with Ri's own answer. |
| Travel not connected to Ri at all | Works | Everything except mail, calendar, PDFs, the model and Ri tasks works. Sources says to connect in Settings. |
| Files up to 512 KB, text kept up to 64,000 characters, previews expire after an hour | Works | |

## Plumbing (what Ri provided, and what replaced it)

| Ri | Here | Status |
| --- | --- | --- |
| Runtime: Ri started the app on demand over its private IPC | The kit's Node server, run as the person's service (`serve --install`) | Works differently |
| Kit updates | The kit's `upgrade --core` | Works: core 0.2.0 to 0.2.2 through the safe-change checks, then kit `ff47742` through the full safe-change on the installed service. Kit `df533b0` rolled back at the switch (launchd never started the new release). Kit `a8e9b5d` (#13) fixed that and switched cleanly. Kit `023f92f` stopped at Travel's contract test, then switched once it was updated. Kits `7b1ba65` and `73c5266` switched with no test to fix. Kit `e44b499` switched with no test to fix, and so did core 0.2.3 (`b38d373`). |
| Backups and restores | The kit's `backup` and `restore` | Works since kit #10: Travel's revision triggers and booking search index come back, also from a backup an older core made (Travel's migrations put the triggers back). Tested, and the installed Travel's nightly backup was restored into a scratch folder. |
| Records in `records.db` in Ri's instance folder (`node:sqlite`) | The kit's `data.sqlite`, with Travel's tables in kit migration `app-0001` | Works differently. Same data model. Ri's three migrations are one, since no old data exists. Ri's third migration only rewrote first-release review reasons, so it isn't carried and its test is dropped. |
| Synchronous transactions for every write | The core's `transaction(ctx, work)` on the kit's own connection (since v0.1.2, before that Travel's own connection) | **Works, but Node only.** Blocked on Cloudflare until the kit can run it there (finding 1). |
| Content-addressed evidence files in a blobs folder | A `travel_blobs` table in the same database | Works differently: files commit with the records that cite them, and travel with backups and change snapshots. |
| `@ri/app-kit` data, sources, time and UI | Moved into Travel (`src/lib`, `src/ui`) | Works differently |
| `plugin.json` requests: Gmail, Calendar and Ri actions | The application's `connectors`: purpose, `mail.read`, `calendar.read` and Ri's tool names. Ri's consent screen pre-ticks them. | Works differently |
| Ri asked the person to grant accounts per app | Travel connects to Ri's hub once, from Settings, with OAuth | Works differently. Not run against Ri's real hub here. |
| `contract.json` for Ri's package format | The kit's `dist/contract.json` and MCP tool list | Works differently |
| Entities with open paths (deep links) | `records`: paths, search and read | Works in hosts: verified in the test host and in Ri on the web: `open_travel`'s path, the host's links (`openai/deepLink`) and the @ menu. In Travel's own page the same addresses work. |
| Bundled skill `trip-check` | The MCP prompt `trip-check` (`src/prompts.ts`) | Works differently, since v0.1.4: an assistant offers it as a prompt the person picks. Since v0.1.5 the person gives the trip as its `trip` argument, names it in the chat, or leaves it for the next upcoming trip. Until v0.1.4 it sat in `skills/trip-check`, and nothing loaded it. |
| Error codes for Ri (`not_found`, `forbidden`, `conflict`, …) | Kit errors with Travel's own messages | Works |

## Real hosts

Checked on November 16, 2026. "Ri" is a **disposable Ri at f55cdf96** on this Mac, with dummy records, not a Ri Home in everyday use. Travel ran as the installed service at `http://127.0.0.1:4313` (launchd `local.travel`, release aeec62b, data in `~/.local/share/travel`), installed with `PORT=4313 APP_HOST=127.0.0.1 APP_URL=http://127.0.0.1:4313 pnpm exec app-builder serve --install HEAD --json` (every step passed) and moved to aeec62b with `change`. Ri connected it through Travel's consent screen. Full-screen checks used **Add MCP server**, because Ri's Add app path opens no screen yet. Screenshots: `docs/parity/ri-*.png`.

| Check | Ri on the web | Ri's desktop app | ChatGPT | Claude |
| --- | --- | --- | --- | --- |
| Connect, `open_travel` and the tools listed | Works: consent, token, 36 tools including `open_travel` and `search_mentions` | Same connection | Pending | Pending (desktop set up, waits on a restart) |
| Every screen (Trips, a trip's itinerary, a booking, Review, Sources) | Works | Didn't finish opening (load) | Pending | Pending |
| Person-only actions from the view | Work: file import, export | Not checked | Pending | Pending |
| The model can't call them | Refused: `delete_booking` | Same Ri server | Pending | Pending |
| Links out and Open in browser | Open in browser opens `/trips/<id>` in a new tab | Not checked | Pending | Pending |
| Saving files | Ri's card, then saved (`travel-seattle.csv`) | Not checked | Pending | Pending |
| Picking files | Chooser opens in the frame, a dummy confirmation read and added | Not checked | Pending | Pending |
| Ask drafts | In the main chat's draft, unsent | Not checked | Pending | Pending |
| Opening at a record | `/bookings/<id>` opens the flight beside its trip | Didn't finish opening (load) | Pending | Pending |
| The @ menu | Finds the trip and the flight | Not checked | Pending | Pending |
| Selection reaching the next message | Doesn't: Ri drops a closed screen's context | Same | Pending | Pending |
| Light and dark | Ri has only a dark theme. Travel follows it | Same | Pending | Pending |
| Phone and desktop widths | 390 px fits, no sideways scroll; 1396 px | Not checked | Pending | Pending |
| View size and load time | View 1,080,582 bytes. Warm reload 0.6 s, open by link 8 s (Ri's dev server) | Not measured | Pending | Pending |

Ri's desktop app uses the same pages and host code as Ri on the web, and passed these checks for People, Job search and Bookmarks. For Travel, the disposable desktop's development server stalled for over 3 minutes several times under this Mac's load (load average around 200), and Ri's watchdog kept restarting it, so Travel's screen didn't finish opening there. Load times are from Ri's development server, so they're upper bounds. The disposable Ri had no model harness, so the cards and reading an @ item at send weren't checked.

Found in Ri and fixed in Travel: Ri refuses a whole server whose tool takes an input named `account`, which it reserves, so Ri couldn't add Travel at all. `setup_source`, `list_calendars` and `pause_source` now take `sourceAccount` (commit aeec62b, with a contract test). `pnpm typecheck` and `pnpm test` pass: 9 files, 107 tests.

## What the kit and Ri should change

Ordered by impact. None was worked around in the kit or Ri. Each is handled inside Travel or listed above as blocked. Status as of kit `b38d373` (core 0.2.3).

1. **Transactions (kit): closed on Node, open on Cloudflare.** Travel's writes read, decide and write together: match a confirmation, then create, merge or send to Review, with history and the import checkpoint, all or nothing. Rewriting them as D1 batches would change the logic, not just the plumbing.
   - Until v0.1.1 Travel opened a second, synchronous better-sqlite3 connection to the kit's own `data.sqlite`.
   - Since kit #15 the core has `transaction(ctx, work)` on Node, on its own connection, and Travel uses it (v0.1.2). Its second connection is gone, and app.config.ts declares `platforms: ["node"]`, so `deploy cloudflare` refuses Travel.
   - Still open: Cloudflare, where the kit plans to move an installation's database into a Durable Object (`docs/transactions-on-workers.md` in the kit). The kit's build still produces a Worker, so Travel's stays a stub that says so.
   - Still open in Travel, as the kit's note says: a sync step reads its checkpoint before the network call and writes it after, without checking again. Only the job's claim keeps two steps for one account apart. Behavior was kept as it was for this move.
2. **App-only tools (kit, then Ri): closed.** Core 0.2.2 has `visibility: ["app"]`, and Ri's host enforces it. Travel uses it.
3. **Messages, links and downloads from a view (kit, then Ri): closed in the kit.** Core 0.2.2 has `draftMessage`, `openLink`, `download`, `openInBrowser`, `setSection` and `selectMany`. Travel uses them all. Ri's host drafts, opens links and, since [dynamismlabs/ri#2](https://github.com/dynamismlabs/ri/pull/2), saves files.
4. **Approvals (Ri): partly closed.** Ri's approvals now carry IDs, an approved call stays open 24 hours, and a declined call is refused; core 0.2.2 follows them. Whether Ri still asks before an app adds a task to the person's own Ri wasn't checked here (Ri wasn't run). Travel handles either.
5. **Which accounts an app may use (kit and Ri): closed.** Kit #10 added `connectors(ctx).accounts()` and `accounts` on Ri's `choose_account` answer, and Ri lists the accounts it lent with `ri__list_accounts` ([dynamismlabs/ri#4](https://github.com/dynamismlabs/ri/pull/4), merged). Travel uses both and no longer parses Ri's message. Since kit #12 the core exports `ConnectorAccount`, which Travel uses.
6. **Status answers passed as success (kit): closed.** Kit #10 turns `authorization_required`, `additional_permission_required` and `choose_connection_method` into `SetupRequired` with Ri's code. Travel's own mapping is gone.
7. **Error codes dropped (kit and Ri): closed.** Kit #10 keeps Ri's `code` (`ConnectorError`), so a deleted Ri task is `not_found`. Since [dynamismlabs/ri#7](https://github.com/dynamismlabs/ri/pull/7) Ri sends a provider's 404 or 410 as `not_found` with `httpStatus`, and kit #11 keeps the status. Travel tells them apart by it: 410 restarts a calendar, 404 drops a message or rescans an expired Gmail history. It reads "provider error 404 for GET …" only from a hub from before Ri #7.
8. **The kit's fixture source is narrow: mostly closed.** Since kit #10 it answers with Ri's errors, its status answers and an account list, which Travel's new tests use. Since kit #24 a tool answers by its arguments (`cases`, or `answer(args)` in code), so one message, one sync token or one task can answer on its own, and Travel's tests use that. Still open: its mail search understands plain words only, so a Gmail query with `{a b}` groups matches nothing. Travel tests Ri's fuller tools with its own fake hub, which keeps state between calls.
9. **Smaller kit notes.**
   - Closed for callers: error responses carry no stack, file path or internal message, over tRPC and MCP (`tests/mcp.test.ts`, and the switched service at `127.0.0.1:4313` answered a refusal without a stack). Closed since kit #12 and #13: `change` and `upgrade` rewrite the service definition. After the switch to `19bcb8c`, `local.travel`'s plist has `NODE_ENV` `production` and `ProcessType` `Interactive`. Before #13, a switch could hang: launchd loaded the new definition and never started it.
   - Closed: views can now be handed a starting address (`open_<app>`'s path, host links).
   - Travel's tool list is 36 tools and 187 KB, and its view resource is about 1 MB. Ri's per-chat tool loading keeps the list out of chats until needed.
   - A `show_*` card's `data` is validated against its full output schema. Travel reuses its detailed trip schema, so cards are large but exact.
   - Fixed in the kit, not shown for Travel: `create` now picks a free port per app, and `serve --install` refuses a port another installed app uses. The kit's tests show it. Travel already had its own port (4334 in `app.config.ts`, installed on 4313), and installing again wasn't in scope.
   - Still open: the kit's strict MCP Apps test host isn't exported from the core, so Travel keeps a copy (`tests/support/view-host.ts`).
   - Closed since kit #26: the build refused every prompt argument, since it checked the app's zod fields with `instanceof` against its own zod across tsx's loader, and a bad input on the running service came back as a 500 with JSON. The core now reads `_def.typeName` and knows a zod error by its shape. Since v0.1.5 `trip-check` takes its `trip`, and the switched service answers a bad input with a 400 naming its first problem.
10. **Backups (kit): closed.** Not one of Travel's findings at first, but Travel had both problems kit #10 fixed: its booking search is a full-text index, which no backup could restore, and its revision counters are triggers, which backups left out. Restores now keep both. `tests/backup.test.ts` restores a new backup and one in the older format, and an edit afterwards moves the revision. The installed Travel's nightly backup, written by the older core, restored into a scratch folder with its 39 triggers and a clean index.
11. **Fictional dates (Travel's own).** The preview's trips are in November 2026, so they turn past. `TRAVEL_NOW` pins "today" for the preview and tests.

## Tests

| Old suite (92 tests) | New suite (126 tests) | Notes |
| --- | --- | --- |
| domain (19) | domain (19) | Unchanged |
| parse (14) | parse (14) | Unchanged |
| workflow (20) | workflow (22) | The invocation-retry assertion became "a retry returns the first result as already applied". New permission copy. Added: waiting for approval, then the job's identical call. The preview test seeds with `seedPreview` instead of Ri's fixture principal. |
| sync (17) | sync (21) | Accounts come from the fake hub's grant, with Ri's tool names. Account labels are the names Ri shows. Every granted account is automatic. Reconnect and removal go through `check_accounts`. Fair rotation runs through the `sync_sources` job. Added: not connected to Ri, and several accounts named by Ri's list or, on a Ri without it, by Ri's choice. For v0.1.1: a provider's 404 and 410, from Ri's code and status and from an older Ri's text (two tests). |
| scope (15) | access (11) | Scopes became connections with chosen sources. "Revoked scope" and "no scope" moved to the kit's OAuth (`mcp.test.ts`) and an empty source list. "Job limited to its accounts" is now the hub's grant. "Access view" is now the consent screen's sources. The three replay tests became one retried-create test. The stored-reasons migration test is dropped (no old data). |
| contract (5) | contract (8) | Checks the kit's contract and MCP tools instead of Ri's package format. Added: exactly which tools are view-only, and `open_travel`'s paths. For v0.1.4: the `trip-check` prompt and the instructions, their copy, and that every tool they name exists. For v0.1.5: the `trip` argument, the text with and without it, and its limit. |
| view (2, Ri's packaged view in Chrome) | browser (9) | In the kit's strict host: the model's tool list and refused call, the @ menu and record reading, cards opening the app at a booking and at Review, `open_travel` at a booking, the place and selection reaching the assistant, a draft in the chat, directions and Open in browser through the host, Export saved through the host, a host link, and the same view in a host without drafts, links or files and in one that refuses links. Travel's own page at narrow and wide widths, and adding a pasted booking on an empty install. For v0.1.2: Settings inside the view. |
| none | MCP with OAuth (5) | The real server, with the MCP SDK's OAuth client and sources chosen on consent. Added: no stack, path or internal message reaches a caller, over MCP or the browser's tRPC, when Travel's database fails (since v0.1.2, a SQLite trigger refuses its trip writes, since Travel has no connection of its own to make read-only). For v0.1.1: an account whose data was deleted leaves a connection's choice and stays out after a resume. For v0.1.4: the instructions at connect, and the prompt listed and prepared over MCP. For v0.1.5: its `trip` argument listed, filled in, and refused when too long. |
| none | kit fixture source (10) | Import through the kit's capabilities on the kit's runner, PDF through `ri__extract_text`, approval wait across the runner, a declined approval, Ri down and connection revoked. Added with kit #10: accounts from Ri's list, accounts from Ri's choice, an account Ri says must sign in again, and a deleted Ri task. For v0.1.1: the kit's client keeps the provider's status Ri sends. For v0.1.4: answers by arguments (`cases`) for a deleted message, an expired sync token and a deleted task. |
| none | backups (2) | The kit's backup and restore keep the revision triggers and booking search, from a new backup and from one in the older format, and an edit after the restore moves the revision. |
| none | transactions (5) | For v0.1.2, on the core's `transaction()`. An inner transaction joins the outer one and rolls back with it, a statement outside any transaction commits on its own, and work that awaits is refused. SQLite refuses the last write of a manual booking, an import, a Gmail page with its checkpoint, and deleting an account's data, and nothing earlier is kept, the view revision and search index included. Each then succeeds once the refusal is lifted. |

## Not checked here

- Travel connected to Ri's real hub: its consent screen, a real Gmail account, real approvals. Ri wasn't run, as asked. The hub client was exercised with the kit's fixture source and a fake of Ri's hub built from Ri's code (branch `claude/single-path-ri-hub`).
- Ri allowing itself in Travel through the host grant (Ri #26), from another device. Ri wasn't run. The installed service answers the access choices, and an approve ran on a scratch copy.
- ChatGPT and Claude drawing Travel's view, and a Ri Home in everyday use. Ri was checked in a disposable Ri at f55cdf96 ([Real hosts](#real-hosts)). Ri's desktop app was checked for the other three apps, not for Travel.
- `serve --install` on core 0.2.2 and a real launchd service: done on November 16 (below). Since then the service has been switched by `upgrade` and `change`. Since kit #12 those rewrite its definition, which now has `NODE_ENV=production` (finding 9).
- Travel against a Ri with `ri__list_accounts` (ri#4) and real Gmail accounts. The account list is tested on the kit's fixture source and the fake hub.
