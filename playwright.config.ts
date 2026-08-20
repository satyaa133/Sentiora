import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:5173",
  },
  webServer: {
    command: "node scripts/run-python.mjs -m uvicorn app.main:app --host 127.0.0.1 --port 8000",
    url: "http://127.0.0.1:8000/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
