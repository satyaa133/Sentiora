// Opt-in manual check: load the built extension (extension/dist) into Chromium,
// open a public YouTube video, and ask the real content script to extract a
// capture payload (FORCE_CAPTURE). Nothing is sent to the Sentiora API.
//
//   npm run build:extension
//   node scripts/verify-youtube-extension.mjs [videoId]
//
// Exits 0 when a transcript payload was extracted, 1 otherwise (with the
// extension's typed error code). Network access to youtube.com is required.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "extension", "dist");
const videoId = process.argv[2] ?? "aircAruvnKk";

if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
  console.error("extension/dist is missing; run `npm run build:extension` first.");
  process.exit(2);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sentiora-ext-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: process.env.HEADED !== "1",
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  locale: "en-US",
});

let exitCode = 1;
try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });

  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { waitUntil: "domcontentloaded" });

  // Decline the EU consent interstitial if shown (privacy-preserving choice).
  const reject = page.getByRole("button", { name: /reject all/i }).first();
  if (await reject.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await reject.click();
    await page.waitForURL(/watch\?v=/, { timeout: 15_000 }).catch(() => undefined);
  }
  await page.waitForSelector("#movie_player", { timeout: 30_000 });
  await page.waitForTimeout(3_000);

  const response = await worker.evaluate(async (expectedId) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url?.includes(expectedId));
    if (!tab?.id) return { success: false, error: "tab not found" };
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "FORCE_CAPTURE" }, { frameId: 0 }, (r) =>
        resolve(r ?? { success: false, error: chrome.runtime.lastError?.message ?? "no response" }),
      );
    });
  }, videoId);

  if (response?.success && response.payload) {
    const p = response.payload;
    const nodes = p.structured_content ?? [];
    console.log(
      JSON.stringify(
        {
          result: "TRANSCRIPT_EXTRACTED",
          url: p.url,
          title: p.title,
          author: p.author,
          words: p.content.split(/\s+/).length,
          segments: nodes.length,
          firstSegment: nodes[0]?.metadata,
          lastSegment: nodes.at(-1)?.metadata,
          extraction: p.extraction,
          sample: p.content.slice(0, 160),
        },
        null,
        2,
      ),
    );
    exitCode = 0;
  } else {
    console.log(JSON.stringify({ result: "NO_TRANSCRIPT", ...response }, null, 2));
  }
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(exitCode);
