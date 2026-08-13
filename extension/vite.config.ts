import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, build as viteBuild } from "vite";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const manifestSource = resolve(rootDirectory, "manifest.json");
const manifestTarget = resolve(rootDirectory, "dist", "manifest.json");

function chromeExtensionBuildPlugin() {
  return {
    name: "chrome-extension-build",
    async writeBundle() {
      await copyFile(manifestSource, manifestTarget);

      // Build standalone background.js as a self-contained ES module
      await viteBuild({
        configFile: false,
        envDir: resolve(rootDirectory, ".."),
        build: {
          outDir: resolve(rootDirectory, "dist"),
          emptyOutDir: false,
          lib: {
            entry: resolve(rootDirectory, "src/background/index.ts"),
            formats: ["es"],
            fileName: () => "background.js",
          },
        },
        resolve: {
          alias: {
            "@": resolve(rootDirectory, "src"),
            "@shared": resolve(rootDirectory, "../shared/src"),
          },
        },
      });

      // Build standalone content.js as a self-contained IIFE script
      await viteBuild({
        configFile: false,
        envDir: resolve(rootDirectory, ".."),
        build: {
          outDir: resolve(rootDirectory, "dist"),
          emptyOutDir: false,
          lib: {
            entry: resolve(rootDirectory, "src/content/index.ts"),
            formats: ["iife"],
            name: "SentioraContent",
            fileName: () => "content.js",
          },
        },
        resolve: {
          alias: {
            "@": resolve(rootDirectory, "src"),
            "@shared": resolve(rootDirectory, "../shared/src"),
          },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), chromeExtensionBuildPlugin()],
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
        popup: resolve(rootDirectory, "src/popup/index.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
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
