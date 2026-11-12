# Your personal app

This app owns its source, database and photos. The core package supplies sign-in, OAuth/MCP, shared action execution, private files and runtime commands. Change identity in app.config.ts, data in src/schema.ts and src/app.ts, and screens in src/screens.tsx. Keep the app id stable after creating real data.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For production, run `pnpm build` and `pnpm start`. Read the printed web/MCP addresses and data directory. Default storage is `~/.local/share/<app-id>`; APP_DATA_DIR selects another directory. The first local account created in Settings adopts existing records. Remote access requires APP_AUTH=required and APP_URL set to the app's public origin. An optional .env is read at runtime and excluded from images and source control. A private `<data-dir>/config.env` can hold service configuration. Environment variables override files.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | SSR Node server with Vite middleware, on loopback |
| `pnpm build` | Web, Node, Worker, MCP view, action contract and migrations |
| `pnpm start` | Production Node server |
| `pnpm test` | Retried create, MCP read and restart persistence |
| `pnpm typecheck` | App and core public types |
| `pnpm exec app-builder db migrate` | Apply immutable migrations while the server is stopped |
| `pnpm exec app-builder serve --install [<commit>]` | Check the committed app and install it as a launchd/systemd user service |
| `pnpm exec app-builder change [<commit>] [--json]` | Check a new commit, then switch the service over, rolling back on failure |
| `pnpm exec app-builder serve --uninstall` | Remove that service, retaining data and releases |
| `pnpm run deploy --dry-run` | Validate the Worker without changing cloud resources |
| `pnpm run deploy` | Provision/reuse D1 and private R2 buckets and deploy |
| `pnpm exec app-builder backup <folder>` | Whole-installation backup |
| `pnpm exec app-builder restore <folder>` | Restore to an empty APP_DATA_DIR |
| `pnpm exec app-builder backup <folder> --cloudflare` | Download a portable cloud backup |
| `pnpm exec app-builder restore <folder> --cloudflare` | Restore into a new, empty deployed target |
| `pnpm exec app-builder handoff [--cloudflare]` | A new handoff code for restored records nobody has taken over |
| `pnpm exec app-builder mcp <app address>/mcp` | A stdio bridge for desktop hosts that only start commands |
| `pnpm exec app-builder contract` | Print generated action metadata |

An exported app pins the core in vendor/ and records appBuilder.starterVersion in package.json. Upgrade the dependency and lockfile to take a core fix; keep customized app code. In the builder workspace, build the core before running an example. Docker instructions below apply to an exported independent app, with vendor/ and its own lockfile.

## Background service

Commit, then run `serve --install`. The service runs a checked copy of that commit, `<data-dir>/releases/<commit>`, never this folder, so editing here can't affect the running app. It runs as your user, starts with your user session and restarts if it stops. Logs are in `<data-dir>/server.log`. Service settings supplied through APP_URL, APP_PREVIOUS_URLS, APP_HOST, APP_AUTH, PORT, APP_SECRET and APP_HUB_URL are saved privately in `<data-dir>/config.env`. On Linux, user services require a user manager; enabling linger for boot without login is an administrator choice.

To change the running app, commit and run `change`. It installs, typechecks, tests and builds the commit in a separate copy with disposable data and fixture connectors, starts it once on a copy of your data to rehearse its migrations, and only then stops the service, snapshots the database, switches and checks the new build answers. If the switch fails, the previous build and the data from before the change come back together. Exit codes, `--json` progress and every step are in docs/safe-change.md of the builder repository. Never run a second server on the service's data directory. Data and releases are retained when uninstalling.

## Jobs and your accounts

Jobs the app declares run on their own in your time zone; Settings shows each one's schedule, last and next run and result, with Run now. An app that reads your mail or calendar asks Ri for them once, under "Your accounts through Ri" in Settings; Ri asks you which accounts and tools it may use. Tests and `change` checks use fixtures/connectors.json instead (APP_CONNECTORS=fixtures), never your accounts.

## Docker

```sh
docker build -t my-personal-app .
docker run --name my-personal-app -p 4310:4310 \
  -e APP_URL=http://localhost:4310 \
  -v my-personal-app-data:/data my-personal-app
```

The image runs as an unprivileged user with sign-in required. On a remote server, APP_URL is the public HTTPS origin and a reverse proxy handles HTTPS. The data volume survives replacement of the container. .env files are excluded from the build context; supply secrets at runtime. Change published ports and APP_URL together if this port is already in use.

## Cloudflare

Sign in with `pnpm exec wrangler login`. Run `pnpm run deploy`; set CLOUDFLARE_ACCOUNT_ID if more than one account is available. The command creates or reuses named D1 and R2 resources, applies migrations, deploys, configures a runtime secret and prints the addresses. Repeating it preserves data. wrangler.deploy.json records resource IDs and is ignored by Git. App name changes do not rename cloud resources automatically: preserve APP_WORKER_NAME when renaming the displayed app.

