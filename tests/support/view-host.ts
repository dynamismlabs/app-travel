// From App Builder's strict qualification host (packages/core/test/browser-host.ts at kit 1713f6a), unchanged but for this note.
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

// A test host that behaves like the strict ones: the view runs in a frame that
// may only run scripts (no same-origin, forms or modals), the page serving it
// blocks all network, and the host runs a render tool, then hands the view its
// result. The view asks for full screen; the host grants it.
//
// It also behaves like Ri where MCP Apps leaves room:
// - Tool visibility: the model's tool list leaves out view-only tools
//   (`ui.visibility` without "model") and the host refuses the model's call to
//   one; the view may call only tools whose visibility includes "app".
// - `ui/message` with OpenAI's `openai/message` becomes a draft it records, never a send.
// - `ui/open-link` and `ui/download-file` are recorded instead of opening or saving.
// - A host link to one place in the app arrives as `hostContext["openai/deepLink"]`.
// Each can be turned off per mount, to check the view degrades in a host without it.
type ToolResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };
type Tool = { name: string; _meta?: { ui?: { visibility?: string[] } } };
/** `refuseLinks` advertises open-link but refuses every link, as a host that opens only some does. */
export interface HostOptions { draft?: boolean; openLinks?: boolean; refuseLinks?: boolean; download?: boolean; deepLink?: string }
declare global {
  interface Window {
    mcpFixture: {
      context: unknown;
      displayMode: string;
      messages: unknown[];
      links: string[];
      downloads: unknown[];
      mount(url: string, tool: string, input?: Record<string, unknown>, options?: HostOptions): Promise<ToolResult>;
      /** A tool call as the host's model would make it. */
      call(name: string, input: Record<string, unknown>): Promise<ToolResult>;
      /** A call the host makes for itself (its own UI, such as the @ menu), not the model's. */
      appCall(name: string, input: Record<string, unknown>): Promise<ToolResult>;
      modelTools(): Promise<string[]>;
      deepLink(url: string): Promise<void>;
      unmount(): void;
    };
  }
}
let bridge: AppBridge | undefined;
async function rpc<T>(method: string, params: Record<string, unknown>) {
  const token = (window as unknown as { mcpToken: string }).mcpToken;
  const response = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }) });
  const message = await response.json() as { result: T };
  return message.result;
}
let listed: Promise<Tool[]> | undefined;
const tools = () => listed ??= rpc<{ tools: Tool[] }>("tools/list", {}).then((result) => result.tools);
const visibleTo = async (name: string, audience: "model" | "app") => {
  const tool = (await tools()).find((item) => item.name === name);
  return !!tool && (tool._meta?.ui?.visibility ?? ["model", "app"]).includes(audience);
};
const refused = (name: string): ToolResult => ({ isError: true, content: [{ type: "text", text: `${name} isn't available here.` }] });
const send = (name: string, input: Record<string, unknown>) => rpc<ToolResult>("tools/call", { name, arguments: input });
// The model's calls: tools it can't see are refused. A person opening the app (its entrypoint) may run open_<app>.
async function call(name: string, input: Record<string, unknown>) {
  return await visibleTo(name, "model") ? send(name, input) : refused(name);
}
async function appCall(name: string, input: Record<string, unknown>) {
  return await visibleTo(name, "app") ? send(name, input) : refused(name);
}
window.addEventListener("message", (event) => {
  const data = event.data as { method?: string; params?: unknown } | null;
  const frame = document.getElementById("app-frame") as HTMLIFrameElement | null;
  if (data?.method === "ui/message" && frame && event.source === frame.contentWindow) window.mcpFixture.messages.push(data.params);
});
window.mcpFixture = {
  context: null,
  displayMode: "inline",
  messages: [], links: [], downloads: [],
  async mount(url, tool, input = {}, options = {}) {
    window.mcpFixture.unmount();
    const frame = document.createElement("iframe"); frame.id = "app-frame"; frame.style.cssText = "display:block;width:100%;height:300px;border:0";
    frame.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(frame);
    const hostContext: McpUiHostContext = {
      theme: "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"], locale: "en-US", platform: "desktop",
      toolInfo: { tool: { name: tool, inputSchema: { type: "object" } } },
      styles: { variables: { "--color-text-primary": "rgb(17, 17, 17)" } as NonNullable<McpUiHostContext["styles"]>["variables"] },
      ...(options.deepLink ? { "openai/deepLink": { url: options.deepLink } } : {}),
    };
    window.mcpFixture.displayMode = "inline";
    const on = (value: boolean | undefined) => value !== false;
    const host = new AppBridge(null, { name: "Qualification host", version: "1" }, {
      serverTools: {}, logging: {}, updateModelContext: { text: {} },
      ...(on(options.draft) ? { message: { text: {} }, experimental: { "openai/message": {} } } : {}),
      ...(on(options.openLinks) ? { openLinks: {} } : {}),
      ...(on(options.download) ? { downloadFile: {} } : {}),
    }, { hostContext });
    bridge = host;
    // The view's own calls: only tools whose visibility includes "app".
    host.oncalltool = async (params) => await appCall(params.name, params.arguments ?? {}) as never;
    host.onupdatemodelcontext = async (update) => { window.mcpFixture.context = update; return {}; };
    // AppBridge's parser keeps only role and content, so the draft is recorded as it arrived (Ri reads the raw request too).
    if (on(options.draft)) host.onmessage = async () => ({});
    if (on(options.openLinks)) host.onopenlink = async ({ url }) => {
      if (options.refuseLinks) return { isError: true };
      window.mcpFixture.links.push(url); return {};
    };
    if (on(options.download)) host.ondownloadfile = async (file) => { window.mcpFixture.downloads.push(file); return {}; };
    // Inline, the frame takes the height the view reports; full screen, the window's.
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
    // The person opening the app runs open_<app> as its entrypoint, past visibility, as MCP Apps allows.
    const result = await send(tool, input);
    await host.sendToolResult(result as never);
    return result;
  },
  call, appCall,
  modelTools: async () => (await tools()).filter((tool) => (tool._meta?.ui?.visibility ?? ["model", "app"]).includes("model")).map((tool) => tool.name),
  async deepLink(url) { await bridge?.sendHostContextChange({ "openai/deepLink": { url } } as McpUiHostContext); },
  unmount() {
    void bridge?.close();
    bridge = undefined;
    document.getElementById("app-frame")?.remove();
    window.mcpFixture.context = null;
  },
};
