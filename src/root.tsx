import React from "react";
import { Links, Meta, Outlet, Scripts, redirect, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { AppProvider } from "@app-builder/core/react";
import { loadAppPage } from "@app-builder/core/ssr";
import { application } from "./app";
import { appConfig } from "../app.config";
import "./styles.css";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const state = await loadAppPage(application, context.platform, request, [{ name: "list_books" }]);
  const url = new URL(request.url);
  if (state.viewer && url.pathname === "/login" && url.searchParams.has("response_type")) throw redirect("/api/auth/mcp/authorize" + url.search);
  return state;
}
export function headers() { return { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization" }; }
export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-rendering="ssr"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{appConfig.name}</title><Meta /><Links /><link rel="manifest" href="/manifest.webmanifest" /><link rel="icon" href="/icon.svg" /></head><body>{children}<Scripts /></body></html>;
}
export default function Root() {
  const state = useLoaderData<typeof loader>();
  const location = useLocation();
  return <AppProvider config={appConfig} initialState={state} url={location.pathname + location.search}><Outlet /></AppProvider>;
}
