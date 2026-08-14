import { describe, expect, it } from "vitest";
import {
  capExtractedContent,
  normalizeExtractedText,
  sanitizeCapturePayload,
} from "./captureUtils";

describe("capture content limits", () => {
  it("preserves paragraph breaks for later chunking", () => {
    const raw = "Introduction\n\nBinary search reduces the interval.\n\n\nHow it works";
    expect(normalizeExtractedText(raw)).toBe(
      "Introduction\n\nBinary search reduces the interval.\n\nHow it works",
    );
  });

  it("does not truncate a normal article", () => {
    const article = normalizeExtractedText("This is a normal article about Docker containers. ".repeat(40));
    expect(capExtractedContent(article)).toBe(article);
    expect(article.length).toBeLessThan(80_000);
  });

  it("caps extremely large extracted text without dropping title metadata", () => {
    const huge = `${"word ".repeat(30_000)}Final sentence here.`;
    const capped = capExtractedContent(huge, 1_000);
    expect(capped.length).toBeLessThanOrEqual(1_000);
    expect(capped.length).toBeGreaterThan(700);
  });

  it("sanitizes payload content to the MVP size cap", () => {
    const payload = sanitizeCapturePayload({
      source_type: "webpage",
      url: "https://example.com/article",
      title: "Example Article",
      content: "paragraph ".repeat(20_000),
    });
    expect(payload.content.length).toBeLessThanOrEqual(80_000);
    expect(payload.title).toBe("Example Article");
    expect(payload.url).toBe("https://example.com/article");
  });
});
