/// <reference types="vitest/config" />
import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, build as viteBuild } from "vite";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const manifestSource = resolve(rootDirectory, "manifest.json");
const manifestTarget = resolve(rootDirectory, "dist", "manifest.json");

// pdfjs-dist worker — must be a static extension asset so chrome.runtime.getURL works
const pdfjsWorkerSrc = resolve(
  rootDirectory,
  "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
);
const pdfjsWorkerDest = resolve(rootDirectory, "dist", "pdf.worker.min.mjs");

function chromeExtensionBuildPlugin() {
  return {
    name: "chrome-extension-build",
    async writeBundle() {
      await copyFile(manifestSource, manifestTarget);
      // Copy PDF.js worker into dist so content script can reference it
      // via chrome.runtime.getURL("pdf.worker.min.mjs")
      await copyFile(pdfjsWorkerSrc, pdfjsWorkerDest);

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
    // Testing Library is hoisted next to React 19. Load its ESM build through Vite
    // and pin React so tests (and components from shared/) render with React 18.
    server: { deps: { inline: [/@testing-library/] } },
    alias: {
      "@testing-library/react": resolve(
        rootDirectory,
        "../node_modules/@testing-library/react/dist/@testing-library/react.esm.js",
      ),
      react: resolve(rootDirectory, "node_modules/react"),
      "react-dom": resolve(rootDirectory, "node_modules/react-dom"),
    },
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
    // npm hoists React 19 to the repo root (peer of @testing-library/react) while
    // this app uses React 18; dedupe so hoisted libraries (react-router) share
    // the app's single React copy instead of loading a second one.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": resolve(rootDirectory, "src"),
      "@shared": resolve(rootDirectory, "../shared/src"),
    },
  },
});
