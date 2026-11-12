import { createRequestHandler } from "react-router";
import serverBuild from "virtual:app-builder/ssr";
import { serveApp } from "@app-builder/core/node";
import { application } from "./app";
const render = createRequestHandler(serverBuild, "production");
await serveApp(application, { root: process.cwd(), render: (request, platform) => render(request, { platform }) });
