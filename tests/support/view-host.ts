/**
 * A strict MCP Apps host for Travel's view, after the kit's qualification
 * host (packages/core/test/browser-host.ts): the view runs in a frame that may
 * only run scripts, the page serving it blocks all network, the host runs a
 * render tool and hands the view its result, and full screen is granted.
 * Tool calls go to Travel's /mcp with a connection's token.
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
declare global {
  interface Window {
    mcpToken: string;
    mcpFixture: {
      context: unknown;
      displayMode: string;
      calls: string[];
      mount(url: string, tool: string, input?: Record<string, unknown>, theme?: "light" | "dark"): Promise<ToolResult>;
      call(name: string, input: Record<string, unknown>): Promise<ToolResult>;
    };
  }
}
let bridge: AppBridge | undefined;
async function call(name: string, input: Record<string, unknown>) {
  window.mcpFixture.calls.push(name);
  const response = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + window.mcpToken }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: input } }) });
  const message = await response.json() as { result: ToolResult };
  return message.result;
}
window.mcpFixture = {
  context: null,
  displayMode: "inline",
  calls: [],
  async mount(url, tool, input = {}, theme = "light") {
    void bridge?.close();
    document.getElementById("app-frame")?.remove();
    const frame = document.createElement("iframe"); frame.id = "app-frame"; frame.style.cssText = "display:block;width:100%;height:300px;border:0";
    frame.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(frame);
    const hostContext: McpUiHostContext = {
      theme, displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"], locale: "en-US",
      toolInfo: { tool: { name: tool, inputSchema: { type: "object" } } },
    };
    window.mcpFixture.displayMode = "inline";
    const host = new AppBridge(null, { name: "Strict host", version: "1" }, { serverTools: {}, logging: {}, updateModelContext: { text: {} } }, { hostContext });
    bridge = host;
    host.oncalltool = async (params) => await call(params.name, params.arguments ?? {}) as never;
    host.onupdatemodelcontext = async (update) => { window.mcpFixture.context = update; return {}; };
    host.onsizechange = ({ height }) => { if (window.mcpFixture.displayMode === "inline" && height) frame.style.height = height + "px"; };
    host.onrequestdisplaymode = async ({ mode }) => {
      window.mcpFixture.displayMode = mode;
      if (mode === "fullscreen") frame.style.height = "100vh";
      await host.sendHostContextChange({ displayMode: mode });
      return { mode };
    };
    const initialized = new Promise<void>((resolve) => { host.oninitialized = () => resolve(); });
    await host.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
    frame.src = url;
    await initialized;
    await host.sendToolInput({ arguments: input });
    const result = await call(tool, input);
    await host.sendToolResult(result as never);
    return result;
  },
  call,
};
