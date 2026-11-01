import type { MemoryItem } from "../types/memory";

/**
 * Sanitizes and cleans raw extracted text, filtering out thumbnail noise,
 * view counts (e.g. 3k 1.6m 3.2k), and boilerplate navigation footer strings.
 */
export function cleanRawExtractedText(rawText: string | null): string {
  if (!rawText) return "";

  let cleaned = rawText.replace(/\s+/g, " ").trim();

  // Strip standalone numeric metric tokens (3k, 1.6m, 593k, 1.2k, 684, etc.)
  const words = cleaned.split(" ");
  const resultWords: string[] = [];
  let metricStreak = 0;

  for (const word of words) {
    const isMetric = /^\d+(\.\d+)?[kmKMbB]?$/i.test(word.replace(/,/g, ""));
    if (isMetric) {
      metricStreak++;
      if (metricStreak <= 2) {
        resultWords.push(word);
      }
    } else {
      metricStreak = 0;
      resultWords.push(word);
    }
  }

  cleaned = resultWords.join(" ").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/Loading more\.\.\./gi, "").trim();

  return cleaned;
}

export interface FormattedContentResult {
  headline: string;
  cleanText: string;
  paragraphs: string[];
  isGalleryOrMetricNoise: boolean;
  sourceLabel: string;
}

/**
 * Source-specific formatting engine that produces clean paragraphs,
 * structured bullet points, timestamps for YouTube, and section headers for PDFs.
 */
export function formatExtractedContent(item: MemoryItem): FormattedContentResult {
  const rawText = item.content || item.summary || "";
  const cleaned = cleanRawExtractedText(rawText);

  // Metric/gallery noise (view counts, thumbnail grids). Short notes are not noise:
  // they are shown as written.
  const words = cleaned.split(" ").filter(Boolean);
  const metricWords = words.filter((w) => /^\d+(\.\d+)?[kmKMbB]?$/i.test(w.replace(/,/g, "")));
  const isGalleryOrMetricNoise =
    (words.length >= 4 && metricWords.length / words.length > 0.3) ||
    /^((\d+[.\d]*[kmKMbB]?\s*)+)(Loading more\.\.\.)?$/i.test(cleaned);

  const domain = getDomain(item.url);

  if (!cleaned || isGalleryOrMetricNoise) {
    // Never invent a description of the page: say plainly that little text exists.
    const cleanText = cleaned && !isGalleryOrMetricNoise
      ? cleaned
      : `Little readable text was captured from ${domain}.`;
    return {
      headline: item.title || domain,
      cleanText,
      paragraphs: [cleanText],
      isGalleryOrMetricNoise: true,
      sourceLabel: item.source_type.toUpperCase(),
    };
  }

  // Source-specific formatting
  if (item.source_type === "youtube") {
    const paragraphs = formatYoutubeTranscript(cleaned, item.structured_content);
    return {
      headline: item.title,
      cleanText: cleaned,
      paragraphs,
      isGalleryOrMetricNoise: false,
      sourceLabel: "YOUTUBE TRANSCRIPT",
    };
  }

  if (item.source_type === "pdf") {
    const paragraphs = formatPdfDocument(cleaned);
    return {
      headline: item.title,
      cleanText: cleaned,
      paragraphs,
      isGalleryOrMetricNoise: false,
      sourceLabel: "PDF DOCUMENT",
    };
  }

  // Default Webpage formatting: split into clean readable paragraphs
  const rawParagraphs = cleaned
    .split(/(?:\r?\n){2,}|\.\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 15);

  const paragraphs = rawParagraphs.length > 0 ? rawParagraphs : [cleaned];

  return {
    headline: item.title,
    cleanText: cleaned,
    paragraphs,
    isGalleryOrMetricNoise: false,
    sourceLabel: "WEBPAGE ARTICLE",
  };
}

function getDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr || "Webpage";
  }
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m.toString().padStart(2, "0")}:${s}`;
}

/**
 * Transcript paragraphs. Timestamps come only from the captured transcript
 * segments; when none exist the text is shown without invented times.
 */
export function formatYoutubeTranscript(
  text: string,
  nodes?: MemoryItem["structured_content"],
): string[] {
  const timed = (nodes ?? [])
    .filter((n) => n?.text?.trim() && typeof n.metadata?.start_seconds === "number")
    .sort((a, b) => a.order - b.order);
  if (timed.length > 0) {
    return timed.map((n) => `[${formatTimestamp(n.metadata?.start_seconds as number)}] ${n.text.trim()}`);
  }

  if (/\[\d{1,2}:\d{2}\]/.test(text)) {
    return text.split(/(?=\[\d{1,2}:\d{2}\])/).map((s) => s.trim()).filter(Boolean);
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    chunks.push(sentences.slice(i, i + 3).join(" "));
  }
  return chunks.length > 0 ? chunks : [text];
}

function formatPdfDocument(text: string): string[] {
  const paragraphs = text
    .split(/(?:\r?\n){2,}|\.\s+(?=[A-Z])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 15);

  return paragraphs.length > 0 ? paragraphs : [text];
}
