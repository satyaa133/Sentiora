import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";
import type {
  YoutubeCapturePayload,
  StructuredNode,
  ExtractionStatus,
  CaptureErrorCode
} from "../shared/types";

export function isYoutubeWatchPage(): boolean {
  const info = parseYoutubeVideoUrl(window.location.href);
  return Boolean(info && !info.isEmbed && !info.isShorts && new URL(window.location.href).pathname === "/watch");
}

export function isYoutubeVideoPage(): boolean {
  return parseYoutubeVideoUrl(window.location.href) !== null;
}

export function isYoutubeHost(): boolean {
  return YOUTUBE_HOSTS.has(window.location.hostname.toLowerCase());
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

function throwError(code: CaptureErrorCode, message: string): never {
  const err = new Error(message) as any;
  err.code = code;
  throw err;
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

export interface YoutubeVideoInfo {
  videoId: string;
  url: string;
  isEmbed: boolean;
  isShorts: boolean;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

export function parseYoutubeVideoUrl(value: string): YoutubeVideoInfo | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(hostname)) return null;

    let videoId: string | null = null;
    let isEmbed = false;
    const isShorts = url.pathname.startsWith("/shorts/");

    if (hostname === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (isShorts || url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/").filter(Boolean)[1] ?? null;
      isEmbed = url.pathname.startsWith("/embed/");
    }

    if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return null;
    return { videoId, url: url.href, isEmbed, isShorts };
  } catch {
    return null;
  }
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

export function pickCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const preferred = ["en", "en-US", "en-GB"];
  const ranked = [...tracks].sort((a, b) => {
    const aPref = preferred.indexOf(a.languageCode);
    const bPref = preferred.indexOf(b.languageCode);
    const aScore = (a.kind === "asr" ? 100 : 0) + (aPref >= 0 ? aPref : 50);
    const bScore = (b.kind === "asr" ? 100 : 0) + (bPref >= 0 ? bPref : 50);
    return aScore - bScore;
  });
  return ranked.slice(0, 6);
}

export async function fetchCaptionUrl(url: string): Promise<TranscriptSegment[] | null> {
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal, credentials: "include" });
    window.clearTimeout(timeoutId);
    const raw = await resp.text();
    console.info("[Sentiora Capture] Caption fetch:", resp.status, "bytes:", raw.length);
    if (!resp.ok || !raw.trim()) return null;
    return parseTimedTextJson3(raw) ?? parseTimedTextXml(raw);
  } catch (err) {
    console.warn("[Sentiora Capture] Caption fetch failed:", err);
    return null;
  }
}

export async function getPlayerResponse(targetVideoId: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_YOUTUBE_PLAYER_RESPONSE", videoId: targetVideoId }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Sentiora Capture] Player response request failed:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(response?.playerResponse ?? null);
    });
  });
}

async function waitForVideoElement(maxWaitMs = 10000): Promise<HTMLVideoElement> {
  const start = performance.now();
  while (performance.now() - start < maxWaitMs) {
    const video = document.querySelector("video");
    if (video instanceof HTMLVideoElement) {
      console.info("[Sentiora Capture] Video element detected:", video.videoWidth, "x", video.videoHeight);
      return video;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throwError("YOUTUBE_PLAYER_UNREADY", "YouTube video player is still loading.");
}

async function fetchTranscriptFromPlayer(videoId: string): Promise<TranscriptSegment[]> {
  await waitForVideoElement();
  const playerResponse = await getPlayerResponse(videoId);
  if (!playerResponse) {
    throwError("YOUTUBE_PLAYER_UNREADY", "YouTube player is not ready or navigated too quickly.");
  }

  const tracks = pickCaptionTracks(parseCaptionTracks(playerResponse));
  console.info("[Sentiora Capture] Caption tracks found:", tracks.length, videoId);
  if (tracks.length === 0) {
    const domSegments = await fetchTranscriptFromDom();
    if (domSegments) return domSegments;
    throwError("YOUTUBE_CAPTIONS_UNAVAILABLE", "No captions available for this video.");
  }

  let fetchedAny = false;
  for (const track of tracks) {
    const withFmt = new URL(track.baseUrl);
    withFmt.searchParams.set("fmt", "json3");
    const segments = await fetchCaptionUrl(withFmt.toString());
    if (segments?.length) {
      console.info("[Sentiora Capture] Direct caption strategy succeeded:", track.languageCode);
      return segments;
    }
  }

  console.info("[Sentiora Capture] Trying InnerTube caption strategy:", videoId);
  try {
    const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId,
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      }),
    });
    const raw = await response.text();
    console.info("[Sentiora Capture] InnerTube response:", response.status, "bytes:", raw.length);
    if (response.ok && raw.trim()) {
      const innerTracks = pickCaptionTracks(parseCaptionTracks(JSON.parse(raw)));
      for (const track of innerTracks) {
        const translated = new URL(track.baseUrl);
        translated.searchParams.set("fmt", "json3");
        const segments = await fetchCaptionUrl(translated.toString());
        if (segments?.length) {
          console.info("[Sentiora Capture] InnerTube caption strategy succeeded:", track.languageCode);
          return segments;
        }
      }
      fetchedAny = innerTracks.length > 0;
    }
  } catch (err) {
    console.warn("[Sentiora Capture] InnerTube caption strategy failed:", err);
  }

  const domSegments = await fetchTranscriptFromDom();
  if (domSegments) return domSegments;
  throwError(
    fetchedAny ? "YOUTUBE_TRANSCRIPT_PARSE_FAILED" : "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
    fetchedAny ? "Failed to parse YouTube transcript data." : "Failed to fetch transcript from YouTube servers.",
  );
}

