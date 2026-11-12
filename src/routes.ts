import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/app.tsx", { id: "home" }),
  route("settings", "routes/settings.tsx"),
  route("oauth/consent", "routes/consent.tsx"),
  route("*", "routes/app.tsx"),
] satisfies RouteConfig;
