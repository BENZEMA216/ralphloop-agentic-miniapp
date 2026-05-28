import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(fileURLToPath(import.meta.url));
const shareWebRuntimeDir = resolve(packageDir, "..", "share-web", "src", "runtime");

// `__TOKEN__` is rewritten by the gateway when it serves the HTML so the asset
// paths resolve to /app/share/<token>/v2/assets/...
export default defineConfig({
  root: packageDir,
  base: "/app/share/__TOKEN__/v2/",
  plugins: [react()],
  resolve: {
    alias: {
      "#runtime": shareWebRuntimeDir,
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: resolve(packageDir, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    target: "es2020",
    rollupOptions: {
      input: resolve(packageDir, "index.html"),
    },
  },
});
