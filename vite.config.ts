import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({ plugins: [tailwindcss(), reactRouter()], ssr: { external: ["@app-builder/core", "@app-builder/core/react", "@app-builder/core/ssr", "@app-builder/core/schema"] } });