function parseTranscriptTimestamp(value: string): number {
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export async function fetchTranscriptFromDom(): Promise<TranscriptSegment[] | null> {
  const description = document.querySelector("#description-inline-expander");
  const expandButton = Array.from(description?.querySelectorAll("button, tp-yt-paper-button") ?? [])
    .find((button) => /show more/i.test(button.textContent ?? ""));
  expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const transcriptButton = Array.from(document.querySelectorAll("button, tp-yt-paper-button"))
    .find((button) => /show transcript/i.test(button.textContent ?? "")) as HTMLElement | undefined;
  transcriptButton?.click();
  const closePanel = () => {
    Array.from(document.querySelectorAll("button, tp-yt-paper-button"))
      .find((button) => /hide transcript|close/i.test(button.textContent ?? ""))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  const start = performance.now();
  while (performance.now() - start < 8000) {
    const rows = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
    if (rows.length > 0) {
      const segments = rows.map((row) => {
        const timestamp = row.querySelector(".segment-timestamp")?.textContent?.trim() ?? "0";
        const text = row.querySelector(".segment-text")?.textContent?.trim() ?? "";
        const startSeconds = parseTranscriptTimestamp(timestamp);
        return { text, start: startSeconds, end: startSeconds };
      }).filter((segment) => segment.text);
      if (segments.length > 0) {
        closePanel();
        console.info("[Sentiora Capture] DOM transcript strategy succeeded:", segments.length, "segments");
        return segments;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  closePanel();
  return null;
}

function getYoutubeDescription(): string {
  const descriptionElement =
    document.querySelector("#description-inline-expander") ||
    document.querySelector("ytd-text-inline-expander#description") ||
    document.querySelector("meta[name='description']");
  if (!descriptionElement) return "";
  const description =
    (descriptionElement as HTMLElement).innerText ||
    (descriptionElement as HTMLMetaElement).content ||
    "";
  return description.replace(/\s+/g, " ").trim();
}

function buildDescriptionFallback(videoId: string): TranscriptSegment[] | null {
  const description = getYoutubeDescription();
  if (description.split(/\s+/).filter(Boolean).length < 12) return null;
  console.info("[Sentiora Capture] Using YouTube description fallback:", videoId);
  return [{ text: description, start: 0, end: 0 }];
}

export async function captureYoutube(isForce = false): Promise<YoutubeCapturePayload> {
  const started = performance.now();
  const videoInfo = parseYoutubeVideoUrl(window.location.href);
  console.info("[Sentiora Capture] Active URL:", window.location.href);
  console.info("[Sentiora Capture] YouTube detected:", Boolean(videoInfo));
  if (!videoInfo) {
    throwError("YOUTUBE_PLAYER_UNREADY", "Could not find video ID in the URL.");
  }
  const { videoId } = videoInfo;
  console.info("[Sentiora Capture] Video ID:", videoId);

  let segments: TranscriptSegment[];
  let descriptionOnly = false;
  try {
    segments = await fetchTranscriptFromPlayer(videoId);
  } catch (error) {
    const errorCode = (error as { code?: string }).code;
    console.warn("[Sentiora Capture] Transcript capture failed:", errorCode, error);
    if (errorCode !== "YOUTUBE_CAPTIONS_UNAVAILABLE") throw error;
    const fallback = buildDescriptionFallback(videoId);
    if (!fallback) throw error;
    segments = fallback;
    descriptionOnly = true;
  }
  const nodes = groupTranscriptSegments(segments);
  const status: ExtractionStatus = nodes.length > 0 ? (descriptionOnly ? "partial" : "success") : "insufficient_content";

  if (nodes.length === 0) {
    throwError("YOUTUBE_TRANSCRIPT_PARSE_FAILED", "Transcript fetched but contained no selectable text.");
  }

  const rawContent = buildPlainTextFromNodes(nodes);
  const content = capExtractedContent(rawContent);
  if (content.split(/\s+/).filter(Boolean).length < 12) {
    throwError("YOUTUBE_TRANSCRIPT_PARSE_FAILED", "Transcript is too short to be meaningful.");
  }

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

  const durationMs = Math.round(performance.now() - started);
  const { quality_score, quality_reasons } = scoreExtractionQuality(
    nodes,
    "youtube_transcript",
    status,
  );
  if (descriptionOnly) {
    quality_reasons.push("description_only_capture", "captions_unavailable");
  }

  return {
    source_type: "youtube",
    url: videoInfo.url.slice(0, 2048),
    title,
    content,
    author,
    thumbnail_url: thumbnailUrl,
    captured_at: new Date().toISOString(),
    structured_content: nodes.slice(0, 5000),
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
