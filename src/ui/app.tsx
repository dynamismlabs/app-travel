/**
 * Travel's screens talk to the app through this bridge. It sits on the kit's
 * client (`useAppClient`: actions over tRPC in Travel's own page, or the
 * host's tool calls inside an assistant) and React Router (the address in
 * Travel's own page, memory inside an assistant).
 *
 * It keeps the shape of the bridge Ri's old app kit gave these screens, so
 * the screens changed little. What the kit's client can't do is said plainly:
 * `ask`, links, maps and downloads are available only where they work.
 * - Staging text in the chat (Ask Ri): no. The kit's view client doesn't
 *   expose MCP Apps' ui/message.
 * - Opening a link or a map: in Travel's own page only. The kit's view client
 *   doesn't expose ui/open-link, and the assistant's frame can't open windows.
 * - Downloads: in Travel's own page only, for the same reason.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAppClient } from "@app-builder/core/react";

export type Theme = "light" | "dark";
export interface SelectedFile { name: string; mimeType: string; base64: string }
export interface DownloadRequest { name: string; mimeType: string; text?: string; base64?: string }

export interface RiApp<TData = unknown> {
  /** Where the screen is, from the app's `open_view` for the current address. */
  data: TData | undefined;
  /** Moves after every change the screens make. Queries refetch when it moves. */
  revision: number;
  theme: Theme;
  connected: boolean;
  error: string | null;
  /** Inside an assistant (MCP Apps), not Travel's own page. */
  embedded: boolean;
  call<T = unknown>(action: string, input?: Record<string, unknown>): Promise<T>;
  /** Tell the assistant which record the person selected (the kit's bounded selection). */
  select(value: { id: string; title: string } | null): void;
  /** Tell the assistant what the person changed, and refresh the screen's data. */
  didChange(summary?: string): void;
  /** Kept for the screens' old calls. The kit sends only the selection, through `select`. */
  context(state: unknown): void;
  /** Staging text in the assistant's composer. Null: the kit's view client can't. */
  ask: ((prompt: string) => Promise<void>) | null;
  openSources(): void;
  /** Where the person manages each assistant's access: Travel's Settings. */
  manageAccess(): void;
  setLocation(path: string, options?: { replace?: boolean; push?: boolean }): void;
  goBack(fallback: string): void;
  /** Counts address changes the screens didn't make themselves (Back and Forward). */
  moves: number;
  /** Links, maps and downloads work in Travel's own page, not inside an assistant's frame. */
  canOpenLinks: boolean;
  canDownload: boolean;
  openExternal(url: string): Promise<void>;
  openDirections(address: string): Promise<void>;
  selectFile(accept?: string): Promise<SelectedFile | null>;
  download(file: DownloadRequest): Promise<void>;
}

const RiAppContext = createContext<RiApp | null>(null);

export function useRiApp<TData = unknown>(): RiApp<TData> {
  const value = useContext(RiAppContext);
  if (!value) throw new Error("useRiApp needs a TravelBridge above this component");
  return value as RiApp<TData>;
}
export function useOptionalRiApp<TData = unknown>(): RiApp<TData> | null {
  return useContext(RiAppContext) as RiApp<TData> | null;
}

export function assertHttpsUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only https links open from Travel");
  return parsed.href;
}
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.slice(0, 400))}`;
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface TravelBridgeProps {
  /** The read action that places the screen for an address, such as `open_view`. */
  opener: string;
  children: ReactNode;
}

/** The bridge for Travel's screens. Put it inside the kit's AppProvider and a router. */
export function TravelBridge({ opener, children }: TravelBridgeProps) {
  const client = useAppClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [moves, setMoves] = useState(0);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [error, setError] = useState<string | null>(null);
  const path = location.pathname;
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search]);
  const key = JSON.stringify([opener, { path, query }]);
  const initial = client.initialActions[key];
  const [data, setData] = useState<unknown>(initial);
  const own = useRef(new Set<string>());
  const depth = useRef(0);

  // The host's theme (inside an assistant) or the person's system setting.
  useEffect(() => {
    const update = () => setTheme(readTheme());
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(update) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", update);
    return () => { observer?.disconnect(); media?.removeEventListener("change", update); };
  }, []);

  // Place the screen for this address, again after every change.
  const sequence = useRef(0);
  useEffect(() => {
    const id = ++sequence.current;
    void client.call(opener, { path, query }).then(
      (value) => { if (id === sequence.current) { setData(value); setError(null); } },
      (failure: Error) => { if (id === sequence.current) setError(failure.message || "Travel could not open. Try again."); },
    );
  }, [client.call, opener, key, revision]);

  // Back and Forward move the screen; its own navigation doesn't count as a move.
  const address = location.pathname + location.search;
  useEffect(() => {
    if (own.current.delete(address)) return;
    setMoves((count) => count + 1);
  }, [address]);

  const go = useCallback((to: string, options: { replace?: boolean; push?: boolean } = {}) => {
    const current = location.pathname + location.search;
    if (to === current) return;
    own.current.add(to);
    const samePath = to.split("?")[0] === location.pathname;
    const replace = options.replace || (samePath && !options.push);
    if (!replace) depth.current++;
    navigate(to, { replace });
  }, [location.pathname, location.search, navigate]);

  const bridge = useMemo<RiApp>(() => ({
    data, revision, theme, connected: true, error, embedded: client.embedded, moves,
    call: (action, input = {}) => client.call(action, input),
    select: client.select,
    didChange(summary) {
      if (summary) client.didChange(summary);
      setRevision((value) => value + 1);
    },
    context() { /* The kit sends the selection only. */ },
    ask: null,
    openSources() { go("/sources"); },
    manageAccess() { if (!client.embedded) window.location.assign("/settings"); },
    setLocation: go,
    goBack(fallback) {
      if (depth.current > 0) { depth.current--; navigate(-1); }
      else go(fallback, { replace: true });
    },
    canOpenLinks: !client.embedded,
    canDownload: !client.embedded,
    async openExternal(url) {
      if (client.embedded) throw new Error("Open Travel itself to follow links. An assistant's frame can't open them.");
      window.open(assertHttpsUrl(url), "_blank", "noopener,noreferrer");
    },
    async openDirections(address) {
      if (client.embedded) throw new Error("Open Travel itself to open a map. An assistant's frame can't open one.");
      window.open(directionsUrl(address), "_blank", "noopener,noreferrer");
    },
    selectFile(accept) {
      return new Promise<SelectedFile | null>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        if (accept) input.accept = accept;
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { resolve(null); return; }
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("This file could not be read."));
          reader.onload = () => {
            const value = String(reader.result ?? "");
            resolve({ name: file.name, mimeType: file.type || "application/octet-stream", base64: value.slice(value.indexOf(",") + 1) });
          };
          reader.readAsDataURL(file);
        };
        input.click();
      });
    },
    async download(file) {
      if (client.embedded) throw new Error("Open Travel itself to download. An assistant's frame can't save files.");
      const bytes = file.base64 !== undefined ? Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)) : new TextEncoder().encode(file.text ?? "");
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name.replace(/[\\/]/g, "-").slice(0, 120);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  }), [data, revision, theme, error, client, moves, go, navigate]);

  return <RiAppContext.Provider value={bridge}>{children}</RiAppContext.Provider>;
}
