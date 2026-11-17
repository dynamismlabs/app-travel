/**
 * Travel's view inside an assistant, in the kit's strict MCP Apps host and
 * real Chrome (tests/support/view-host.ts): a scripts-only sandbox, a page
 * that blocks all network, full screen on request, and Ri's rules where MCP
 * Apps leaves room (view-only tools kept from the model, drafts never sent,
 * links and files recorded, host links into the app). Also Travel's own
 * server-rendered page at phone and desktop widths. Needs a build and Chrome;
 * screenshots go to artifacts/. Run: pnpm test:view
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestHandler, type ServerBuild } from "react-router";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { createTestConnection, serveApp, type RunningApp } from "@app-builder/core/node";
import { application } from "../src/app.js";
import { seedPreview } from "../src/fixtures/preview.js";
import type { HostOptions } from "./support/view-host.js";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, "artifacts");
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.BROWSER_EXECUTABLE_PATH ?? ""].find((file) => file && fs.existsSync(file));
const built = fs.existsSync(path.join(root, "dist/mcp.html")) && fs.existsSync(path.join(root, "dist/server/index.js"));
const VIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
// The fictional trips are in November 2026. Pin "today" to before them, whatever the real date.
const TODAY = "2026-10-15T12:00:00.000Z";

type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };
type Message = { role: string; content: { type: string; text?: string }[]; _meta?: Record<string, unknown> };
type Download = { contents: { type: string; resource: { uri: string; mimeType: string; text?: string } }[] };

describe.skipIf(!chrome || !built)("Travel's view in the kit's strict MCP Apps host", () => {
  let running: RunningApp, browser: Browser, page: Page, dataDir: string, origin: string, token: string;
  const previous = process.env.TRAVEL_NOW;
  const failures: string[] = [];
  const ids = { lisbon: "", hotel: "", flight: "" };
  const view = () => page.frameLocator("#app-frame");
  const mount = (tool: string, input: Record<string, unknown> = {}, options: HostOptions = {}) =>
    page.evaluate(([tool, input, options]) => window.mcpFixture.mount("/__mcp-view__", tool, input, options), [tool, input, options] as const) as Promise<Result>;
  const modelCall = (name: string, input: Record<string, unknown> = {}) => page.evaluate(([name, input]) => window.mcpFixture.call(name, input), [name, input] as const) as Promise<Result>;
  const appCall = (name: string, input: Record<string, unknown> = {}) => page.evaluate(([name, input]) => window.mcpFixture.appCall(name, input), [name, input] as const) as Promise<Result>;
  const asked = () => page.evaluate(() => ({ messages: window.mcpFixture.messages, links: window.mcpFixture.links, downloads: window.mcpFixture.downloads })) as Promise<{ messages: Message[]; links: string[]; downloads: Download[] }>;
  const context = () => page.evaluate(() => ((window.mcpFixture.context as { content?: { text?: string }[] } | null)?.content ?? []).map((part) => part.text ?? "").join("\n"));
  const displayMode = () => page.evaluate(() => window.mcpFixture.displayMode);
  const rpc = async (method: string, params: Record<string, unknown>) =>
    (await (await fetch(origin + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result: any; error?: { message: string } };
  // Travel's own page is server-rendered, as in src/node.ts.
  const serve = async (dir: string) => {
    const handler = createRequestHandler(await import(pathToFileURL(path.join(root, "dist/server/index.js")).href) as ServerBuild, "production");
    return serveApp(application, { root, dataDir: dir, port: 0, render: (request, platform) => handler(request, { platform }) });
  };

  beforeAll(async () => {
    process.env.TRAVEL_NOW = TODAY;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-view-"));
    running = await serve(dataDir);
    origin = running.platform.baseURL;
    await seedPreview(running.platform);
    token = (await createTestConnection(running.platform, { name: "Strict host", sources: null, write: true })).accessToken;
    const resource = await rpc("resources/read", { uri: "ui://travel/main" });
    expect(resource.result.contents[0]._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    const bookings = (await rpc("tools/call", { name: "list_bookings", arguments: { limit: 50 } })).result.structuredContent.result.items as { id: string; title: string; tripId: string }[];
    ids.hotel = bookings.find((booking) => booking.title === "Riverside House")!.id;
    ids.flight = bookings.find((booking) => booking.title === "Flight RA 204")!.id;
    ids.lisbon = bookings.find((booking) => booking.title === "Riverside House")!.tripId;
    const hostScript = (await build({ entryPoints: [path.join(import.meta.dirname, "support/view-host.ts")], bundle: true, write: false, format: "iife", platform: "browser" })).outputFiles[0].text;
    browser = await chromium.launch({ executablePath: chrome });
    page = await (await browser.newContext({ viewport: { width: 760, height: 900 } })).newPage();
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) failures.push(message.text()); });
    page.on("request", (request) => { if (request.frame().parentFrame() && !request.url().endsWith("/__mcp-view__")) failures.push("The view reached the network: " + request.url()); });
    await page.route("**/__mcp-view__", (route) => route.fulfill({ contentType: "text/html", headers: { "content-security-policy": VIEW_CSP }, body: resource.result.contents[0].text }));
    await page.route("**/__mcp-host__", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Strict host</title><body style='margin:0;background:#fff'></body>" }));
    await page.goto(origin + "/__mcp-host__");
    await page.evaluate((value) => { (window as unknown as { mcpToken: string }).mcpToken = value; }, token);
    await page.addScriptTag({ content: hostScript });
    fs.mkdirSync(artifacts, { recursive: true });
  }, 90_000);
  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TRAVEL_NOW; else process.env.TRAVEL_NOW = previous;
  });

  it("keeps the person's own decisions from the model, and the host's @ menu finds trips and bookings", async () => {
    const modelTools = await page.evaluate(() => window.mcpFixture.modelTools());
    expect(modelTools).toEqual(expect.arrayContaining(["list_trips", "get_trip", "save_booking", "create_follow_up", "show_trip", "open_travel"]));
    for (const name of ["review_change", "delete_booking", "preview_import", "apply_import", "export_trip", "delete_source_data", "save_settings", "search_mentions"]) expect(modelTools).not.toContain(name);
    expect((await modelCall("review_change", { id: "x", expectedRevision: 1, decision: "dismiss" })).isError).toBe(true);
    // The host's @ menu: links to records, read as this connection.
    const found = await appCall("search_mentions", { query: "Riverside" });
    expect(found.structuredContent).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ type: "resource_link", uri: `app://travel/bookings/${ids.hotel}`, title: "Riverside House" })]) });
    const recent = await appCall("search_mentions", { query: "" });
    expect((recent.structuredContent as { items: { uri: string }[] }).items.map((item) => item.uri)).toContain(`app://travel/trips/${ids.lisbon}`);
    const trip = await rpc("resources/read", { uri: `app://travel/trips/${ids.lisbon}` });
    expect(trip.result.contents[0].mimeType).toBe("text/markdown");
    expect(trip.result.contents[0].text).toContain("Lisbon, November 9 to 14, 2026");
    expect(trip.result.contents[0].text).toContain(`/trips/${ids.lisbon}`);
    const booking = await rpc("resources/read", { uri: `app://travel/bookings/${ids.hotel}` });
    expect(booking.result.contents[0].text).toContain("Riverside House (lodging, confirmed)");
  });

  it("draws show_trip as a card on the host's background, and opens the whole app at a booking from it", async () => {
    const result = await mount("show_trip");
    expect(result.structuredContent).toMatchObject({ view: "show_trip", data: { title: "Lisbon" } });
    await view().locator(".view-card-head h1").filter({ hasText: "Lisbon" }).waitFor();
    expect(await view().locator("html").getAttribute("data-view")).toBe("card");
    await expect.poll(context).toContain("Lisbon trip, November 9 to 14, 2026");
    await page.screenshot({ path: path.join(artifacts, "view-show-trip.png"), fullPage: true });
    // The card's footer has Open in browser; a booking opens the whole app there.
    await view().getByRole("button", { name: "Open in browser" }).waitFor();
    await view().getByRole("button", { name: "Open Arrive in Lisbon" }).click();
    await expect.poll(displayMode).toBe("fullscreen");
    await view().getByText("Flight details").waitFor();
  });

  it("draws show_review in the dark theme, and opens Review from it", async () => {
    await mount("show_review", {}, {});
    await view().locator(".view-card-head h1").filter({ hasText: "Waiting in Review" }).waitFor();
    expect(await view().locator(".tv-card__row").count()).toBe(3);
    await page.screenshot({ path: path.join(artifacts, "view-show-review.png"), fullPage: true });
    await view().getByRole("button", { name: "Open Review" }).click();
    await expect.poll(displayMode).toBe("fullscreen");
    await view().getByText("Your saved value").first().waitFor();
    // Review decisions are view-only: the model can't make them, the person in the view can.
    await view().getByRole("button", { name: "Use 16:00" }).click();
    await expect.poll(() => view().getByText("Riverside House changed").count(), { timeout: 10_000 }).toBe(0);
  });

  it("opens at a booking, reports the place, and drafts, opens links, saves files and opens in browser through the host", async () => {
    const opened = await mount("open_travel", { path: `/bookings/${ids.hotel}` });
    expect(opened.structuredContent).toEqual({ view: "open_travel", path: `/bookings/${ids.hotel}` });
    await expect.poll(displayMode).toBe("fullscreen");
    await view().getByText("Stay details").waitFor();
    await expect.poll(context).toContain('"section":"Lisbon trip, November 9 to 14, 2026"');
    expect(await context()).toContain(`"path":"/trips/${ids.lisbon}?selected=${ids.hotel}"`);
    expect(await context()).toContain('"title":"Riverside House, November 10 to 14, 2026"');
    await page.screenshot({ path: path.join(artifacts, "view-open-at-booking.png"), fullPage: true });
    // A question goes into the chat as a draft, never sent for the person.
    await view().getByRole("button", { name: "Ask about this booking" }).click();
    await expect.poll(async () => (await asked()).messages.length).toBe(1);
    const [message] = (await asked()).messages;
    expect(message).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("Riverside House") }] });
    expect(message._meta).toEqual({ "openai/message": { target: "active", send: false } });
    // Directions open in the person's browser through the host.
    await view().getByRole("button", { name: "Open directions" }).click();
    await expect.poll(async () => (await asked()).links.at(-1)).toBe("https://www.google.com/maps/search/?api=1&query=Rua%20da%20Prata%20112%2C%201100-420%20Lisbon%2C%20Portugal");
    // Open in browser opens Travel's own page at the same place.
    await view().locator(".tr-hostbar").getByRole("button", { name: "Open in browser" }).click();
    await expect.poll(async () => (await asked()).links.at(-1)).toBe(`${origin}/trips/${ids.lisbon}?selected=${ids.hotel}`);
    // Export saves a file through the host, embedded.
    await view().getByRole("button", { name: "Back to itinerary" }).click().catch(() => undefined);
    await view().getByRole("button", { name: "Export" }).click();
    await view().getByRole("menuitem", { name: "Itinerary as CSV" }).click();
    await expect.poll(async () => (await asked()).downloads.length).toBe(1);
    const [file] = (await asked()).downloads;
    expect(file.contents[0]).toMatchObject({ type: "resource", resource: { uri: "file:///travel-lisbon.csv", mimeType: "text/csv" } });
    expect(file.contents[0].resource.text).toContain('"Depart Denver"');
    // A host link moves the open app to another booking.
    await page.evaluate((url) => window.mcpFixture.deepLink(url), `/bookings/${ids.flight}`);
    await view().getByText("Flight details").waitFor();
    // Comparing ideas tells the assistant which ones, as several selected records.
    await view().getByRole("tab", { name: /Ideas/ }).click();
    await view().locator(".tr-idea", { hasText: "Sintra day tour" }).getByLabel("Compare").check();
    await view().locator(".tr-idea", { hasText: "Fado evening in Alfama" }).getByLabel("Compare").check();
    await expect.poll(context).toContain('"selection":{"items":[');
    expect(await context()).toContain("Idea: Fado evening in Alfama");
    expect(await context()).toContain('"tab":"ideas"');
  });

  it("offers what it can in a host without drafts, links or downloads, and shows addresses a host refuses", async () => {
    const before = await asked();
    await mount("open_travel", { path: `/bookings/${ids.hotel}` }, { draft: false, openLinks: false, download: false });
    await view().getByText("Stay details").waitFor();
    expect(await view().getByRole("button", { name: "Open in browser" }).count()).toBe(0);
    expect(await view().getByRole("button", { name: "Open directions" }).count()).toBe(0);
    await view().getByText("https://www.google.com/maps/search/?api=1&query=Rua%20da%20Prata%20112%2C%201100-420%20Lisbon%2C%20Portugal").waitFor();
    await view().getByText("Ask about this booking").click();
    await view().locator(".ri-ask--copy q").filter({ hasText: "Riverside House" }).waitFor();
    await view().getByRole("button", { name: "Back to itinerary" }).click().catch(() => undefined);
    expect(await view().getByRole("button", { name: "Export" }).count()).toBe(0);
    expect(await asked()).toEqual(before);
    // A host that offers links but refuses this one: the address shows to copy.
    await mount("open_travel", { path: `/bookings/${ids.hotel}` }, { refuseLinks: true });
    await view().getByText("Stay details").waitFor();
    await view().getByRole("button", { name: "Open directions" }).click();
    await view().getByText("https://www.google.com/maps/search/?api=1&query=Rua%20da%20Prata%20112%2C%201100-420%20Lisbon%2C%20Portugal").waitFor();
    // Without the host's save-file call, Export becomes a way to Travel's own page.
    await mount("open_travel", { path: `/trips/${ids.lisbon}` }, { download: false });
    await view().getByRole("button", { name: "Export in browser" }).click();
    await expect.poll(async () => (await asked()).links.at(-1)).toBe(`${origin}/trips/${ids.lisbon}`);
  });

  it("never reached the network from the view, and raised no errors", () => {
    expect(failures).toEqual([]);
  });

  it("in Travel's own page: opens a booking, compares ideas and has no chat buttons, at narrow and wide widths", async () => {
    const own = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errors: string[] = [];
    own.on("pageerror", (error) => errors.push(error.message));
    try {
      await own.goto(origin + "/");
      await expect.poll(() => own.getByRole("heading", { level: 1 }).first().textContent(), { timeout: 20_000 }).toBe("Lisbon");
      await own.getByRole("radio", { name: /Tue\s*10/ }).click();
      await own.getByText("Local times in Lisbon WET").first().waitFor();
      await own.getByRole("button", { name: /Riverside House\s+Check in, 4 nights/ }).click();
      await own.getByText("Stay details").waitFor();
      await own.getByText("Nov 10, 2026, 16:00 WET").first().waitFor();
      // No chat here, so no Ask button. Directions are an ordinary new tab.
      expect(await own.getByRole("button", { name: "Ask about this booking" }).count()).toBe(0);
      expect(await own.getByRole("button", { name: "Open directions" }).count()).toBe(1);
      await own.screenshot({ path: path.join(artifacts, "page-booking-narrow.png"), fullPage: true });
      await own.setViewportSize({ width: 1300, height: 900 });
      await own.getByRole("tab", { name: /Ideas/ }).click();
      await own.locator(".tr-idea", { hasText: "Sintra day tour" }).getByLabel("Compare").check();
      await own.locator(".tr-idea", { hasText: "Fado evening in Alfama" }).getByLabel("Compare").check();
      await own.getByRole("button", { name: /Compare 2 ideas/ }).click();
      await own.getByText("They are not converted or added together", { exact: false }).first().waitFor();
      await own.screenshot({ path: path.join(artifacts, "page-compare-wide.png"), fullPage: true });
      expect(errors).toEqual([]);
    } finally { await own.context().close(); }
  });

  it("in Travel's own page on an empty install: adds a pasted booking and opens its trip", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-view-empty-"));
    const empty = await serve(emptyDir);
    const own = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    try {
      await own.goto(empty.platform.baseURL + "/");
      await own.getByRole("heading", { name: "Bring your next trip together" }).waitFor({ timeout: 20_000 });
      await own.getByRole("button", { name: "Add booking" }).first().click();
      await own.getByLabel("Confirmation text").fill("Subject: Your stay at Riverside House\n\nRiverside House\nBooking reference: RH-4821\nGuest name: Alex Rivera\nCheck-in: Tue, Nov 10, 2026 (from 14:00)\nCheck-out: Sat, Nov 14, 2026 (until 11:00)\nAddress: Rua da Prata 112, Lisbon, Portugal");
      await own.getByRole("button", { name: "Preview" }).click();
      await own.getByText(/Riverside House, November 10 to 14, 2026/).first().waitFor({ timeout: 10_000 });
      await own.getByRole("button", { name: "Apply" }).click();
      await expect.poll(() => own.getByRole("heading", { level: 1 }).first().textContent(), { timeout: 10_000 }).toBe("Lisbon");
      await own.screenshot({ path: path.join(artifacts, "page-added-booking.png"), fullPage: true });
    } finally {
      await own.context().close();
      await empty.stop();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
