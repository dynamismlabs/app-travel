import type { Platform } from "@app-builder/core";
import "react-router";
declare module "react-router" { interface AppLoadContext { platform: Platform } }
