import React from "react";
import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

export default async function render(request: Request, status: number, headers: Headers, context: EntryContext) {
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />, { signal: request.signal, onError(error) { console.error("ssr_render_failed", { message: error instanceof Error ? error.message : "Render failed" }); } });
  // Complete the initial HTML so stream failures are caught before it is sent.
  await body.allReady;
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return new Response(body, { status, headers });
}
