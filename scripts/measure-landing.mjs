// Measure the landing page like a mid-range phone (DESIGN.md §11: LCP under 2.5s).
//   npm run build:frontend && npm run perf:landing
// Serves frontend/dist with `vite preview`, then loads "/" in Chromium with
// Lighthouse's mobile throttling (4x CPU, slow 4G: 150ms RTT, 1.6 Mbps down).
// Reports median FCP/LCP over several cold loads, the LCP element, JS bytes and
// any API requests (the landing page should make none when signed out).
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const RUNS = Number(process.env.RUNS ?? 5);
const PORT = 4174;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// FRONTEND_DIR measures another build, e.g. an older commit checked out elsewhere.
const frontend = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : path.join(root, "frontend");

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const server = await preview({
  root: frontend,
  configFile: path.join(frontend, "vite.config.ts"),
  preview: { port: PORT, strictPort: true, host: "127.0.0.1" },
  logLevel: "error",
});
const browser = await chromium.launch();

try {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const context = await browser.newContext({
      viewport: { width: 412, height: 823 },
      deviceScaleFactor: 1.75,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    await page.addInitScript(() => {
      window.__perf = { lcp: 0, lcpElement: "", fcp: 0 };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perf.lcp = entry.startTime;
          const el = entry.element;
          window.__perf.lcpElement = el ? `${el.tagName.toLowerCase()}: ${(el.textContent ?? "").trim().slice(0, 40)}` : "";
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") window.__perf.fcp = entry.startTime;
        }
      }).observe({ type: "paint", buffered: true });
    });

    let jsBytes = 0;
    const apiRequests = [];
    page.on("request", (request) => {
      if (/\/api\/v1\//.test(request.url())) apiRequests.push(request.url());
    });
    page.on("response", async (response) => {
      if (response.request().resourceType() === "script") {
        const length = Number(response.headers()["content-length"] ?? 0);
        jsBytes += length || (await response.body().catch(() => Buffer.alloc(0))).length;
      }
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    // LCP is final once the user interacts; settle, then read it.
    await page.waitForTimeout(3000);
    const perf = await page.evaluate(() => window.__perf);
    runs.push({ ...perf, jsBytes, apiRequests: apiRequests.length });
    await context.close();
  }

  const result = {
    runs: RUNS,
    medianFcpMs: Math.round(median(runs.map((r) => r.fcp))),
    medianLcpMs: Math.round(median(runs.map((r) => r.lcp))),
    lcpElement: runs[runs.length - 1].lcpElement,
    jsTransferredKb: Math.round(median(runs.map((r) => r.jsBytes)) / 1024),
    apiRequests: Math.max(...runs.map((r) => r.apiRequests)),
    budgetMs: 2500,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.medianLcpMs > result.budgetMs) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
