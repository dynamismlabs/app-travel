# Jobs and connectors: a worked example

This example adds "Add the books my book club emails about, every morning" to the Reading Log. It reads Gmail through the person's hub (Ri) and runs on its own. The same code is exercised in the builder repository's tests/connectors.test.ts.

## 1. Say what the app reads, and why

In src/app.ts, on the application:

```ts
connectors: {
  purpose: "to add the books your book club emails about",
  capabilities: ["mail.read"],          // "mail.read" and "calendar.read" exist today
},
```

Settings then shows a "Your accounts through Ri" section with a Connect button. It says, in plain words, what the app asks Ri for, from `capabilities` and `tools`, then this purpose: "Reading Log asks Ri to read your mail and add tasks to Ri, to add the books your book club emails about." Mail and calendar tools fold into "read your mail" or "send or change mail", and the like. Ri's own services read as Ri's consent screen names them, and an unknown tool as its provider and name in words, never `gmail__read_message`. Connecting opens Ri's consent screen, where the person chooses which accounts and tools the app gets. Ri enforces that grant, not the app. The token is kept encrypted in the installation's credential slot, so jobs can use it while nobody is signed in. Portable backups omit it.

The hub's address can be preset with `APP_HUB_URL` (for example `http://127.0.0.1:<Ri's port>/api/integrations/mcp`), which `serve --install` records in the service's config.env.

## 2. An action that imports, with a checkpoint

```ts
import { connectors, defineAction, stableId } from "@app-builder/core";

defineAction({
  name: "import_book_club", title: "Import book club picks", description: "Add books the book club emailed about.",
  input: z.object({}), output: z.object({ imported: z.number(), summary: z.string() }),
  effect: "write", retry: "safe", audience: ["user"],
  handler: async (ctx) => {
    const mail = connectors(ctx).mail();
    const since = typeof ctx.job?.checkpoint === "string" ? ctx.job.checkpoint : undefined;
    let imported = 0, newest = since;
    for (let cursor: string | undefined, first = true; first || cursor; first = false) {
      const page = await mail.search({ from: "club@books.example", after: since, limit: 20, cursor, withBody: true });
      for (const message of page.messages) {
        // A stable id from the source: a retried run saves each book once.
        const id = await stableId("book-club:" + message.id);
        const saved = await ctx.platform.db.insert(books).values({ id, userId: ctx.viewer.id, title: message.subject, /* … */ })
          .onConflictDoNothing().returning();
        imported += saved.length;
        if (message.date && (!newest || message.date > newest)) newest = message.date;
      }
      cursor = page.cursor;
    }
    // Move the checkpoint only after the records are stored.
    if (newest) await ctx.job?.saveCheckpoint(newest);
    return { imported, summary: `Added ${imported} book club ${imported === 1 ? "pick" : "picks"}.` };
  },
}),
```

The capability shapes don't depend on the source:
- `MailMessage` is `{ id, threadId?, from, to, cc, subject, date, snippet, text?, labels }`.
- `CalendarEvent` is `{ id, title, start, end, allDay, location?, status?, url?, joinUrl? }`.
- `connectors(ctx).call(name, args)` reaches any other hub tool by its own name and returns the hub's own shape, for example `gmail__send_email`. List those tool names in `connectors.tools`.

## 3. The job

```ts
import { defineJob } from "@app-builder/core";

