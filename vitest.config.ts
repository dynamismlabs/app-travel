import { defineConfig } from "vitest/config";
export default defineConfig({ esbuild: { jsx: "automatic" }, test: { include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], environment: "node", testTimeout: 30000, hookTimeout: 30000, maxWorkers: 2 } });
