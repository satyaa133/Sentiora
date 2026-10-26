/// <reference types="vitest/config" />
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  envDir: resolve(rootDirectory, ".."),
  test: {
    environment: "jsdom",
    setupFiles: [resolve(rootDirectory, "src/test/setup.ts")],
    // Testing Library and React Router are hoisted next to React 19. Load them through Vite
    // and pin React so tests (and components from shared/) render with React 18.
    server: { deps: { inline: [/@testing-library/, /react-router/] } },
    alias: [
      {
        find: /^@testing-library\/react$/,
        replacement: resolve(
          rootDirectory,
          "../node_modules/@testing-library/react/dist/@testing-library/react.esm.js",
        ),
      },
      {
        find: /^react-router-dom$/,
        replacement: resolve(
          rootDirectory,
          "../node_modules/react-router-dom/dist/index.mjs",
        ),
      },
      {
        find: /^react-router$/,
        replacement: resolve(
          rootDirectory,
          "../node_modules/react-router/dist/development/index.mjs",
        ),
      },
      {
        find: /^react-router\/dom$/,
        replacement: resolve(
          rootDirectory,
          "../node_modules/react-router/dist/development/dom-export.mjs",
        ),
      },
      {
        find: /^react(\/.*)?$/,
        replacement: resolve(rootDirectory, "node_modules/react") + "$1",
      },
      {
        find: /^react-dom(\/.*)?$/,
        replacement: resolve(rootDirectory, "node_modules/react-dom") + "$1",
      },
    ],
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
