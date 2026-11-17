/**
 * Travel as an assistant reaches it: the real server on a free port, and the
 * official MCP SDK client doing what Ri, Claude or ChatGPT do. The 401
 * challenge, discovery, dynamic registration, PKCE, the consent screen (with
 * the sources this connection may see), the token, then tools under exactly
 * that access. All data is fictional.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { serveApp, type RunningApp } from "@app-builder/core/node";
import { application } from "../src/app.js";
import { seedPreview } from "../src/fixtures/preview.js";
import { travelFor } from "../src/services/core.js";

const root = path.resolve(import.meta.dirname, "..");
let running: RunningApp;
let origin: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-mcp-"));
  delete process.env.APP_URL;
  // The safe-change copy tests before it builds: without dist/mcp.html the core would offer no view tools.
  const viewHTML = fs.existsSync(path.join(root, "dist/mcp.html")) ? undefined : "<!doctype html><title>Travel</title>";
  running = await serveApp({ ...application, ...(viewHTML ? { viewHTML } : {}) }, { root, dataDir, port: 0 });
  origin = running.platform.baseURL;
  await seedPreview(running.platform);
});
afterAll(async () => {
  await running?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** An assistant's OAuth client, kept in memory. */
class Assistant implements OAuthClientProvider {
  client?: OAuthClientInformationFull;
  saved?: OAuthTokens;
  verifier = "";
  authorizationUrl?: URL;
  constructor(private name: string) {}
  get redirectUrl() { return "http://127.0.0.1:8877/callback"; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: this.name, redirect_uris: [this.redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  clientInformation() { return this.client; }
  saveClientInformation(client: OAuthClientInformationFull) { this.client = client; }
  tokens() { return this.saved; }
  saveTokens(tokens: OAuthTokens) { this.saved = tokens; }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() { return this.verifier; }
}

/**
 * The person's browser on this Mac: it keeps cookies (the app gives the local
 * owner a session), follows the app's redirects and answers the consent screen.
 */
async function approve(authorizationUrl: URL, access: { sources: string[] | null; write: boolean }) {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const send = async (url: URL | string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookie() } });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    return response;
  };
  let url = authorizationUrl;
  for (let hop = 0; hop < 6; hop++) {
    const response = await send(url);
    const location = response.headers.get("location");
    if (!location) throw new Error(`Authorization stopped at ${url.pathname} with ${response.status}`);
    url = new URL(location, url);
    if (url.pathname !== "/oauth/consent") continue;
    const code = url.searchParams.get("consent_code")!;
    const offered = await (await send(`${url.origin}/api/connections/consent?consent_code=${code}`)).json() as { client: { name: string }; sources: { label: string; items: { id: string; name: string }[] } | null };
    const answer = await send(`${url.origin}/api/auth/oauth2/consent`, {
      method: "POST", headers: { "content-type": "application/json", origin: url.origin },
      body: JSON.stringify({ accept: true, consent_code: code, access }),
    });
    const body = await answer.json() as { redirectURI?: string; message?: string };
    if (!answer.ok || !body.redirectURI) throw new Error(body.message ?? `Consent failed with ${answer.status}`);
    return { offered, code: new URL(body.redirectURI).searchParams.get("code")! };
  }
  throw new Error("Authorization never reached the consent screen.");
}

/** Connect an assistant the standard way, approving `access` on Travel's consent screen. */
async function connect(name: string, access: { sources: string[] | null; write: boolean }) {
  const assistant = new Assistant(name);
  const serverUrl = `${origin}/mcp`;
  expect(await auth(assistant, { serverUrl })).toBe("REDIRECT");
  const { offered, code } = await approve(assistant.authorizationUrl!, access);
  expect(await auth(assistant, { serverUrl, authorizationCode: code })).toBe("AUTHORIZED");
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: assistant }));
  return { client, offered, assistant };
}
const result = <T = any>(value: unknown) => (value as { structuredContent: { result: T } }).structuredContent.result;

