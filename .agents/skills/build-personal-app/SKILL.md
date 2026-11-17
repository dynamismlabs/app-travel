---
name: build-personal-app
description: Build, run and change an independent personal app with App Builder's core (SQLite/D1, a web UI, MCP tools and views, jobs, connectors). Use for a new personal app, to run one as a service or connect it to Ri, or to change an app built with this kit.
---

# Build a personal app

Every app is an ordinary MCP server that runs on its own (a Mac service or Cloudflare) and keeps its own data. Any agent uses it through MCP with OAuth. Ri connects to it like any connector, and lends it the person's accounts as a hub. Nothing here needs conversation history: follow these steps and the linked references.

## 1. Start

For an existing app, begin with its AGENTS.md, app.config.ts, src/schema.ts and src/app.ts. Keep its source and data owned by that app. For a new app, identify the first useful workflow, who uses it and where it runs. Infer ordinary choices; ask when a choice changes privacy, cost, sharing or hosting.

Create the minimal starter with `pnpm create:app <new-folder>` from the builder repository, or `pnpm exec app-builder create <new-folder>` with the core installed. The new folder is a git repository with a `.gitignore`, a pinned core tarball in vendor/ (commit it), an independent lockfile, this skill (in .agents/skills, linked from .claude/skills) and local, Docker and Workers targets. Install with `pnpm install --frozen-lockfile`. Set a disposable APP_DATA_DIR during development; never open the person's real data directory. App identity belongs in app.config.ts; keep the stable id once real data exists.

## 2. Build one complete slice

Drizzle table, appended SQL migration, validated action with output schema and permissions, editable React screen, and the MCP tool the same action becomes. Use the core's sign-in, assistant authorization and private-file routes; never copy them into app code. Browser imports use `@app-builder/core/react`; backend code imports the other core subpaths. Read [the worked resource example](references/add-resource.md) when adding a table or action.

The starter uses React Router framework mode SSR with Vite. Screens live in src/screens.tsx, framework routes in src/routes.ts and the initial loader in src/root.tsx. Use `loadAppPage` from `@app-builder/core/ssr` to seed authorized read actions; keep platform objects, secrets and credential values out of loader results. src/main.tsx is the browser entry for MCP and the public offline shell. Keep personalized SSR responses private/no-store and out of the service-worker cache.

Borrow only the reference behavior the workflow needs. Reading Log shows a private tracker and optimistic edit checks. Recipe Box shows collection roles, private photos, replay-safe offline capture and collections as connection sources. Installed reference source is under `node_modules/@app-builder/core/templates/starter` and `templates/recipe-box`; edit the app's own source. When the entire shared recipe workflow fits, create with `--example recipe-box`.

For new records, keep the client-generated UUID through all retries. `client.save` durably queues a create and its File objects before returning. Existing-record edits carry expectedUpdatedAt and report conflicts. Define authorizeFile against the parent record for both read and write. Sharing is an explicit product decision: enable sharingActions and enforce the app's chosen role policy in every action.

## 3. Views for assistants

