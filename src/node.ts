import { createRequestHandler } from "react-router";
import serverBuild from "virtual:app-builder/ssr";
import { serveApp } from "@app-builder/core/node";
import { application } from "./app";
import { closeTravelDatabases } from "./db/connection";
import { seedPreview } from "./fixtures/preview";
const render = createRequestHandler(serverBuild, "production");
const running = await serveApp(application, {
  root: process.cwd(),
  render: (request, platform) => render(request, { platform }),
  // Travel's own connection to the same database closes with the kit's.
  onStop: async () => { closeTravelDatabases(); },
});
// TRAVEL_PREVIEW=fictional fills an empty installation with Alex Rivera's fictional trips (scripts/preview.mjs).
if (process.env.TRAVEL_PREVIEW === "fictional") console.log(await seedPreview(running.platform));
