# Run it, connect it to Ri, and change it safely

The complete command reference, with exit codes and the `--json` lines, is docs/safe-change.md in the builder repository. This page is the path through it.

## Run it as the person's own service

1. Commit. A running app always uses a fixed commit; uncommitted changes are never installed. vendor/ (the pinned core) and pnpm-lock.yaml must be committed.
2. From the app's folder, run:

   ```
   pnpm exec app-builder serve --install
   ```

   Optionally set `PORT`, `APP_HUB_URL` (Ri's integrations address) or `APP_URL` in the environment; they're recorded in the service's `<data dir>/config.env`.

   The command:
   - copies the commit into `<data dir>/releases/<commit>`
   - installs from the lockfile
   - runs typecheck, test and build with disposable data and fixture connectors
   - starts the build once on a copy of any existing data
   - installs and starts the service, and checks `/api/health`

   On a Mac the service is a launchd agent (`local.<app id>`): it starts at login and restarts if it stops. On Linux it's a systemd user unit.
3. The app prints, and Settings shows, its address, `http://127.0.0.1:<port>`. The MCP address is that plus `/mcp`.

Data stays in `~/.local/share/<app id>` (or `APP_DATA_DIR`), outside the folder. Only the service writes it. Never start a second server on it, and never run the app from the folder you're editing: `pnpm dev` with a disposable `APP_DATA_DIR` is for development.

## Connect it to Ri, and to other assistants

**Ri connects to the app like any MCP server.** Add the app's MCP address to a workspace. Each workspace is its own connection (its own OAuth client). The app's consent screen asks what that workspace may see, and whether it may also make changes.
- In local-owner mode, the consent screen needs no sign-in.
- The app also answers on `localhost` and `[::1]` at the same port.
- Settings lists every connection with its access and can disconnect it.

**Claude, ChatGPT and any other MCP client** connect the same way. A desktop host that can only start commands uses `pnpm exec app-builder mcp http://127.0.0.1:<port>/mcp`, which opens the consent screen once and keeps its token privately.

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
   | 2 | The switch failed. The previous build and its data from before the change are running again. |
   | 3 | The switch failed and so did the rollback. The message names the snapshot; tell the person. |
   | 64 | Refused: not committed, an unknown ref, not installed yet, or another change running. |

A rollback restores the app's own data. It can't undo anything that already reached outside, such as a sent email.

## Recovery

- **A crash** restarts the service on its own (launchd's KeepAlive, systemd's Restart).
- **`backup <folder>`** makes a portable, sensitive backup of an installation.
- **`restore <folder>`** restores into an empty data directory.
- **Records kept without an account** (local-owner mode) come with a one-time handoff code when restored onto a target that requires sign-in. The signed-in person enters it in Settings to take them over.
- **After a restore,** reconnect assistants and connect Ri again.
