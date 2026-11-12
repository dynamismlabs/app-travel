import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "@app-builder/core";
import { createTestConnection, openNodePlatform } from "@app-builder/core/node";
import { application } from "../src/app";

test("a retried create stays one record, is readable over MCP, and survives a restart", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "personal-app-test-"));
  let opened = await openNodePlatform(application, { dataDir, localOwner: true, baseURL: "http://127.0.0.1:4310" });
  try {
    let app = createApp(application, () => opened.platform);
    const id = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.request("http://127.0.0.1:4310/api/trpc/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "save_book", input: { id, title: "A persistent book" } }),
      });
      assert.equal(response.status, 200);
    }
    opened.close();
    opened = await openNodePlatform(application, { dataDir, localOwner: true, baseURL: "http://127.0.0.1:4310" });
    app = createApp(application, () => opened.platform);
    // Every MCP request needs a connection's token, also on this computer.
    const { accessToken } = await createTestConnection(opened.platform);
    const response = await app.request("http://127.0.0.1:4310/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + accessToken },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_books", arguments: {} } }),
    });
    const result = await response.json() as { result: { structuredContent: { result: { id: string }[] } } };
    assert.deepEqual(result.result.structuredContent.result.map((row) => row.id), [id]);
  } finally { opened.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