describe("MCP with OAuth", () => {
  it("asks for a token in every mode, and says where to get one", async () => {
    const response = await fetch(`${origin}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("connects with OAuth, offers Travel's sources on the consent screen, and lists every tool with an output schema", async () => {
    const { client, offered } = await connect("Ri · Family", { sources: null, write: true });
    expect(offered.client.name).toBe("Ri · Family");
    expect(offered.sources?.label).toBe("accounts and collections");
    expect(offered.sources?.items.map((item) => item.id).sort()).toEqual(["account:fictional-mailbox", "imports", "manual"]);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of ["list_trips", "get_trip", "save_booking", "review_change", "show_trip", "show_trips", "show_review", "open_travel"]) expect(names).toContain(name);
    expect(names).not.toContain("sync_sources");
    for (const tool of tools) expect(tool.outputSchema).toBeTruthy();
    const size = JSON.stringify(tools).length;
    // Kept to tell Ri how large Travel's tool list is (docs/parity.md).
    console.log(`tools/list: ${tools.length} tools, ${Math.round(size / 1024)} KB`);
    expect(tools.find((tool) => tool.name === "open_travel")?._meta).toMatchObject({ "openai/ui": { entrypoints: [{ type: "global" }] } });
    await client.close();
  });

  it("uses tools under the connection's access: everything and changes for one, only manual entries and read-only for another", async () => {
    const full = await connect("Ri", { sources: null, write: true });
    const trips = result<{ items: { id: string; title: string }[] }>(await full.client.callTool({ name: "list_trips", arguments: { limit: 50, when: "all" } }));
    expect(trips.items.map((trip) => trip.title).sort()).toEqual(["Lisbon", "Mexico City", "Portland"]);
    const lisbon = trips.items.find((trip) => trip.title === "Lisbon")!;
    const shown = await full.client.callTool({ name: "show_trip", arguments: { id: lisbon.id } }) as unknown as { content: { text: string }[]; structuredContent: { view: string; data: { title: string; detail: { bookings: unknown[] } } } };
    expect(shown.structuredContent).toMatchObject({ view: "show_trip", data: { title: "Lisbon" } });
    expect(shown.content[0].text).toMatch(/^Showed Lisbon, November 9 to 14, 2026: \d bookings recorded/);
    const saved = result<{ status: string; record: { title: string } }>(await full.client.callTool({ name: "save_idea", arguments: { newId: crypto.randomUUID(), tripId: lisbon.id, title: "Tram 28 early" } }));
    expect(saved).toMatchObject({ status: "saved", record: { title: "Tram 28 early" } });

    const limited = await connect("Ri · Workshop", { sources: ["manual"], write: false });
    const bookings = result<{ items: unknown[] }>(await limited.client.callTool({ name: "list_bookings", arguments: { limit: 50 } }));
    expect(bookings.items).toEqual([]);
    const ideas = result<{ items: { title: string }[] }>(await limited.client.callTool({ name: "list_ideas", arguments: { tripId: lisbon.id, limit: 50 } }));
    expect(ideas.items.map((idea) => idea.title)).toContain("Tram 28 early");
    const refused = await limited.client.callTool({ name: "save_trip", arguments: { newId: crypto.randomUUID(), title: "Kyoto" } }) as { isError?: boolean; content: { text: string }[] };
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toBe("Ri · Workshop can read but not make changes. Reconnect it and allow changes to do this.");
    const sources = await limited.client.callTool({ name: "list_sources", arguments: {} }) as { isError?: boolean };
    expect(sources.isError).toBe(true);
    await full.client.close();
    await limited.client.close();
  });

  it("never shows a caller a stack, a file path or what failed inside Travel, and logs it on the server", async () => {
    const leaks = [/stack/i, /\/Users\//, /\/private\//, /node_modules/, /\.ts:\d+/, /\bat [\w.<>]+ \(/, /SqliteError/, /readonly/i];
    const expectNoLeaks = (text: string) => { for (const leak of leaks) expect(text).not.toMatch(leak); };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = travelFor({ platform: running.platform });
    const { client } = await connect("Ri · Errors", { sources: null, write: true });
    // A database failure inside Travel: SQLite refuses its trip writes for this test, as a read-only file would.
    t.db.prepare("CREATE TEMP TRIGGER refuse_trips BEFORE INSERT ON trips BEGIN SELECT RAISE(ABORT, 'attempt to write a readonly database'); END").run();
    try {
      const failed = await client.callTool({ name: "save_trip", arguments: { newId: crypto.randomUUID(), title: "Kyoto" } }) as { isError?: boolean; content: { text: string }[] };
      expect(failed.isError).toBe(true);
      expect(failed.content[0].text).toBe("Action failed.");
      const browser = await fetch(`${origin}/api/trpc/run`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ name: "save_trip", input: { newId: crypto.randomUUID(), title: "Kyoto" } }) });
      const text = await browser.text();
      expectNoLeaks(text);
      expect(JSON.parse(text)).toMatchObject({ error: { message: "This request could not be completed." } });
    } finally {
      t.db.prepare("DROP TRIGGER temp.refuse_trips").run();
      await client.close();
    }
    expect(logged.mock.calls.map((call) => JSON.stringify(call)).some((line) => /readonly/i.test(line))).toBe(true);
    logged.mockRestore();
    // Travel's own refusals still show, without a stack. Before core 0.2.2's fixes, tRPC sent one with every error.
    const missing = await fetch(`${origin}/api/trpc/read?input=${encodeURIComponent(JSON.stringify({ name: "get_trip", input: { id: "no-such-trip" } }))}`);
    const refusal = await missing.text();
    expectNoLeaks(refusal);
    expect(JSON.parse(refusal)).toMatchObject({ error: { message: "That trip is no longer available", data: { code: "NOT_FOUND" } } });
    const broken = await fetch(`${origin}/api/trpc/run`, { method: "POST", headers: { "content-type": "application/json", origin }, body: "{" });
    expect(broken.status).toBe(400);
    expectNoLeaks(await broken.text());
  });

  // Last, since it deletes the preview's account.
  it("drops an account whose data the person deleted from every connection's choice, and doesn't give it back when resumed", async () => {
    const run = async (name: string, input: unknown) => {
      const response = await fetch(`${origin}/api/trpc/run`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ name, input }) });
      expect(response.status).toBe(200);
    };
    /** The sources a connection may see, as the person's Connections list shows them. */
    const chosen = async (name: string) => {
      const rows = await (await fetch(`${origin}/api/connections`, { headers: { origin } })).json() as { name: string; sources: { id: string }[] | null }[];
      return rows.find((row) => row.name === name)?.sources?.map((source) => source.id);
    };
    const bookings = async (client: Client) => result<{ items: { title: string }[] }>(await client.callTool({ name: "list_bookings", arguments: { limit: 50 } })).items;
    const mailbox = await connect("Ri · Mailbox", { sources: ["account:fictional-mailbox", "manual"], write: false });
    expect((await bookings(mailbox.client)).length).toBeGreaterThan(0);
    expect(await chosen("Ri · Mailbox")).toEqual(["account:fictional-mailbox", "manual"]);

    await run("delete_source_data", { source: "account:fictional-mailbox" });
    // The account left Travel's sources, so the core dropped it from the connection's choice.
    expect(await bookings(mailbox.client)).toEqual([]);
    expect(await chosen("Ri · Mailbox")).toEqual(["manual"]);

    // Resumed, it's a source again for a new connection, but not for the one that chose it before.
    await run("pause_source", { sourceAccount: "fictional-mailbox", paused: false });
    const later = await connect("Ri · Later", { sources: null, write: false });
    expect(later.offered.sources?.items.map((item) => item.id)).toContain("account:fictional-mailbox");
    await bookings(mailbox.client);
    expect(await chosen("Ri · Mailbox")).toEqual(["manual"]);
    await mailbox.client.close();
    await later.client.close();
  });
});
