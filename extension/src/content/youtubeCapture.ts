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

export function decodeHtmlEntities(text: string): string {
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

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export function parseTimedTextXml(xmlText: string): TranscriptSegment[] | null {
  if (!xmlText.includes("<text")) return null;
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
}

export function parseTimedTextJson3(raw: string): TranscriptSegment[] | null {
  try {
    const parsed = JSON.parse(raw) as {
      events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
    };
    const segments: TranscriptSegment[] = [];
    for (const event of parsed.events ?? []) {
      const text = (event.segs ?? [])
        .map((seg) => seg.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!text) continue;
      const start = (event.tStartMs ?? 0) / 1000;
      const dur = (event.dDurationMs ?? 0) / 1000;
      segments.push({ text, start, end: Math.round((start + dur) * 10) / 10 });
    }
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

export function parseCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  const root = playerResponse as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
      };
    };
  };
  const tracks = root?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return tracks
    .filter((track) => typeof track.baseUrl === "string" && track.baseUrl.length > 0)
    .map((track) => ({
      baseUrl: track.baseUrl as string,
      languageCode: track.languageCode ?? "",
      kind: track.kind,
    }));
}

export function readPlayerResponseFromHtml(html: string): unknown | null {
  const marker = "ytInitialPlayerResponse";
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;
  let start = eq + 1;
  while (html[start] === " ") start += 1;
  if (html[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function groupTranscriptSegments(
  segments: TranscriptSegment[],
  maxChars = 420,
): StructuredNode[] {
  const nodes: StructuredNode[] = [];
  let buffer: string[] = [];
  let order = 0;
  let groupStart = 0;
  let groupEnd = 0;

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    nodes.push({
      id: `node-${order}`,
      type: "paragraph",
      text,
      order,
      parent_id: null,
      metadata: { start_seconds: groupStart, end_seconds: groupEnd },
    });
    order += 1;
    buffer = [];
  };

  for (const segment of segments) {
    if (buffer.length === 0) {
      groupStart = segment.start;
    }
    groupEnd = segment.end;
    buffer.push(segment.text);
    if (buffer.join(" ").length >= maxChars) {
      flush();
    }
  }
  flush();
  return nodes;
}

function pickCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const preferred = ["en", "en-US", "en-GB"];
  const ranked = [...tracks].sort((a, b) => {
    const aPref = preferred.indexOf(a.languageCode);
    const bPref = preferred.indexOf(b.languageCode);
    const aScore = (aPref >= 0 ? aPref : 50) + (a.kind === "asr" ? 10 : 0);
    const bScore = (bPref >= 0 ? bPref : 50) + (b.kind === "asr" ? 10 : 0);
    return aScore - bScore;
  });
  return ranked.slice(0, 6);
}

async function fetchCaptionUrl(url: string): Promise<TranscriptSegment[] | null> {
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal, credentials: "include" });
    window.clearTimeout(timeoutId);
    if (!resp.ok) return null;
    const raw = await resp.text();
    return parseTimedTextJson3(raw) ?? parseTimedTextXml(raw);
  } catch {
    return null;
  }
}

async function fetchTimedText(videoId: string, lang: string): Promise<TranscriptSegment[] | null> {
  const urls = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`,
  ];
  for (const url of urls) {
    const segments = await fetchCaptionUrl(url);
    if (segments) return segments;
  }
  return null;
}

async function fetchTranscriptFromPlayer(videoId: string): Promise<TranscriptSegment[] | null> {
  const playerResponse =
    readPlayerResponseFromHtml(document.documentElement.innerHTML) ??
    (window as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse ??
    null;
  if (!playerResponse) return null;
  const tracks = pickCaptionTracks(parseCaptionTracks(playerResponse));
  for (const track of tracks) {
    const withFmt = track.baseUrl.includes("fmt=") ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
    const segments = (await fetchCaptionUrl(withFmt)) ?? (await fetchCaptionUrl(track.baseUrl));
    if (segments) return segments;
  }
  void videoId;
  return null;
}

async function fetchTranscriptAnyLanguage(videoId: string): Promise<TranscriptSegment[] | null> {
  const fromPlayer = await fetchTranscriptFromPlayer(videoId);
  if (fromPlayer) return fromPlayer;

  for (const lang of ["en", "en-US", "en-GB", "a.en"]) {
    const segments = await fetchTimedText(videoId, lang);
    if (segments) return segments;
  }

  try {
    const listResp = await fetch(`https://www.youtube.com/api/timedtext?type=list&v=${videoId}`);
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

export async function captureYoutube(isForce = false): Promise<YoutubeCapturePayload | null> {
  const started = performance.now();
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get("v");
  if (!videoId) return null;

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

  const authorEl =
    document.querySelector("#owner #channel-name a") ||
    document.querySelector("ytd-channel-name a");
  const rawAuthor = authorEl ? (authorEl as HTMLElement).innerText.trim() : undefined;
  const author = rawAuthor ? rawAuthor.slice(0, 512) : undefined;
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const segments = await fetchTranscriptAnyLanguage(videoId);
  const nodes = segments && segments.length > 0 ? groupTranscriptSegments(segments) : [];
  const status: ExtractionStatus = nodes.length > 0 ? "success" : "insufficient_content";

  if (nodes.length === 0) {
    return null;
  }

  const rawContent = buildPlainTextFromNodes(nodes);
  const content = capExtractedContent(rawContent);
  if (content.split(/\s+/).filter(Boolean).length < 12) {
    return null;
  }

  const durationMs = Math.round(performance.now() - started);
  const { quality_score, quality_reasons } = scoreExtractionQuality(
    nodes,
    "youtube_transcript",
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
      method: "youtube_transcript",
      duration_ms: durationMs,
      status,
      quality_score,
      quality_reasons,
    },
    is_force: isForce,
  };
}
