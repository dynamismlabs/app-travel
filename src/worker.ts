import { createRequestHandler } from "react-router";
import serverBuild from "virtual:app-builder/ssr";
import { createApp } from "@app-builder/core";
import { createWorkerPlatform, runScheduled } from "@app-builder/core/worker";
import { application } from "./app";
import viewHTML from "../dist/mcp.html";
const render = createRequestHandler(serverBuild, "production");
export default {
  // The nightly backup and the app's own jobs (wrangler.jsonc lists both cron triggers).
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runScheduled(application, env, controller.cron)); },
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (/^\/(assets\/|offline\.html$|sw\.js$|manifest\.webmanifest$|icon\.svg$)/.test(new URL(request.url).pathname)) return env.ASSETS.fetch(request);
    const platform = createWorkerPlatform(env);
    const app = createApp({ ...application, viewHTML }, () => platform);
    app.all("*", (c) => render(c.req.raw, { platform }));
    return app.fetch(request, env, ctx);
  },
};
