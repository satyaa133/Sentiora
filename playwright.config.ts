import { defineConfig } from "@playwright/test";

// End-to-end tests run against a dedicated stack, never the dev servers on
// :8000/:5173: the API (and RQ worker, when Redis is reachable) use the test
// database and a separate Redis DB, started by backend/tests/e2e_stack.py.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5180);
const API_URL = `http://localhost:${API_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

process.env.E2E_API_BASE_URL ??= API_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node scripts/run-python.mjs -m tests.e2e_stack",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      env: {
        E2E_API_PORT: String(API_PORT),
        E2E_FRONTEND_ORIGIN: FRONTEND_URL,
      },
    },
    {
      command: `npm run dev --workspace frontend -- --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: API_URL },
    },
  ],
});
