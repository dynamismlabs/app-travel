# Travel

Travel turns plans, reservations and changes into one trip you can inspect and discuss with your assistant. Open an upcoming trip to see what is booked, what is still an idea and what needs attention. It's a personal app built with App Builder: a small server on your Mac with its own database, used from its own page and from any assistant over MCP, such as Ri, Claude or ChatGPT. It was Ri's built-in Travel app. `docs/parity.md` lists what changed on the way.

## What it does

- **Trips**: upcoming and past trips with dates, the number of recorded reservations and one attention summary each. With one upcoming trip, Travel reopens it. With several, it reopens the last one you viewed or shows the list.
- **Trip**: an itinerary grouped by local date with a day rail, a Bookings table (filter by confirmed, planned, canceled or needs review, and search) and Ideas. Selecting a booking opens it beside the itinerary when there's room, and as its own screen with Back when narrower.
- **Review**: reservations without a trip, changes and cancellations to confirm, possible duplicates and extracted details to check. Each compares recorded and proposed values with the source before anything changes.
- **Sources**: the Gmail and Google Calendar accounts Ri lets Travel read, imported files, history range, coverage, last update, pending and failed counts, pause, continue import, delete imported data and Travel's settings.
- **In an assistant**: the whole app, the same as in your browser. `open_travel` opens it, at a trip or booking when asked, and `show_trip`, `show_trips` and `show_review` draw cards that open it. Trips and bookings appear in the host's @ menu. Ask in chat puts a question in the chat for you to send, links and maps open in your browser, and Open in browser takes you to the same place in Travel's own page. Review decisions, deleting, imports and settings are yours: the host keeps them from its model. Where you are and what you selected reaches the assistant.

Every segment keeps the local wall time the provider wrote, the time zone when known and the instant when it can be computed. Overnight journeys appear on both local dates with zone labels. A hotel is a date span with an exclusive check-out. Prices stay in their own currency and are never added across currencies. Ideas never count as bookings.

## Inputs

- **Gmail**, through Ri: confirmations from airlines, hotels, rail, car rental and booking platforms in the chosen history window (30, 90 or 365 days). New mail is checked against its headers before a body is read. A PDF attachment is read through Ri when the message body has no details.
- **Google Calendar**, through Ri: chosen calendars are read to show events while you are away. Nothing is written.
- **Files** (PDF through Ri, text, HTML and saved email, up to 512 KB) and **pasted text**, previewed before anything changes.
- **The manual form** for flights, trains, stays, car rentals and activities.

Extraction is deterministic first. An optional AI fallback (off by default, in Sources) uses your model through Ri, quotes exact passages, and always waits in Review.

## Run it

```sh
pnpm install --frozen-lockfile
pnpm preview
```

`pnpm preview` runs Travel with Alex Rivera's fictional trips on a new, empty data directory, and reads no account.

To run it as your own service, commit, then:

```sh
pnpm exec app-builder serve --install
```

It checks the commit in a separate copy (install, typecheck, tests, build, a rehearsal on a copy of your data) and starts it. The address is `http://127.0.0.1:4334`, and assistants connect to `http://127.0.0.1:4334/mcp`. Data lives in `~/.local/share/travel`. Change a running Travel with `pnpm exec app-builder change`, which switches only when the new commit's checks pass. Travel runs on your computer only, not on Cloudflare (docs/parity.md, finding 1).

## Connect it

- **Assistants** (a Ri workspace, Claude, ChatGPT) add `http://127.0.0.1:4334/mcp`. Travel's consent screen asks what each may see (each mail account, your manual entries, imported files) and whether it may also make changes. Settings lists every connection and can disconnect it.
- **Ri, for your accounts.** In Travel's Settings, under "Your accounts through Ri", enter Ri's integrations address and approve in Ri. Then allow Gmail, Calendar and Ri's services for Travel on its page in Ri. Sources shows the accounts Ri allows.
- Creating a Ri task from Travel waits for your approval in Ri. Travel adds it as soon as you approve.

## Develop

| Command | What it does |
| --- | --- |
| `pnpm test` | Every test. The browser checks run when there's a build and Chrome. |
| `pnpm test:view` | Build, then the browser checks: cards and the whole app in a strict MCP Apps host, and Travel's own page |
| `pnpm typecheck` | Types |
| `pnpm build` | The page, the server, the assistant view and `dist/contract.json` |
| `pnpm preview` | The fictional preview |
| `pnpm fixtures` | Rewrite `fixtures/connectors.json` from the fictional messages |

Tests use disposable data directories and fictional people, providers and messages. Hub features are tested against the kit's fixture source and a fake of Ri's hub. Backups and restores use the kit's `app-builder backup` and `restore`.
