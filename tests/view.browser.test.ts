/**
 * Travel's view inside an assistant, in a strict MCP Apps host and real
 * Chrome: cards from show_trip and show_review, open_travel going full
 * screen, the whole app working through host tool calls, the selection
 * reaching the assistant, and nothing on the network from the view.
 * Needs a build (pnpm build) and Chrome. Screenshots go to artifacts/.
 * Run: pnpm test:view
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { createTestConnection, serveApp, type RunningApp } from "@app-builder/core/node";
import { application } from "../src/app.js";
import { closeTravelDatabases } from "../src/db/connection.js";
import { seedPreview } from "../src/fixtures/preview.js";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, "artifacts");
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.BROWSER_EXECUTABLE_PATH ?? ""].find((file) => file && fs.existsSync(file));
const built = fs.existsSync(path.join(root, "dist/mcp.html"));
const VIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

describe.skipIf(!chrome || !built)("Travel's view in a strict MCP Apps host", () => {
  let running: RunningApp, browser: Browser, page: Page, dataDir: string;
  const failures: string[] = [];
  const view = () => page.frameLocator("#app-frame");
  const mount = (tool: string, input: Record<string, unknown> = {}, theme: "light" | "dark" = "light") =>
    page.evaluate(([tool, input, theme]) => window.mcpFixture.mount("/__mcp-view__", tool, input, theme), [tool, input, theme] as const);
  const context = () => page.evaluate(() => JSON.stringify(window.mcpFixture.context ?? null));

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-view-"));
    running = await serveApp(application, { root, dataDir, port: 0, onStop: async () => { closeTravelDatabases(); } });
    await seedPreview(running.platform);
    const origin = running.platform.baseURL;
    const { accessToken } = await createTestConnection(running.platform, { name: "Strict host", sources: null, write: true });
    const resource = await (await fetch(origin + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + accessToken }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "ui://travel/main" } }) })).json() as { result: { contents: { text: string; _meta: { ui: { csp: unknown } } }[] } };
    expect(resource.result.contents[0]._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    const hostScript = (await build({ entryPoints: [path.join(import.meta.dirname, "support/view-host.ts")], bundle: true, write: false, format: "iife", platform: "browser" })).outputFiles[0].text;
    browser = await chromium.launch({ executablePath: chrome });
    page = await (await browser.newContext({ viewport: { width: 760, height: 900 } })).newPage();
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) failures.push(message.text()); });
    page.on("request", (request) => { if (request.frame().parentFrame() && !request.url().endsWith("/__mcp-view__")) failures.push("The view reached the network: " + request.url()); });
    await page.route("**/__mcp-view__", (route) => route.fulfill({ contentType: "text/html", headers: { "content-security-policy": VIEW_CSP }, body: resource.result.contents[0].text }));
    await page.route("**/__mcp-host__", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Strict host</title><body style='margin:0;background:#fff'></body>" }));
    await page.goto(origin + "/__mcp-host__");
    await page.evaluate((token) => { window.mcpToken = token; }, accessToken);
    await page.addScriptTag({ content: hostScript });
    fs.mkdirSync(artifacts, { recursive: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await running?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("draws show_trip as a card on the host's background and tells the assistant which trip", async () => {
    const result = await mount("show_trip");
    expect(result.structuredContent).toMatchObject({ view: "show_trip", data: { title: "Lisbon" } });
    await view().locator(".view-card-head h1").filter({ hasText: "Lisbon" }).waitFor();
    expect(await view().locator("html").getAttribute("data-view")).toBe("card");
    expect(await view().locator(".tv-card__item").count()).toBeGreaterThan(3);
    await expect.poll(context).toContain("Lisbon trip, November 9 to 14, 2026");
    await page.screenshot({ path: path.join(artifacts, "view-show-trip.png"), fullPage: true });
  });

  it("draws show_review in the dark theme", async () => {
    await mount("show_review", {}, "dark");
    await view().locator(".view-card-head h1").filter({ hasText: "Waiting in Review" }).waitFor();
    expect(await view().locator("html").getAttribute("data-theme")).toBe("dark");
    expect(await view().locator(".tv-card__row").count()).toBe(3);
    await page.screenshot({ path: path.join(artifacts, "view-show-review-dark.png"), fullPage: true });
  });

  it("opens the whole app full screen, works through the host's tool calls, and publishes the selected booking", async () => {
    await mount("open_travel");
    await expect.poll(() => page.evaluate(() => window.mcpFixture.displayMode)).toBe("fullscreen");
    await view().getByRole("heading", { name: "Lisbon", level: 1 }).waitFor();
    expect(await view().locator("html").getAttribute("data-view")).toBe("app");
    await view().locator("button.tr-card", { hasText: "Riverside House" }).first().click();
    await view().getByText("A newer source differs from your correction.").waitFor();
    await expect.poll(context).toContain("Riverside House, November 10 to 14, 2026");
    await page.screenshot({ path: path.join(artifacts, "view-open-travel.png"), fullPage: true });
    // A change from the view goes through the host and shows at once.
    await view().getByRole("tab", { name: /Ideas/ }).click();
    await view().getByText("Sintra day tour").first().waitFor();
    const calls = await page.evaluate(() => window.mcpFixture.calls);
    expect(calls).toEqual(expect.arrayContaining(["open_travel", "open_view", "get_trip", "get_booking"]));
  });

  it("never reached the network from the view, and raised no errors", () => {
    expect(failures).toEqual([]);
  });
});
