import { useMemo } from "react";
import type { MemoryItem } from "../types/memory";

export function computeMemoryStats(items: MemoryItem[], totalCount: number) {
  const webpageCount = items.filter((item) => item.source_type?.toLowerCase() === "webpage").length;
  const pdfCount = items.filter((item) => item.source_type?.toLowerCase() === "pdf").length;
  const youtubeCount = items.filter((item) => item.source_type?.toLowerCase() === "youtube").length;
  const typesPresent = new Set(items.map((item) => item.source_type));
  const activeSourcesCount = Math.max(typesPresent.size, 1);

  let calculatedStorageString = "0 KB";
  if (items && items.length > 0) {
    let totalBytes = 0;
    for (const item of items) {
      const text = (item.title || "") + (item.content || "") + (item.url || "") + (item.summary || "");
      totalBytes += new Blob([text]).size + 512;
    }
    if (totalBytes < 1024 * 1024) {
      calculatedStorageString = `${(totalBytes / 1024).toFixed(1)} KB`;
    } else if (totalBytes < 1024 * 1024 * 1024) {
      calculatedStorageString = `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      calculatedStorageString = `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
  }

  let lastCaptureTimeFormatted = "None";
  if (items && items.length > 0 && items[0]?.captured_at) {
    try {
      const date = new Date(items[0].captured_at);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (diffSecs < 60) lastCaptureTimeFormatted = "Just now";
      else if (diffSecs < 3600) lastCaptureTimeFormatted = `${Math.floor(diffSecs / 60)}m ago`;
      else if (diffSecs < 86400) lastCaptureTimeFormatted = `${Math.floor(diffSecs / 3600)}h ago`;
      else if (diffSecs < 172800) lastCaptureTimeFormatted = "Yesterday";
      else lastCaptureTimeFormatted = `${Math.floor(diffSecs / 86400)}d ago`;
    } catch {
      lastCaptureTimeFormatted = "Recently";
    }
  }

  return {
    webpageCount,
    pdfCount,
    youtubeCount,
    activeSourcesCount,
    calculatedStorageString,
    lastCaptureTimeFormatted,
    totalCount,
  };
}

export function useMemoryStats(items: MemoryItem[], totalCount: number) {
  return useMemo(() => computeMemoryStats(items, totalCount), [items, totalCount]);
}