Leave APP_PUBLIC_URL unset to use workers.dev. For your own domain, set APP_PUBLIC_URL to its HTTPS address, such as `https://recipes.example.com`, in `.env.cloudflare` and deploy. The deploy attaches it to the Worker as a custom domain, so the domain must be a zone in the same Cloudflare account and the name must not already point somewhere else in DNS. `.env.cloudflare` is a private deploy configuration file. Local APP_URL is deliberately not used for the cloud address. The build checks for leaked configured secrets and enforces the 3 MiB compressed Worker limit.

## Changing the address

Choose the address before people install the app. Sign-ins, home-screen installs and anything saved offline belong to the address they were made on. When you change it:

1. Set the new APP_PUBLIC_URL and deploy. The old address keeps answering, now listed in APP_PREVIOUS_URLS, and shows a notice pointing to the new one. Anything waiting to upload on a phone uploads the next time the app is opened there.
2. Everyone signs in at the new address, and adds it to their home screen again if they had it there. Assistants are connected again at `<new address>/mcp`; the old address sends new assistant sign-ins to the new one.
3. Once everyone has moved, set `APP_PREVIOUS_URLS=` (empty) in `.env.cloudflare` and deploy. The old address then refuses requests. If an old custom domain is still listed under the Worker's Domains & Routes, remove it there.

On a Mac mini or in Docker, set APP_URL to the new address and APP_PREVIOUS_URLS to the old one (comma-separated for several), restart, and remove APP_PREVIOUS_URLS later. Invitations, password resets and assistant sign-in always use the current address.

## Backups and moving

Nightly at 03:00 UTC, Node writes dated portable snapshots and photos under `<data-dir>/backups`; the Worker writes snapshots and content-addressed photos into its private BACKUPS bucket. Keep an off-site copy of local backups. Whole-installation backups contain password hashes and must stay private. They exclude sessions, assistant connections and retained upstream tokens. Settings' personal export is a separate NDJSON download of the app-declared personal records and authorized photos.

Restore locally with a new empty APP_DATA_DIR. Reusing a nonempty destination is refused. Sign in again and reconnect assistants after any restore.

**Records kept without an account.** If the app was used in local-owner mode (no account), a restore prints a one-time handoff code. Where sign-in is required (Cloudflare, or APP_AUTH=required), sign in or create an account, open Settings and enter the code: the local owner's records, photos and collections become yours, and every other account keeps exactly its own access. The code works once and expires after 14 days; `handoff` issues a new one. On this computer in local-owner mode the records are already yours, and your first sign-up keeps them.

For local → Cloudflare:

1. Stop the old server so no new writes arrive, then run `backup <folder>`.
2. Keep the same source/app id and migrations. Choose a new APP_WORKER_NAME and deploy an empty target.
3. Run `restore <folder> --cloudflare`. The command refuses a target with user data or a different migration history. It copies photo bytes, imports records/accounts/memberships and checks relationships. It prints a handoff code if the records were kept without an account.
4. Sign in at the new HTTPS address (enter the handoff code in Settings if one was printed), verify records and photos and reconnect MCP clients. Redeploy once to verify resources and migration history are reused. **Cloudflare is now the writer. Leave the old local server stopped.**

For Cloudflare → local, stop writes at the source, run `backup <folder> --cloudflare`, then restore to an empty local directory and start there. Select only one active writer afterward. This is a move, not synchronization.

## Using it from an assistant

Add `<app address>/mcp` as an MCP server; Settings shows the address. Every assistant connects with OAuth, even on this computer: the app's consent screen asks what that connection may see (in Recipe Box, which collections) and whether it may also make changes, and the app enforces that on every call. In local-owner mode the consent screen needs no sign-in. Each Ri workspace, Claude or ChatGPT is its own connection with its own choice; Settings lists them with their access and can disconnect each one. A local app also answers on `localhost` and `[::1]` at the same port. Desktop hosts that only start local commands use `app-builder mcp <app address>/mcp`, which opens the consent screen once and keeps its token in a private file (APP_MCP_TOKEN supplies one for scripts). Assistants that draw MCP Apps views (ChatGPT, Claude, Ri) also get render tools: each `show_*` tool draws a card in the chat, and `open_<app>` (for example `open_reading_log`) opens the whole app full screen. The other tools return data only. Declare render tools in `views` in src/app.ts and draw their cards in src/screens.tsx (`viewCards`). The view loads nothing from the network; everything goes through the assistant's tool calls.

## Customize safely

Read AGENTS.md and `.agents/skills/build-personal-app/SKILL.md`. Append migrations; never rewrite applied SQL. Keep IDs stable across retries. Both web and MCP actions recheck record access. Define a private-file policy before enabling uploads. Use a populated disposable fixture for changes to existing apps. The local data directory is outside the checkout; set APP_DATA_DIR for every automated check or preview.

## Rendering and credentials

React Router framework mode renders the web app on Node and Workers, then hydrates it in the browser. src/root.tsx loads authorized initial reads; src/routes.ts defines routes; src/screens.tsx owns the screens. src/main.tsx is the separate offline/MCP entry. The offline worker caches a public shell, never personalized SSR HTML. Retained service credentials use the core backend vault (AES-256-GCM with the runtime secret outside the database). Portable backups omit them. Restores require reconnecting. Sign-in provider tokens are discarded after authentication. Google sign-in and direct connectors are not enabled in this starter.
