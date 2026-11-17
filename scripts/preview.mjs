// The fictional preview, in place of Ri's demo mode: builds Travel if needed,
// then runs it on a new, empty data directory with Alex Rivera's fictional
// trips and the fixture hub (fixtures/connectors.json). No account is read.
// "Today" is pinned to October 15, 2026, so the fictional November trips stay upcoming.
// Run: pnpm preview (PORT to choose the port, default 4335).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (!fs.existsSync(path.join(root, "dist/server.mjs"))) execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-preview-"));
console.log(`Fictional preview data: ${dataDir} (delete it when you're done)`);
const child = spawn("pnpm", ["exec", "app-builder", "serve"], {
  cwd: root, stdio: "inherit",
  env: { ...process.env, APP_DATA_DIR: dataDir, PORT: process.env.PORT ?? "4335", TRAVEL_PREVIEW: "fictional", TRAVEL_NOW: process.env.TRAVEL_NOW ?? "2026-10-15T12:00:00.000Z", APP_CONNECTORS: "fixtures", APP_CONNECTOR_FIXTURES: path.join(root, "fixtures/connectors.json") },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
