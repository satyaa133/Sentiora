import { describe, expect, it } from "vitest";
import {
  extractSemanticText,
  getExtractionRoot,
  stripNonContentNodes,
} from "../content/webpageCapture";

describe("webpage extraction helpers", () => {
  it("prefers article as the extraction root", () => {
    document.body.innerHTML = `
      <nav>Home About</nav>
      <article><h1>Readable Title</h1><p>${"Meaningful sentence. ".repeat(8)}</p></article>
      <footer>Copyright</footer>
    `;
    const root = getExtractionRoot(document);
    expect(root.tagName.toLowerCase()).toBe("article");
  });

  it("strips scripts, nav, and ads before text extraction", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <script>window.tracker = true;</script>
      <nav>Skip this nav</nav>
      <p>Keep this paragraph for the vault.</p>
      <div class="advertisement">Buy now</div>
    `;
    stripNonContentNodes(root);
    const text = extractSemanticText(root);
    expect(text).toContain("Keep this paragraph for the vault.");
    expect(text).not.toContain("window.tracker");
    expect(text).not.toContain("Buy now");
  });
});
