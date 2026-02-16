import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: demoRoot,
  publicDir: path.join(demoRoot, "public"),
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  build: {
    outDir: path.join(demoRoot, "dist"),
    emptyOutDir: true,
  },
});
