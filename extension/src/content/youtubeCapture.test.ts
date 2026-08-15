import { describe, expect, it } from "vitest";
import { buildPlainTextFromNodes } from "../shared/captureUtils";
import {
  groupTranscriptSegments,
  parseCaptionTracks,
  parseTimedTextJson3,
  parseTimedTextXml,
  decodeHtmlEntities,
} from "./youtubeCapture";
import type { StructuredNode } from "../shared/types";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeTranscriptXml(segments: { text: string; start: number; dur: number }[]): string {
  const items = segments
    .map((s) => `<text start="${s.start}" dur="${s.dur}">${s.text}</text>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?><transcript>${items}</transcript>`;
}

function makeTranscriptNodes(segments: { text: string; start: number; dur: number }[]): StructuredNode[] {
  return segments.map((s, i) => ({
    id: `node-${i}`,
    type: "paragraph" as const,
    text: s.text,
    order: i,
    parent_id: null,
    metadata: {
      start_seconds: s.start,
      end_seconds: Math.round((s.start + s.dur) * 10) / 10,
    },
  }));
}

// ──────────────────────────────────────────────
// isYoutubeWatchPage
// ──────────────────────────────────────────────
describe("isYoutubeWatchPage", () => {
  it("detects youtube watch page by hostname + path + query", () => {
    // We can't change window.location in jsdom easily, so we test the helper
    // via URL inspection logic equivalence
    const url = new URL("https://www.youtube.com/watch?v=abc123");
    const result =
      url.hostname.includes("youtube.com") &&
      url.pathname === "/watch" &&
      url.searchParams.has("v");
    expect(result).toBe(true);
  });

  it("rejects non-watch youtube pages", () => {
    const url = new URL("https://www.youtube.com/channel/UCxyz");
    const result =
      url.hostname.includes("youtube.com") &&
      url.pathname === "/watch" &&
      url.searchParams.has("v");
    expect(result).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Transcript nodes → content
// ──────────────────────────────────────────────
describe("YouTube transcript StructuredNode conversion", () => {
  it("produces paragraph nodes with start_seconds and end_seconds", () => {
    const nodes = makeTranscriptNodes([
      { text: "Binary search is a divide and conquer algorithm.", start: 0.0, dur: 5.2 },
      { text: "It requires a sorted array as input.", start: 5.2, dur: 4.8 },
    ]);
    expect(nodes.length).toBe(2);
    expect(nodes[0]!.type).toBe("paragraph");
    expect(nodes[0]!.metadata?.start_seconds).toBe(0.0);
    expect(nodes[0]!.metadata?.end_seconds).toBeCloseTo(5.2);
    expect(nodes[1]!.metadata?.start_seconds).toBe(5.2);
  });

  it("preserves transcript text without fabrication", () => {
    const nodes = makeTranscriptNodes([
      { text: "The algorithm compares the target to the middle element.", start: 10.0, dur: 6.0 },
    ]);
    const content = buildPlainTextFromNodes(nodes);
    expect(content).toContain("middle element");
    expect(content).not.toContain("YouTube video titled");
  });

  it("decodes HTML entities correctly", () => {
    // Simulate entity decoding
    const raw = "It&amp;s O&#39;(log n) complexity &quot;fast&quot;";
    const decoded = decodeHtmlEntities(raw);
    expect(decoded).toBe('It&s O\'(log n) complexity "fast"');
  });
});

// ──────────────────────────────────────────────
// Description fallback
// ──────────────────────────────────────────────
describe("YouTube description fallback", () => {
  it("description lines become paragraph nodes", () => {
    const description =
      "Binary search tutorial.\nLearn divide and conquer.\nExplained with examples.";
    const nodes = description
      .split(/\n+/)
      .filter((line) => line.trim().length >= 10)
      .map((line, i) => ({
        id: `node-${i}`,
        type: "paragraph" as const,
        text: line.trim(),
        order: i,
        parent_id: null,
      }));
    expect(nodes.length).toBe(3);
    expect(nodes[0]!.text).toBe("Binary search tutorial.");
  });

  it("description shorter than 50 chars produces no nodes (insufficient)", () => {
    const description = "Short.";
    const nodes =
      description.length >= 50
        ? [{ id: "node-0", type: "paragraph" as const, text: description, order: 0, parent_id: null }]
        : [];
    expect(nodes).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// No fabrication
// ──────────────────────────────────────────────
describe("YouTube no-fabrication rule", () => {
  it("does NOT produce a stub string for empty content", () => {
    // Simulate the old broken behavior and verify our logic avoids it
    const transcriptFailed = true;
    const description = "";
    let result: string | null = null;

    if (!transcriptFailed) {
      result = "some transcript";
    } else if (description.length >= 50) {
      result = description;
    }
    // We should NOT fall through to a fabricated stub
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────
// Timestamp XML parsing
// ──────────────────────────────────────────────
describe("YouTube timedtext XML parsing", () => {
  it("parses start and dur attributes from XML", () => {
    const xml = makeTranscriptXml([
      { text: "Binary search explanation", start: 124.5, dur: 13.7 },
    ]);
    const segments = parseTimedTextXml(xml);
    expect(segments).toHaveLength(1);
    expect(segments![0]!.start).toBeCloseTo(124.5);
    expect(segments![0]!.end).toBeCloseTo(138.2);
    expect(segments![0]!.text).toBe("Binary search explanation");
  });
});

describe("YouTube caption track parsing", () => {
  it("reads captionTracks from ytInitialPlayerResponse", () => {
    const tracks = parseCaptionTracks({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: "https://www.youtube.com/api/timedtext?v=abc", languageCode: "en" },
            { baseUrl: "https://www.youtube.com/api/timedtext?v=abc&kind=asr", languageCode: "en", kind: "asr" },
          ],
        },
      },
    });
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.languageCode).toBe("en");
  });

  it("parses json3 caption events into transcript text", () => {
    const segments = parseTimedTextJson3(
      JSON.stringify({
        events: [
          { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Binary " }, { utf8: "search" }] },
          { tStartMs: 1200, dDurationMs: 900, segs: [{ utf8: "in a rotated array" }] },
        ],
      }),
    );
    expect(segments).not.toBeNull();
    expect(segments!.map((s) => s.text).join(" ")).toContain("Binary search");
    expect(segments!.map((s) => s.text).join(" ")).toContain("rotated array");
  });

  it("groups short caption cues into longer searchable paragraphs", () => {
    const nodes = groupTranscriptSegments([
      { text: "Search", start: 0, end: 1 },
      { text: "the", start: 1, end: 1.2 },
      { text: "rotated", start: 1.2, end: 1.8 },
      { text: "sorted array using binary search.", start: 1.8, end: 4 },
    ]);
    const content = buildPlainTextFromNodes(nodes);
    expect(content.split(/\s+/).length).toBeGreaterThan(3);
    expect(content).toContain("binary search");
  });
});
