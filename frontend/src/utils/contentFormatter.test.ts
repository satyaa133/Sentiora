import { describe, expect, it } from "vitest";
import type { MemoryItem } from "../types/memory";
import { formatExtractedContent, formatYoutubeTranscript } from "./contentFormatter";

function item(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "m1",
    user_id: "u1",
    source_type: "webpage",
    url: "https://sentiora.app/manual/1",
    title: "Too Short Note",
    content: "Too short to index.",
    summary: null,
    author: null,
    favicon_url: null,
    thumbnail_url: null,
    domain: null,
    language: null,
    content_length: 0,
    word_count: 0,
    reading_time_seconds: 0,
    status: "failed",
    processing_error: "Extracted text is too short to index (4 words).",
    captured_at: "2026-10-24T10:00:00Z",
    created_at: "2026-10-24T10:00:00Z",
    ...overrides,
  };
}

describe("formatExtractedContent", () => {
  it("shows short notes as written instead of inventing a description", () => {
    const formatted = formatExtractedContent(item());
    expect(formatted.cleanText).toBe("Too short to index.");
    expect(formatted.cleanText).not.toMatch(/layout references|media assets|design components/i);
  });

  it("describes metric noise honestly", () => {
    const formatted = formatExtractedContent(item({ content: "3k 1.6m Gallery 593k 1.2k Photos 684 12k", url: "https://gallery.example.com/x" }));
    expect(formatted.cleanText).toBe("Little readable text was captured from gallery.example.com.");
  });

  it("keeps normal article text", () => {
    const content = "Binary search halves the interval each step and works on sorted arrays.\n\nIt runs in logarithmic time, which makes it fast for large collections.";
    const formatted = formatExtractedContent(item({ content, status: "ready", word_count: 24 }));
    expect(formatted.isGalleryOrMetricNoise).toBe(false);
    expect(formatted.paragraphs.join(" ")).toContain("logarithmic time");
  });
});

describe("formatYoutubeTranscript", () => {
  it("uses real segment timestamps from structured content, in order", () => {
    const paragraphs = formatYoutubeTranscript("ignored", [
      { id: "b", type: "paragraph", text: "second part of the talk", order: 1, metadata: { start_seconds: 75 } },
      { id: "a", type: "paragraph", text: "first part of the talk", order: 0, metadata: { start_seconds: 0 } },
      { id: "c", type: "paragraph", text: "hour mark", order: 2, metadata: { start_seconds: 3725 } },
    ]);
    expect(paragraphs).toEqual([
      "[00:00] first part of the talk",
      "[01:15] second part of the talk",
      "[1:02:05] hour mark",
    ]);
  });

  it("never invents timestamps when none were captured", () => {
    const paragraphs = formatYoutubeTranscript("One. Two. Three. Four.", null);
    expect(paragraphs.join(" ")).not.toMatch(/\[\d{2}:\d{2}\]/);
    expect(paragraphs).toEqual(["One. Two. Three.", "Four."]);
  });
});