Actions are data tools and draw nothing. Declare `show_*` render tools in `views` with `defineView` (Reading Log's `show_books` takes ids, a filter and a title, and returns a one-line summary for the model plus `data` for the card; its `output` schema describes that `data`). The core adds `open_<app>` (the whole app full screen), the view resource and the metadata ChatGPT and Claude read. Write one card per `show_*` tool in src/screens.tsx, frame it with `ViewCard` and export it in `viewCards`. The view reaches nothing on the network: it uses only actions whose audience includes "agent", and photos come through `Photo`. Use `Form` and dialogs, never window.prompt/confirm. Style cards with the host's variables and the app's palette as the fallback, under `html[data-view="card"]`; never set color-scheme.

Publish the selection with `client.select({ id, title })` (a fixed, bounded shape: only the id and title are sent) and clear it with `client.select(null)` on deselection or leaving the view. Say where the person is with `client.setSection({ title, path, filters })` and, for a bulk step, `client.selectMany(records, total)`. After the person changes something in a view, call `client.didChange("Marked Dune as finished")`. Hosts still fetch records through authorized actions.

The whole app works inside a host, not a smaller version. Give every record its own path (`/books/<id>`) and declare `records` so `open_<app>` opens it and the host's @ menu offers it; pass the router's `navigate` to `EmbeddedView` in src/main.tsx so the view follows the host there. For what leaves the frame, use the core's calls, which each check what the host allows and degrade on their own: `ExternalLink` (or `client.openLink`) for links out, `client.download` for files, `AskInChat` (or `client.draftMessage`) to put a question in the chat for the person to send, and `OpenInBrowser` in the header, which the cards already show. Mark actions only the person should take, such as deleting, `visibility: ["app"]`; mark nothing else. Read [platforms](references/platforms.md#assistant-views) for the exact shapes.

## 4. What each connection may see

Every assistant connection (a Ri workspace, Claude, ChatGPT) uses OAuth, even on the person's own Mac, and the app's consent screen asks what it may see and whether it may also write. The core refuses writes for read-only connections. If the app has separate parts a connection could be limited to (collections, accounts, bank accounts), declare `sources` on the application and apply the choice in every query, search, count and export: `collectionSources` when they are sharing collections (requireRole and readableSpaceIds then apply it), otherwise your own `list` plus `sourceFilter`/`requireSource` from `@app-builder/core` in each query. Apps without sources skip that question. A source you delete drops out of every connection's choice: `ctx.connection.sources` only ever names sources your `list` still returns, so don't check for deleted ones. The person's own browser sees everything they can.

## 5. Outside services and jobs

When the workflow needs the person's mail or calendar, read them with `connectors(ctx)` from the core: `mail().search`, `mail().get` and `calendar().listEvents` return the same shapes from any source, and `call()` passes anything else through. The one live source is the person's hub (Ri), connected once in the app's Settings; the token stays in the installation's encrypted slot and the app never holds Google tokens. Declare `connectors: { purpose, capabilities }` on the application so Settings and Ri can explain the request. Tests and change checks use the fixture source (APP_CONNECTORS=fixtures with fixtures/connectors.json), never live accounts.

For work that should happen on its own ("import new receipts every morning"), declare a job: `defineJob({ name, title, schedule: "daily at 07:00", action })`. The app runs it itself, in the person's time zone, and Settings shows its schedule, last run and result. Save progress with `ctx.job.saveCheckpoint` after each batch you've stored, and give imported records stable ids from their source so a retry never imports twice. A missing hub, a revoked grant or an unreachable source becomes a setup or retry state, and the checkpoint stays put. Writes that reach outside (sending email) wait for the person's approval in Ri. Read [jobs and connectors](references/jobs-and-connectors.md) for the worked example and the rules.

Store any other backend credential only with putCredential/getCredential/deleteCredential; never return credentials in action outputs, loader data or MCP context.

## 6. Verify

Use the workflow in a browser and through an MCP client (tests get a token with `createTestConnection` from `@app-builder/core/node`). Restart the production server and read saved records again. Test permissions from a second user and a limited connection when applicable, including direct file and MCP access. For changes to existing apps, migrate a populated disposable fixture and compare old ids and photos. Run `pnpm typecheck`, `pnpm test` and `pnpm build`. [Platform gotchas](references/platforms.md) covers offline capture, Workers, migrations and remote access.

## 7. Run it, connect it to Ri, and change it safely

Commit, then `pnpm exec app-builder serve --install` runs the committed app as a background service (launchd on a Mac) from a checked copy, never from the folder you edit. Change it with `pnpm exec app-builder change`: it checks the new commit in a separate copy with disposable data and fixtures, rehearses its migrations on a copy of the data, and only then switches, rolling back build and data together if the switch fails. Connect assistants at `<address>/mcp`. Read [run, connect and change](references/run-connect-change.md) before installing, connecting to Ri or changing a running app; never run the app from the folder you're editing, and never start a second server on its data directory.

## 8. Hand back

The working address, what the person can do, the data directory, the backup/restore commands, the MCP address and how to connect Ri. Update AGENTS.md with commands, core/starter versions, modules, sources, jobs, connectors, hosting targets and context behavior. Say which checks ran locally and which live host checks (Ri, Claude, ChatGPT, Cloudflare) you could not perform.
