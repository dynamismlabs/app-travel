# Run it, connect it to Ri, and change it safely

The complete command reference, with exit codes and the `--json` lines, is docs/safe-change.md in the builder repository. This page is the path through it.

## Run it as the person's own service

1. Commit. A running app always uses a fixed commit; uncommitted changes are never installed. vendor/ (the pinned core) and pnpm-lock.yaml must be committed.
2. From the app's folder, run:

   ```
   pnpm exec app-builder serve --install
   ```

   Optionally set `PORT`, `APP_HUB_URL` (Ri's integrations address) or `APP_URL` in the environment; they're merged into the service's `<data dir>/config.env` when it switches. An existing `APP_SECRET` is never replaced, and a failed install leaves the file untouched.

   The command:
   - copies the commit into a new build, `<data dir>/releases/<commit>-<time>`
   - installs from the lockfile
   - runs typecheck, test and build with disposable data and fixture connectors
   - starts the build once on a copy of any existing data
   - installs and starts the service, and checks `/api/health`

   On a Mac the service is a launchd agent (`local.<app id>`): it starts at login and restarts if it stops. On Linux it's a systemd user unit.

   The service runs the Node that ran the install. With Homebrew's Node it records `/opt/homebrew/bin/node`, which stays across Homebrew's updates. With nvm (or another version manager without a lasting path) it records that version's own path, and the install's message says so: removing that version stops the app. `change` and `upgrade` build, check and rehearse with that same Node, whatever Node your shell has first on PATH, and the first step says which. To move the app to another Node, or after a major update of the same Node path, run `serve --uninstall` (data and builds are kept), then `serve --install` with that Node, because the build's native dependencies are built for one Node. A first install refuses a Node that doesn't satisfy the app's `engines.node`; switch to one that does (`nvm use`, for example) and run it again.
3. The app prints, and Settings shows, its address, `http://127.0.0.1:<port>`. The MCP address is that plus `/mcp`.

Each app has its own port, in `port` in app.config.ts. `create` picks a free one that no installed app uses (in 4310–4809; `pnpm dev` also uses the port 1000 above). `serve --install` refuses a port another app installed on this computer already answers on, and says which app: set `PORT` for the install, or change `port` in app.config.ts and commit it. Keep an installed app's port: Ri and other assistants connect to its address.

Data stays in `~/.local/share/<app id>` (or `APP_DATA_DIR`), outside the folder. Only the service writes it. Never start a second server on it, and never run the app from the folder you're editing: `pnpm dev` with a disposable `APP_DATA_DIR` is for development.

## Connect it to Ri, and to other assistants

**Ri connects to the app like any MCP server.** Add the app's MCP address to a workspace. Each workspace is its own connection (its own OAuth client). The app's consent screen asks what that workspace may see, and whether it may also make changes. In an app with add actions (`adds: true`), it can also be limited to only adding.
- In local-owner mode, the consent screen needs no sign-in.
- When Ri installed the app on its own computer, Ri asks these questions in its own UI and grants the answer with the app's host key (`host-key` in the data directory), so connecting works when Ri is used from a laptop or phone. The app needs nothing for this. The key is Ri's: never read, copy or commit it, or use it to connect anything yourself.
- The app also answers on `localhost` and `[::1]` at the same port.
- Settings lists every connection with its access ("Can read and make changes", "Can read only", "Can only add") and can disconnect it. A client can disconnect itself too, by revoking its refresh token at the app's `revocation_endpoint` (RFC 7009).

**Claude, ChatGPT and any other MCP client** connect the same way. A desktop host that can only start commands uses `pnpm exec app-builder mcp http://127.0.0.1:<port>/mcp`, which opens the consent screen once and keeps its token privately. A browser extension or a web page connects the same way too, as a public client with PKCE (see [platform gotchas](platforms.md#clients-in-a-browser)).

**The app connects back to Ri** to use the person's accounts, if it declares `connectors`. In Settings, under "Your accounts through Ri", enter Ri's integrations address (or preset `APP_HUB_URL`) and approve in Ri. The token is kept for the whole installation, so jobs can use it. See [jobs and connectors](jobs-and-connectors.md).

## Change it safely

1. Make the change on a branch or in your own working copy: code, an appended migration, tests. Check it with a disposable `APP_DATA_DIR`, then commit.
2. From the app's folder, run:

   ```
   pnpm exec app-builder change <commit>
   ```

   Leave out `<commit>` to use HEAD; add `--json` for one JSON object per line.

   The command checks the commit in a separate copy, with disposable data and fixtures. It then starts the new build once on a copy of the live data, which runs its migrations. Only after both pass does it:
   - stop the service
   - snapshot the database into `<data dir>/backups/change-<time>`
   - point the service at the new release and start it
   - check that the new release is the one answering
3. Read the exit code:

   | Code | Meaning |
   | --- | --- |
   | 0 | Switched, or that commit was already running. |
   | 1 | A check failed. Nothing changed, and the running app is untouched. Read the log path it prints, fix, commit, and run `change` again. |
   | 2 | The switch failed. The previous build and its data from before the change are back. If the result has `"answering":false`, that build was still starting when the command stopped waiting: check `status`, and never restore the snapshot yourself. |
   | 3 | The switch failed and so did putting the previous build and its data back. The message names the snapshot; tell the person. |
   | 64 | Refused: not committed, an unknown ref, not installed yet, another change running, or a Node that's gone or too old for `engines.node`. The message says what to do. |

A rollback restores the app's own data, once. It can't undo anything that already reached outside, such as a sent email.

The switch waits for the new build about three times as long as it took to answer on the copy of the data, between 1 and 10 minutes. On a computer that's very busy, add `--health-timeout <seconds>` to wait longer.

**Keep `pnpm test` free of timing.** `change`, `upgrade` and `serve --install` run it as their gate, often while the computer is busy with other work, so a test that asserts wall-clock time (a p95 budget, "finishes in under 2 s") fails a correct change. Put those in a separate `test:perf` script that you run yourself. Checks that don't depend on the clock, such as `EXPLAIN QUERY PLAN` showing that a query uses its index, belong in `pnpm test`.

## Check on it, and keep its core current

- `pnpm exec app-builder status` says whether the service is running, which release and core it runs, its address and MCP address, the last change and the last error. Add `--json` for the exact shape (docs/safe-change.md).
- `restart`, `start` and `stop` control the service; `logs --lines 200`, `logs --since 1h` and `logs --follow` show its log, and `logs --change` the last install, change or upgrade.
- `pnpm exec app-builder upgrade` moves the app onto a newer kit core (security fixes arrive this way). Commit first. It prepares the upgrade on a branch in a separate copy and switches only when the app's checks pass, like any change. The new core's own `change` makes the switch. An app on kit `df533b0` or earlier switches with its older core, so run `change` once after that upgrade. Once it has merged the upgrade into the app's folder, it runs `pnpm install --frozen-lockfile` there, so the folder's own `pnpm exec app-builder` is the new core's. If it says it couldn't, or you merged the upgrade branch yourself, run that before any other command.

## Recovery

- **A crash** restarts the service on its own (launchd's KeepAlive, systemd's Restart).
- **A change interrupted mid-switch** (sleep, power loss, a killed process) is settled by the next `status`, `start`, `restart` or `change`: the new build is kept if it answers, otherwise the previous build, data and settings come back.
- **`backup <folder>`** makes a portable, sensitive backup of an installation.
- **`restore <folder>`** restores into an empty data directory.
- **Records kept without an account** (local-owner mode) come with a one-time handoff code when restored onto a target that requires sign-in. The signed-in person enters it in Settings to take them over.
- **After a restore,** reconnect assistants and connect Ri again.
