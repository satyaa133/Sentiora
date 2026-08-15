import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";
import type {
  YoutubeCapturePayload,
  StructuredNode,
  ExtractionStatus,
} from "../shared/types";

export function isYoutubeWatchPage(): boolean {
  return (
    window.location.hostname.includes("youtube.com") &&
    window.location.pathname === "/watch" &&
    new URLSearchParams(window.location.search).has("v")
  );
}

/** Decode HTML entities in YouTube XML transcript text. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

/**
 * Fetch YouTube timedtext XML for the given video ID and language code.
 * Returns parsed segments with timing, or null on failure.
 */
async function fetchTimedText(
  videoId: string,
  lang: string,
): Promise<TranscriptSegment[] | null> {
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(
      `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}`,
      { signal: controller.signal },
    );
    window.clearTimeout(timeoutId);

    if (!resp.ok) return null;

    const xmlText = await resp.text();
    if (!xmlText.includes("<text")) return null; // empty or error XML

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const textNodes = xmlDoc.getElementsByTagName("text");

    const segments: TranscriptSegment[] = [];
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      if (!node?.textContent) continue;

      const raw = decodeHtmlEntities(node.textContent.trim());
      if (!raw) continue;

      const start = parseFloat(node.getAttribute("start") ?? "0");
      const dur = parseFloat(node.getAttribute("dur") ?? "0");

      segments.push({ text: raw, start, end: Math.round((start + dur) * 10) / 10 });
    }

    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

/**
 * Try multiple language codes in priority order.
 * Attempts: en, en-US, en-GB, auto-generated (a.en), then falls back to
 * any track listed in the timedtext list endpoint.
 */
async function fetchTranscriptAnyLanguage(
  videoId: string,
): Promise<TranscriptSegment[] | null> {
  const langCandidates = ["en", "en-US", "en-GB", "a.en"];

  for (const lang of langCandidates) {
    const segments = await fetchTimedText(videoId, lang);
    if (segments) return segments;
  }

  // Last resort: query the list endpoint for available tracks
  try {
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), 2000);

    const listResp = await fetch(
      `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`,
    );
    if (listResp.ok) {
      const listXml = await listResp.text();
      const langMatch = /lang_code="([^"]+)"/.exec(listXml);
      if (langMatch?.[1]) {
        const segments = await fetchTimedText(videoId, langMatch[1]);
        if (segments) return segments;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/** Convert transcript segments → StructuredNode[] with timing metadata. */
function buildTranscriptNodes(segments: TranscriptSegment[]): StructuredNode[] {
  return segments.map((seg, i) => ({
    id: `node-${i}`,
    type: "paragraph" as const,
    text: seg.text,
    order: i,
    parent_id: null,
    metadata: {
      start_seconds: seg.start,
      end_seconds: seg.end,
    },
  }));
}

/** Extract meaningful description from YouTube page DOM. */
function extractDescription(): string {
  const descEl =
    document.querySelector("#description-inline-expander") ||
    document.querySelector("#description") ||
    document.querySelector("meta[name='description']");

  if (!descEl) return "";

  const text =
    (descEl as HTMLElement).innerText ??
    (descEl as HTMLMetaElement).content ??
    "";
  return text.trim();
}

export async function captureYoutube(isForce = false): Promise<YoutubeCapturePayload | null> {
  const started = performance.now();
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get("v");
  if (!videoId) return null;

  // ── Title ─────────────────────────────────────
  const titleEl =
    document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
    document.querySelector("h1.title ytd-formatted-string") ||
    document.querySelector("meta[name='title']");

  const rawTitle = titleEl
    ? (titleEl as HTMLElement).innerText ||
      (titleEl as HTMLMetaElement).content ||
      "YouTube Video"
    : document.title;
  const title = rawTitle.trim().slice(0, 1024);

  // ── Author / channel ────────────────────────────
  const authorEl =
    document.querySelector("#owner #channel-name a") ||
    document.querySelector("ytd-channel-name a");
  const rawAuthor = authorEl ? (authorEl as HTMLElement).innerText.trim() : undefined;
  const author = rawAuthor ? rawAuthor.slice(0, 512) : undefined;

  // ── Thumbnail ────────────────────────────────────
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  // ── Transcript (primary) ─────────────────────────
  let nodes: StructuredNode[] = [];
  let status: ExtractionStatus = "insufficient_content";
  let extractionAttempted = "youtube_transcript" as const;

  const segments = await fetchTranscriptAnyLanguage(videoId);

  if (segments && segments.length > 0) {
    nodes = buildTranscriptNodes(segments);
    status = "success";
  } else {
    // ── Description fallback ───────────────────────
    const description = extractDescription();
    if (description && description.length >= 50) {
      nodes = description
        .split(/\n+/)
        .filter((line) => line.trim().length >= 10)
        .map((line, i) => ({
          id: `node-${i}`,
          type: "paragraph" as const,
          text: line.trim(),
          order: i,
          parent_id: null,
        }));
      status = nodes.length > 0 ? "partial" : "insufficient_content";
    }
  }

  // ── No meaningful content → do NOT fabricate ─────
  if (nodes.length === 0 || status === "insufficient_content") {
    return null;
  }

  const rawContent = buildPlainTextFromNodes(nodes);
  const content = capExtractedContent(rawContent);
  const durationMs = Math.round(performance.now() - started);

  const { quality_score, quality_reasons } = scoreExtractionQuality(
    nodes,
    extractionAttempted,
    status,
  );

  return {
    source_type: "youtube",
    url: window.location.href.slice(0, 2048),
    title,
    content,
    author,
    thumbnail_url: thumbnailUrl,
    captured_at: new Date().toISOString(),
    structured_content: nodes,
    extraction: {
      method: extractionAttempted,
      duration_ms: durationMs,
      status,
      quality_score,
      quality_reasons,
    },
    is_force: isForce,
  };
}
