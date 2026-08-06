import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const manifestSource = resolve(rootDirectory, "manifest.json");
const manifestTarget = resolve(rootDirectory, "dist", "manifest.json");

function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    async writeBundle() {
      await copyFile(manifestSource, manifestTarget);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  envDir: resolve(rootDirectory, ".."),
  test: {
    environment: "jsdom",
    setupFiles: [resolve(rootDirectory, "src/test/setup.ts")],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(rootDirectory, "src/background/index.ts"),
        content: resolve(rootDirectory, "src/content/index.ts"),
        popup: resolve(rootDirectory, "src/popup/index.html"),
      },
      output: {
        entryFileNames(chunk) {
          if (chunk.name === "background") {
            return "background.js";
          }

          if (chunk.name === "content") {
            return "content.js";
          }

          return "assets/[name]-[hash].js";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(rootDirectory, "src"),
      "@shared": resolve(rootDirectory, "../shared/src"),
    },
  },
});
