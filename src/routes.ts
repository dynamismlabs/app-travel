import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/index.tsx"),
  route("settings", "routes/settings.tsx"),
  route("oauth/consent", "routes/consent.tsx"),
  route("*", "routes/app.tsx"),
] satisfies RouteConfig;
