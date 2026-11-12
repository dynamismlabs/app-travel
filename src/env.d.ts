declare module "*.html" {
  const html: string;
  export default html;
}

declare module "virtual:app-builder/ssr" {
  import type { ServerBuild } from "react-router";
  const build: ServerBuild;
  export default build;
}
