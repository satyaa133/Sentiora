// Render the 1200×630 link-preview image (DESIGN.md §10) to frontend/public/og-image.png.
//   node scripts/generate-og-image.mjs
// Uses Inter from Google Fonts when reachable, otherwise the system sans-serif.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "frontend", "public", "og-image.png");

// Echo, happy state (shared/src/ui/Echo.tsx), in the light palette.
const echo = `
<svg viewBox="0 0 120 120" width="360" height="360" aria-hidden="true">
  <path d="M30 60 C30 22 90 22 90 60 V100 L80 92 L70 100 L60 92 L50 100 L40 92 L30 100 Z" fill="#111111"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M44 58 Q50 50 56 58"/>
    <path d="M64 58 Q70 50 76 58"/>
    <path d="M52 69 Q60 76 68 69"/>
  </g>
  <g fill="#FF5A3C"><circle cx="42" cy="68" r="4"/><circle cx="78" cy="68" r="4"/></g>
</svg>`;

const wordmark = [..."sentıora"]
  .map((ch) => (ch === "ı" ? `<span class="i">ı<span class="dot"></span></span>` : `<span>${ch}</span>`))
  .join("");

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..800&display=block">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #F4F4F3; color: #111111;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    display: grid; grid-template-columns: 1fr 420px; align-items: center;
    padding: 72px 80px;
  }
  .wm { display: inline-flex; align-items: baseline; font-weight: 800; font-size: 44px;
        letter-spacing: -0.045em; line-height: 1; }
  .wm span { display: inline-block; }
  .i { position: relative; }
  .dot { position: absolute; left: 50%; top: -0.03em; width: 0.3em; height: 0.3em;
         margin-left: -0.15em; border-radius: 999px; background: #FF5A3C; }
  h1 { margin-top: 56px; font-size: 92px; font-weight: 750; letter-spacing: -0.035em; line-height: 0.98; }
  h1 em { font-style: normal; background: linear-gradient(#FF5A3C, #FF5A3C) no-repeat 0 92% / 100% 0.12em; }
  p { margin-top: 32px; font-size: 28px; line-height: 1.4; color: #5F5F5C; max-width: 620px; }
  .echo { justify-self: end; }
</style></head>
<body>
  <div>
    <span class="wm">${wordmark}</span>
    <h1>Remember everything you <em>read.</em></h1>
    <p>Saves the articles, PDFs and videos you read, then answers your questions with sources.</p>
  </div>
  <div class="echo">${echo}</div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: "networkidle" }).catch(() => page.setContent(html));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  console.log(path.relative(root, out));
} finally {
  await browser.close();
}
