import { describe, expect, it } from "vitest";
import {
  capExtractedContent,
  normalizeExtractedText,
  sanitizeCapturePayload,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "./captureUtils";
import type { StructuredNode } from "./types";

// ──────────────────────────────────────────────
// Existing Phase 1 tests — preserved
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// Phase 2 — v2 field passthrough in sanitizeCapturePayload
// ──────────────────────────────────────────────
describe("sanitizeCapturePayload v2 field passthrough", () => {
  const nodes: StructuredNode[] = [
    {
      id: "node-0",
      type: "heading",
      text: "Binary Search",
      order: 0,
      parent_id: null,
      metadata: { level: 1 },
    },
    {
      id: "node-1",
      type: "paragraph",
      text: "An efficient searching algorithm.",
      order: 1,
      parent_id: "node-0",
    },
  ];

  it("passes through structured_content", () => {
    const payload = sanitizeCapturePayload({
      source_type: "webpage",
      url: "https://example.com",
      title: "Test",
      content: "Some content here.",
      structured_content: nodes,
    });
    expect(payload.structured_content).toEqual(nodes);
  });

  it("passes through extraction metadata", () => {
    const extraction = {
      method: "readability" as const,
      duration_ms: 120,
      status: "success" as const,
      quality_score: 0.85,
      quality_reasons: ["readability_success", "rich_node_count"],
    };
    const payload = sanitizeCapturePayload({
      source_type: "webpage",
      url: "https://example.com",
      title: "Test",
      content: "Some content here.",
      extraction,
    });
    expect(payload.extraction).toEqual(extraction);
  });

  it("passes through captured_at timestamp", () => {
    const captured_at = "2026-08-15T00:00:00.000Z";
    const payload = sanitizeCapturePayload({
      source_type: "youtube",
      url: "https://youtube.com/watch?v=abc",
      title: "Test Video",
      content: "Transcript content here.",
      captured_at,
    });
    expect(payload.captured_at).toBe(captured_at);
  });

  it("passes through v2 fields for PDF payload", () => {
    const payload = sanitizeCapturePayload({
      source_type: "pdf",
      url: "https://example.com/doc.pdf",
      title: "My PDF",
      content: "PDF extracted content.",
      structured_content: nodes,
      captured_at: "2026-08-15T00:00:00.000Z",
    });
    expect(payload.structured_content).toEqual(nodes);
    expect(payload.captured_at).toBe("2026-08-15T00:00:00.000Z");
  });
});

// ──────────────────────────────────────────────
// Phase 2 — buildPlainTextFromNodes
// ──────────────────────────────────────────────
describe("buildPlainTextFromNodes", () => {
  it("formats headings with # prefixes", () => {
    const nodes: StructuredNode[] = [
      { id: "n0", type: "heading", text: "Binary Search", order: 0, parent_id: null, metadata: { level: 1 } },
      { id: "n1", type: "heading", text: "Algorithm", order: 1, parent_id: "n0", metadata: { level: 2 } },
    ];
    const text = buildPlainTextFromNodes(nodes);
    expect(text).toContain("# Binary Search");
    expect(text).toContain("## Algorithm");
  });

  it("formats list items with bullet symbols", () => {
    const nodes: StructuredNode[] = [
      { id: "n0", type: "list_item", text: "Step one", order: 0, parent_id: null, metadata: { list_style: "unordered" } },
      { id: "n1", type: "list_item", text: "Step two", order: 1, parent_id: null, metadata: { list_style: "ordered" } },
    ];
    const text = buildPlainTextFromNodes(nodes);
    expect(text).toContain("• Step one");
    expect(text).toContain("- Step two");
  });

  it("formats code blocks with backtick fences and language", () => {
    const nodes: StructuredNode[] = [
      {
        id: "n0",
        type: "code_block",
        text: "def search(arr):\n    return arr[mid]",
        order: 0,
        parent_id: null,
        metadata: { language: "python" },
      },
    ];
    const text = buildPlainTextFromNodes(nodes);
    expect(text).toContain("```python");
    expect(text).toContain("def search(arr):");
    expect(text).toContain("    return arr[mid]"); // indentation preserved
    expect(text).toContain("```");
  });

  it("joins paragraphs with double newlines", () => {
    const nodes: StructuredNode[] = [
      { id: "n0", type: "paragraph", text: "First paragraph.", order: 0, parent_id: null },
      { id: "n1", type: "paragraph", text: "Second paragraph.", order: 1, parent_id: null },
    ];
    const text = buildPlainTextFromNodes(nodes);
    expect(text).toBe("First paragraph.\n\nSecond paragraph.");
  });
});

// ──────────────────────────────────────────────
// Phase 2 — scoreExtractionQuality
// ──────────────────────────────────────────────
describe("scoreExtractionQuality", () => {
  it("scores 0.0 for failed status", () => {
    const { quality_score } = scoreExtractionQuality([], "readability", "failed");
    expect(quality_score).toBe(0.0);
  });

  it("scores 0.0 for insufficient_content", () => {
    const { quality_score } = scoreExtractionQuality([], "readability", "insufficient_content");
    expect(quality_score).toBe(0.0);
  });

  it("gives bonus for readability success", () => {
    const nodes: StructuredNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      type: "paragraph" as const,
      text: "Binary search halves the search interval each iteration.",
      order: i,
      parent_id: null,
    }));
    const { quality_score, quality_reasons } = scoreExtractionQuality(nodes, "readability", "success");
    expect(quality_score).toBeGreaterThan(0.3);
    expect(quality_reasons).toContain("readability_success");
  });

  it("gives bonus for code presence", () => {
    const nodes: StructuredNode[] = [
      { id: "n0", type: "code_block", text: "def binary_search(arr): pass", order: 0, parent_id: null },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `n${i + 1}`,
        type: "paragraph" as const,
        text: "Long meaningful paragraph about binary search algorithms.",
        order: i + 1,
        parent_id: null,
      })),
    ];
    const { quality_reasons } = scoreExtractionQuality(nodes, "readability", "success");
    expect(quality_reasons).toContain("code_present");
  });

  it("score is always between 0.0 and 1.0", () => {
    const manyNodes: StructuredNode[] = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      type: i % 3 === 0 ? "heading" as const : "paragraph" as const,
      text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
      order: i,
      parent_id: null,
      metadata: i % 3 === 0 ? { level: 2 } : undefined,
    }));
    const { quality_score } = scoreExtractionQuality(manyNodes, "readability", "success");
    expect(quality_score).toBeGreaterThanOrEqual(0.0);
    expect(quality_score).toBeLessThanOrEqual(1.0);
  });
});
