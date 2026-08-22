import { describe, expect, it } from "vitest";
import { computeMemoryStats } from "./useMemoryStats";
import type { MemoryItem } from "../types/memory";

function item(partial: Partial<MemoryItem>): MemoryItem {
  return {
    id: "1",
    user_id: "u1",
    source_type: "webpage",
    url: "https://example.com/a",
    title: "Example",
    content: "Binary search halves the interval on each comparison step.",
    author: null,
    favicon_url: null,
    thumbnail_url: null,
    domain: "example.com",
    language: "en",
    word_count: 10,
    content_length: 60,
    reading_time_seconds: 30,
    summary: null,
    status: "ready",
    captured_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...partial,
  };
}

describe("computeMemoryStats", () => {
  it("counts source types and storage from the feed", () => {
    const items = [
      item({ id: "1", source_type: "webpage" }),
      item({ id: "2", source_type: "pdf", title: "Spec.pdf" }),
    ];
    const stats = computeMemoryStats(items, 2);
    expect(stats.webpageCount).toBe(1);
    expect(stats.pdfCount).toBe(1);
    expect(stats.totalCount).toBe(2);
    expect(stats.calculatedStorageString).not.toBe("0 KB");
  });
});
