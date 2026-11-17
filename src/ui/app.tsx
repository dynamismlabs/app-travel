/**
 * Travel's screens talk to the app through this bridge. It sits on the kit's
 * client (`useAppClient`: actions over tRPC in Travel's own page, or the
 * host's tool calls inside an assistant) and React Router (the address in
 * Travel's own page, memory inside an assistant).
 *
 * It keeps the shape of the bridge Ri's old app kit gave these screens, so
 * the screens changed little. Leaving the frame goes through the kit's host
 * calls, which check what the host allows first:
 * - a question drafted in the chat, only where the host drafts (Ri does)
 * - links and maps through the host's open-link, else the address to copy
 * - files through the host's save-file, or a browser download
 * - Open in browser, the way out of anything a host doesn't allow
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
  /** Tell the assistant about several selected records (at most 50 listed), or none with []. */
  selectMany(records: { id: string; title: string }[], total?: number): void;
  /** Tell the assistant where the person is: the place's name, its path and its filters. Open in browser opens it. */
  setSection(place: { title: string; path?: string; filters?: Record<string, string> } | null): void;
  /** Tell the assistant what the person changed, and refresh the screen's data. */
  didChange(summary?: string): void;
  /** Kept for the screens' old calls. The selection and section go through `select`, `selectMany` and `setSection`. */
  context(state: unknown): void;
  /** How a question reaches the chat: drafted for the person to send, shown to copy, or not at all (Travel's own page has no chat). */
  askMode: "draft" | "copy" | "none";
  /** Put a question in the chat's message box, unsent. False when the host didn't take it. */
  ask(prompt: string): Promise<boolean>;
  openSources(): void;
  /** Where the person manages each assistant's access: Travel's Settings, in the browser when inside an assistant. */
  manageAccess(): Promise<boolean>;
  setLocation(path: string, options?: { replace?: boolean; push?: boolean }): void;
  goBack(fallback: string): void;
  /** Counts address changes the screens didn't make themselves (Back and Forward). */
  moves: number;
  /** Whether the host opens links (always in Travel's own page). Otherwise links show their address to copy. */
  canOpenLinks: boolean;
  /** Whether files can be saved here: Travel's own page, or a host with save-file. */
  canDownload: boolean;
  /** Open a link. False when the host can't or refused, so show its address to copy. */
  openExternal(url: string): Promise<boolean>;
  openDirections(address: string): Promise<boolean>;
  selectFile(accept?: string): Promise<SelectedFile | null>;
  /** Save a file. False when it can't be saved here. */
  download(file: DownloadRequest): Promise<boolean>;
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
    selectMany: client.selectMany,
    setSection: client.setSection,
    didChange(summary) {
      if (summary) client.didChange(summary);
      setRevision((value) => value + 1);
    },
    context() { /* See select, selectMany and setSection. */ },
    askMode: !client.embedded ? "none" : client.can.draft ? "draft" : "copy",
    ask: (prompt) => client.draftMessage(prompt),
    openSources() { go("/sources"); },
    async manageAccess() {
      if (client.embedded) return client.openInBrowser("/settings");
      window.location.assign("/settings");
      return true;
    },
    setLocation: go,
    goBack(fallback) {
      if (depth.current > 0) { depth.current--; navigate(-1); }
      else go(fallback, { replace: true });
    },
    canOpenLinks: !client.embedded || client.can.openLink,
    canDownload: client.can.download,
    openExternal: (url) => client.openLink(assertHttpsUrl(url)),
    openDirections: (address) => client.openLink(directionsUrl(address)),
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
    download(file) {
      const data = file.base64 !== undefined ? Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)) : undefined;
      return client.download({ name: file.name, mimeType: file.mimeType, ...(data ? { data } : { text: file.text ?? "" }) });
    },
  }), [data, revision, theme, error, client, moves, go, navigate]);

  return <RiAppContext.Provider value={bridge}>{children}</RiAppContext.Provider>;
}
