# Platform gotchas

## Storage and migration

Node defaults to `~/.local/share/<app-id>`, overridden by APP_DATA_DIR. Rebuilds reuse it. Always set a temporary path for tests. serve holds a heartbeat lock for one owning process; stop a service before running a migration command. Do not run a host-managed server and a standalone server on the same directory.

Use one SQLite dialect on native SQLite and D1. D1 batch is atomic; arbitrary interactive transactions are not available through this driver. Keep migration statements split with `-- statement-breakpoint`. Preserve applied SQL and append migrations: the ledger checks SHA-256 checksums. Test populated migrations on both drivers. D1 has statement and parameter limits; keep individual statements small and use bounded batches. Read the [current limits](https://developers.cloudflare.com/d1/platform/limits/) before large imports.

## Workers

Bindings and auth are created per request. Do not cache a request's bindings, viewer or database in module globals. The build emits one Worker and checks its gzip size against 3 MiB. Runtime secrets use Worker secrets, never VITE_ variables. All build targets scan output for configured secret values.

After-response waitUntil work has a limited lifetime (currently 30 seconds); use a scheduled handler, queue or durable workflow for longer imports. Nightly backups run from a scheduled handler. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## MCP and context

The endpoint is `/mcp`, with Streamable HTTP and optional MCP Apps HTML resources. A call without a token returns this, on the local machine too:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://your-app/.well-known/oauth-protected-resource"
```

The core owns discovery, dynamic registration, PKCE and consent. Every connection (one OAuth client registration: a Ri workspace, Claude, ChatGPT) gets the consent screen, which asks which of the app's sources it may see and whether it may also write. In local-owner mode it needs no sign-in. A connection's token works only on `/mcp`: the website (SSR, tRPC, photos, export) refuses it, so its limits apply everywhere it can reach. The core refuses writes for read-only connections; the app applies the source choice in every query, search, count and export. Declare `sources` on the application: `collectionSources` when your sources are sharing collections (requireRole and readableSpaceIds then apply the choice), or your own `list` plus `sourceFilter`/`requireSource` in each query. A revoked/expired token must fail on its next request while another valid connection still works. Refresh tokens rotate: each refresh retires the old one. For 30 seconds the old one returns the same new pair; replaying it after that revokes that connection's tokens, so its client connects again. Selected-record context is advisory app data; actions recheck the caller's access. Hosts without MCP Apps still get structured tool results.

### Assistant views

The pattern matches Ri's own MCP server and what ChatGPT and Claude expect:

- Actions are data tools. They return `structuredContent: { result }` and draw nothing.
- `show_*` tools (declared with `defineView`) draw a card: `structuredContent: { view, data }` plus a one-line summary the model reads. Declare `output`, the schema of `data`: every tool advertises an output schema, and clients check results against it. Accept `ids` so the model can show exactly what it just found or changed, and say so in the description, which also points the model to the matching read action.
- `open_<app>` is added by the core. It opens the whole app full screen, optionally at `path` (a place as the app's own address names it, such as `/books/<id>`: one leading `/`, no `#`, at most 2 KiB), and returns `{ view, path? }`. It's ChatGPT's app-list entry (`openai/ui.entrypoints: [{ type: "global" }]`) and stays visible to the model: ChatGPT won't draw a hidden tool's view. Describe your paths in `records.paths` so the model knows what to pass.
- Render tools carry `ui.resourceUri`, `openai/outputTemplate`, `openai/widgetAccessible` and `openai/toolInvocation/invoking|invoked`. Actions the screens call carry `openai/widgetAccessible`. Their results carry the app's address in `_meta["app/url"]`, which hosts give the view and keep from the model.
- An action with `visibility: ["app"]` is view-only: its tool carries `_meta.ui.visibility: ["app"]` (and `openai/visibility: "private"`), so a host that follows MCP Apps keeps it out of the model's tool list and refuses the model's call, while the view can call it. It's the host's rule, not a check the app can make (the view and the model share one connection), so the app's own checks still apply: a view-only write still needs a connection that may write. Use it for the person's own decisions, such as deleting; mark nothing else. It needs the "agent" audience.
- An app that declares `records` (`paths`, `search(ctx, query)`, `read(ctx, path)`) offers them to the host's @ menu: the core advertises `openai/mentions: { searchTool: "search_mentions" }`, adds that view-only, read-only tool (up to 20 `resource_link`s with `uri: "app://<app-id><path>"`), and answers `resources/read` on those URIs as the connection, as markdown of at most 32 KiB. Filter both by the caller, as in any read.
- The resource `ui://<app-id>/main` (`text/html;profile=mcp-app`) declares an empty CSP (`connectDomains`, `resourceDomains`), `prefersBorder` and inline/full-screen display modes, both on the listing and on the read result.

Inside the view:

- Nothing reaches the network. Data goes through `client.call` and photos through `Photo`, both as host tool calls, so the screens can use only actions whose audience includes "agent".
- Hosts frame the view in a scripts-only sandbox: forms never submit, window.prompt/confirm/alert do nothing, and there is no same-origin storage or service worker. Use `Form`, dialogs and in-memory state. src/main.tsx uses a MemoryRouter because the frame has no address of its own.
- The core applies the host's theme (`data-theme`), style variables and fonts on `<html>`, and marks `data-view="card"` or `"app"`. A card sits on the host's background; style it with the host's variables and the app's palette as the fallback. Never set color-scheme: Chromium paints an opaque canvas under a frame whose scheme differs from its host's.
- A card is a snapshot. It updates its own rows after the person changes one; when the model changes data, it calls the `show_*` tool again. `client.openFullscreen(path)` opens the whole app at one record from a card.
- The view goes where the host asks: `open_<app>`'s path, and `hostContext["openai/deepLink"].url` (Ri's and OpenAI's links into an app), at start and later. Pass the router's `navigate` to `EmbeddedView`; the screen at that path shows the record (Reading Log's Library opens the book at `/books/<id>`).
- Leaving the frame goes through the host, and each call checks the host's capabilities first and returns false (sending nothing) where it can't:
  - `client.openLink(url)` / `ExternalLink`: `ui/open-link` for http, https and mailto. Without it, the address shows to copy.
  - `client.download({ name, mimeType, text | data })`: `ui/download-file` with the file embedded (`file:///<name>`, base64 `blob` for bytes), at most 12 MiB. A browser download in the app's own page.
  - `client.draftMessage(text)` / `AskInChat`: `ui/message` with `_meta["openai/message"]: { target: "active", send: false }`, only in a host that advertises `experimental["openai/message"]`, because a plain `ui/message` sends as the person. Ri puts it in the message box unsent. Elsewhere the question shows to copy.
  - `client.can` says which the host allows; in the browser, links and files but no chat.
- Open in browser: inside a host, `OpenInBrowser` (in the header; cards add it to their footer) opens the app's own address at the place `setSection` reported, through open-link. An address on this computer (`127.0.0.1`) isn't offered on a phone or tablet. It's the way out for anything a host doesn't allow.
- What the view tells the assistant stays bounded (selection.ts): `{ app, revision, selected, changes? }`, plus `section`, `path`, `filters` (8) and `selection: { items (50), total }` when set, within 16 KiB.

The browser qualification (tests/mcp-apps.ts) runs the view in a host like that: a scripts-only sandbox, a page CSP that blocks all network, and full screen on request. Like Ri, it keeps view-only tools from its model, drafts `ui/message`, records links and downloads, and sends deep links; each can be turned off to check the view degrades.

Use a standard MCP Client with StreamableHTTPClientTransport and a token to verify local tools. In tests, `createTestConnection(platform, { sources, write })` from `@app-builder/core/node` records a connection as if the person had approved it and returns its token (tests/app.test.ts does this). A desktop host that speaks HTTP connects to `<address>/mcp` with OAuth; one that only starts commands uses `app-builder mcp <address>/mcp`, which opens the consent screen once and keeps its token privately. ChatGPT and Claude live connection/rendering are separate qualification checks; a passing SDK test is not proof of either UI.

## Offline and sharing

iPhones cannot be relied on to upload in the background. Keep the capture and its photo bytes in IndexedDB before reporting success. The person may need to reopen the app. Cache the shell, not authenticated API responses. An outbox entry is bound to its installation and account. Network failures retry; a permission refusal stays visible with Retry, Save a copy and Discard. A server retry uses the original record and upload IDs.

The local owner is loopback-only. Enable sign-in before remote access; the first account adopts existing local records. Restoring records kept without an account onto a target that requires sign-in prints a one-time handoff code; the signed-in person enters it in Settings to take them over. Set APP_AUTH=required, APP_URL to the public HTTPS origin, and APP_HOST=0.0.0.0 only when needed. Prefer an authenticated private network or tunnel. The origin/host checks must stay enabled. An app answers on one address. When it moves, APP_PREVIOUS_URLS keeps earlier addresses answering for people who haven't moved yet, so offline saves still upload; never widen the host check any other way. On Cloudflare, APP_PUBLIC_URL attaches the custom domain on deploy and keeps the old address as a previous one. See [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) or the selected network's current setup instructions.

Sharing collections does not share mailbox or calendar authority. A removed member must lose access to parent records and their photos. A contributor may edit their own records; the collection owner may edit all. The app supplies these policies.

## Recovery

Personal NDJSON exports contain only app-declared personal data and authorized photo bytes. Installation backups contain accounts and password hashes; treat them as secrets. They omit sessions, OAuth clients/tokens/consents and upstream provider tokens, including the encrypted credential-store rows. Restore into an empty destination, regenerate the runtime secret, and sign in and reconnect assistants. Stop the old writer before moving; choose one destination for future writes. A restore is not continuous synchronization.

## Server rendering

Both runtimes render through React Router framework mode. Load initial data with loadAppPage using request-scoped platform and read actions. Do not return database handles, secrets, tokens or vault values. The web page is private/no-store; the service worker only precaches offline.html. The MCP view remains a standalone browser bundle. Development uses the Node API and Vite middleware on one loopback origin.

Use putCredential/getCredential/deleteCredential only in backend integration code. The installation secret is stored as a runtime secret outside SQLite/D1; vault ciphertext is authenticated to its owner and key. A wrong key or tampered value raises CredentialReconnectRequired. Missing credentials require reconnection. Sign-in-only provider tokens are discarded. Never replace these hooks with plaintext account-token storage when adding a social provider.