jobs: [defineJob({ name: "import_book_club", title: "Book club picks", schedule: "daily at 07:00", action: "import_book_club" })],
```

**Schedule forms:**
- `"daily at 07:00"`
- `"weekly on monday at 07:00"`
- `"hourly at :15"`
- `"every 30 minutes"` (at least 5 minutes, dividing a day evenly)

Times are in the installation's time zone. On the Node service that's the computer's zone; on Cloudflare it's UTC until the person picks one in Settings. Days when the clocks change are handled.

**The app runs its own jobs.** The Node service checks every 30 seconds. A Worker checks from its five-minute cron trigger; keep `"*/5 * * * *"` in wrangler.jsonc. Settings shows each job's schedule, next run, last run and result, with Run now.

**What the runner guarantees:**
- **Each run has an ID**, the job plus its scheduled time. A duplicate wake-up does nothing, and a job has one unfinished run at a time.
- **Missed runs run once.** When the Mac wakes after three missed mornings, the job runs once. A newly declared job has missed nothing.
- **Checkpoints and waiting runs are stored in the app's database** and survive restarts. `saveCheckpoint` works only for the runner that holds the run. A runner that stalled and lost the run gets `LeaseLost`, and its work stops.

**How failures show up:**

| What happened | Thrown as | What the run does |
| --- | --- | --- |
| Ri is unreachable or failing | `SourceUnavailable` | Waits with growing delays, then retries. The checkpoint stays. |
| Not connected, access revoked, tool not granted, an account to reconnect or to choose in Ri | `SetupRequired` | Fails with a message saying what to do. The checkpoint stays, and Settings shows the hub as needing reconnection. Its `code` is Ri's answer, such as `authorization_required`, `additional_permission_required` or `choose_account`; for `choose_account`, `accounts` lists the names `account` takes. |
| A write that reaches outside needs approval in Ri | `ApprovalPending` | Waits on Ri's approval ID, also across restarts. It re-checks that the tool is still granted, then retries the identical call: every 5 minutes for the first hour, then every 30. Once approved, Ri accepts that call within 24 hours. A week without an answer fails. |
| The person declined that call in Ri | `ApprovalDenied` | Fails with the person's answer. The same call isn't made again until a new run, and Ri refuses it for 24 hours. |
| Ri answered with another error, such as a message or task that no longer exists | `ConnectorError` | Fails with Ri's message, unless your code catches it. Its `code` is Ri's (`not_found`, `unsupported`, `provider_error`…), `tool` the tool called, and `httpStatus` the provider's status when Ri sends one. |
| Anything else | | Fails with the error's message. The checkpoint stays. |

Throw `SourceUnavailable` or `SetupRequired` from your own code when a source you call yourself behaves that way. Branch on an error's `code`, never on its message's wording.

**Something gone at the provider.** When Gmail or Google Calendar answers 404 or 410, Ri sends `code: "not_found"` with the status as `httpStatus`, and it always arrives as a `ConnectorError`, whatever the provider's message says. Catch it to drop the item or start over:

```ts
try { return await connectors(ctx).call("google_calendar__list_events", { syncToken }); }
catch (error) {
  if (error instanceof ConnectorError && error.code === "not_found") {
    // 410: the sync token expired, so do a full sync. 404: the item was deleted, so drop it.
    if (error.httpStatus === 410) return fullSync(ctx);
    return null;
  }
  throw error;
}
```

Don't match "404" or "not found" in the message: it's the provider's wording. A Ri hub from before this change sends these as `code: "provider_error"`, so until it's updated, keep any older handling for that code.

**Which accounts Ri lent.** `await connectors(ctx).accounts()` lists them as `ConnectorAccount` objects (the type is exported from `@app-builder/core`): each with `name` (what a tool's `account` argument takes), the `tools` it backs, and, from a hub that lists its accounts, a stable `id` and `provider`. When Ri lends one account for a tool, its tools don't name it, so that account comes back with `name: null`; call without `account`. Pass `account` only with a name from this list. Key your own records by `id` when there is one: it stays the same across Gmail and Calendar and when the person renames the account, and changes only if the app is connected to a different Ri address.

## 4. Fixtures for tests and change checks

Write fixtures/connectors.json in the capability shapes:

```json
{
  "mail": { "messages": [
    { "id": "m1", "from": { "name": "Book Club", "email": "club@books.example" }, "to": [], "cc": [],
      "subject": "Next pick: Dune", "date": "2026-11-10T09:00:00.000Z", "snippet": "Dune", "text": "We're reading Dune.", "labels": [] }
  ] },
  "calendar": { "events": [] },
  "tools": { "gmail__send_email": { "approval": true } }
}
```

With `APP_CONNECTORS=fixtures` (and optionally `APP_CONNECTOR_FIXTURES=<file>`), the app serves connector calls from this file, using the hub's tool names. `change` and `serve --install` always check with fixtures. In tests, build the platform with `connectors: fixtureSource(data)`, and drive the runner with `runDueJobs(app, platform, { now: () => … })` to check a run, a duplicate wake-up, a failing source and a restart. Setting `"unavailable": true` or `"revoked": true` in the fixtures exercises the retry and setup states. A tool can answer with Ri's error (`"tools": { "ri__get_task": { "error": { "code": "not_found" } } }`, with `"httpStatus": 410` to stand for a provider's status) or one of its answers (`{ "result": { "status": "authorization_required", "provider": "google" } }`), and `"accounts": [{ "id": "a1", "name": "me@example.com", "tools": ["gmail__search_messages"] }]` is what `accounts()` returns.

A tool called through `call()` can answer by its arguments, so a sync that asks for one message, one page of history or one sync token gets the right answer:

```json
"tools": {
  "gmail__read_message": {
    "cases": [{ "args": { "messageId": "m1" }, "result": { "id": "m1", "headers": { "List-Id": "<club.books.example>" } } }],
    "error": { "code": "not_found", "httpStatus": 404 }
  },
  "google_calendar__sync_events": { "cases": [
    { "args": { "syncToken": "t1" }, "result": { "events": [], "nextSyncToken": "t2" } },
    { "args": { "syncToken": "expired" }, "error": { "code": "not_found", "httpStatus": 410 } }
  ] }
}
```

The first case whose `args` all equal the call's answers. Values compare deeply, so `"7"` isn't `7`, and arguments a case doesn't name may be anything. When no case matches, the tool's own `result`, `error` or `approval` answers. A tool with none fails the call, naming the arguments, so a missing case shows up in the test. In code, `answer: (args) => ({ result: … })` computes the answer instead, for example history that expires below some id.

## 5. Rules

- Only the installation's owner can connect the hub, see or run jobs, or change the time zone, and jobs act as the owner. Shared members and other accounts don't see these Settings sections.

- Read outside services only through `connectors(ctx)`. Never ask for Google or other upstream tokens, and never use Ri's credentials.
- Pass the action's own `ctx` to `connectors(ctx)`, never one saved from another call. Ri's audit log names the chat behind a hub call only from the tool call's `ctx`, which carries Ri's invocation context back.
- Ask once, for the app. The grant is per app and works the same from a button, a job or a chat.
- Keep imported records app-owned with stable ids. Revoking the hub stops future calls, and the records stay.
- Never return connector tokens or credential values in action outputs, loader data or MCP context.
