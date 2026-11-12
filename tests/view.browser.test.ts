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
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestHandler, type ServerBuild } from "react-router";
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

  // Travel's own page is server-rendered, as in src/node.ts.
  const serve = async (dir: string) => {
    const handler = createRequestHandler(await import(pathToFileURL(path.join(root, "dist/server/index.js")).href) as ServerBuild, "production");
    return serveApp(application, { root, dataDir: dir, port: 0, render: (request, platform) => handler(request, { platform }), onStop: async () => { closeTravelDatabases(path.join(dir, "data.sqlite")); } });
  };

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-view-"));
    running = await serve(dataDir);
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

  it("in Travel's own page: opens a booking, accepts a change in Review and compares ideas, at narrow and wide widths", async () => {
    const own = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errors: string[] = [];
    own.on("pageerror", (error) => errors.push(error.message));
    try {
      await own.goto(running.platform.baseURL + "/");
      await expect.poll(() => own.getByRole("heading", { level: 1 }).first().textContent(), { timeout: 20_000 }).toBe("Lisbon");
      await own.getByRole("radio", { name: /Tue\s*10/ }).click();
      await own.getByText("Local times in Lisbon WET").first().waitFor();
      await own.getByRole("button", { name: /Riverside House\s+Check in, 4 nights/ }).click();
      await own.getByText("Stay details").waitFor();
      await own.getByText("Nov 10, 2026, 15:00 WET").first().waitFor();
      await own.screenshot({ path: path.join(artifacts, "page-booking-narrow.png"), fullPage: true });
      await own.setViewportSize({ width: 1300, height: 900 });
      await own.goto(running.platform.baseURL + "/review");
      await own.getByText("Your saved value").first().waitFor();
      await own.getByRole("button", { name: "Use 16:00" }).click();
      await expect.poll(() => own.getByText("Riverside House changed").count(), { timeout: 10_000 }).toBe(0);
      await own.getByRole("tab", { name: "Trips" }).click();
      await own.getByRole("button", { name: /Lisbon/ }).first().click();
      await own.getByRole("tab", { name: /Ideas/ }).click();
      await own.locator(".tr-idea", { hasText: "Sintra day tour" }).getByLabel("Compare").check();
      await own.locator(".tr-idea", { hasText: "Fado evening in Alfama" }).getByLabel("Compare").check();
      await own.getByRole("button", { name: /Compare 2 ideas/ }).click();
      await own.getByText("They are not converted or added together", { exact: false }).first().waitFor();
      await own.screenshot({ path: path.join(artifacts, "page-compare-wide.png"), fullPage: true });
      await own.getByRole("button", { name: "Done" }).click();
      await own.getByRole("tab", { name: /Bookings/ }).click();
      await own.getByRole("table").waitFor();
      const hotel = await own.getByRole("row", { name: /Riverside House/ }).textContent();
      expect(hotel).toContain("Confirmed");
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
