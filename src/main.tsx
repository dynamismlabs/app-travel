import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router";
import { AppProvider, EmbeddedView } from "@app-builder/core/react";
import { appConfig } from "../app.config";
import { AppScreens, viewCards } from "./screens";
// Browser entry for the offline shell and the assistant view (MCP Apps). Web requests use SSR.
// In an assistant the app lives in a sandboxed frame with no address of its own, so it routes in memory.
const embedded = document.documentElement.dataset.mode === "mcp";
createRoot(document.getElementById("root")!).render(<AppProvider config={appConfig}>{embedded
  ? <MemoryRouter><EmbeddedView cards={viewCards}><AppScreens /></EmbeddedView></MemoryRouter>
  : <BrowserRouter><AppScreens /></BrowserRouter>}</AppProvider>);
