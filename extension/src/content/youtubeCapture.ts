import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";
import type {
  YoutubeCapturePayload,
  StructuredNode,
  ExtractionStatus,
  CaptureErrorCode,
  YoutubePlayerResponse,
} from "../shared/types";

// ──────────────────────────────────────────────
// URL handling
// ──────────────────────────────────────────────

export type YoutubePageKind = "watch" | "shorts" | "live";

export interface YoutubeVideoRef {
  videoId: string;
  kind: YoutubePageKind;
}

const YOUTUBE_PAGE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Video pages the content script can capture (embeds and youtu.be redirects excluded). */
export function parseYoutubeVideoUrl(href: string): YoutubeVideoRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!YOUTUBE_PAGE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  let ref: YoutubeVideoRef | null = null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    if (id) ref = { videoId: id, kind: "watch" };
  } else if (parts.length >= 2 && (parts[0] === "shorts" || parts[0] === "live")) {
    ref = { videoId: parts[1] as string, kind: parts[0] as YoutubePageKind };
  }
  return ref && VIDEO_ID_RE.test(ref.videoId) ? ref : null;
}

export function canonicalYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function isYoutubeHost(hostname = window.location.hostname): boolean {
  return YOUTUBE_PAGE_HOSTS.has(hostname.toLowerCase());
}

export function isYoutubeVideoPage(href = window.location.href): boolean {
  return parseYoutubeVideoUrl(href) !== null;
}

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

export class YoutubeCaptureError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YoutubeCaptureError";
  }
}

function fail(code: CaptureErrorCode, message: string): never {
  throw new YoutubeCaptureError(code, message);
}

// ──────────────────────────────────────────────
// Caption parsing
// ──────────────────────────────────────────────

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

const round1 = (value: number) => Math.round(value * 10) / 10;

export function parseTimedTextXml(xmlText: string): TranscriptSegment[] | null {
  if (!xmlText.includes("<text")) return null;
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const textNodes = xmlDoc.getElementsByTagName("text");
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    if (!node?.textContent) continue;
    const raw = decodeHtmlEntities(node.textContent.replace(/\s+/g, " ").trim());
    if (!raw) continue;
    const start = parseFloat(node.getAttribute("start") ?? "0");
    const dur = parseFloat(node.getAttribute("dur") ?? "0");
    if (!Number.isFinite(start)) continue;
    segments.push({ text: raw, start, end: round1(start + (Number.isFinite(dur) ? dur : 0)) });
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
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      const start = (event.tStartMs ?? 0) / 1000;
      const dur = (event.dDurationMs ?? 0) / 1000;
      segments.push({ text, start, end: round1(start + dur) });
    }
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

export function parseCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  const root = playerResponse as YoutubePlayerResponse | null;
  const tracks = root?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return tracks
    .filter((track) => typeof track?.baseUrl === "string" && track.baseUrl.length > 0)
    .map((track) => ({
      baseUrl: track.baseUrl as string,
      languageCode: track.languageCode ?? "",
      kind: track.kind,
    }));
}

/** Manual English tracks first, then other manual tracks, then auto-generated (asr). */
export function pickCaptionTracks(tracks: CaptionTrack[], limit = 3): CaptionTrack[] {
  const preferred = ["en", "en-US", "en-GB"];
  const score = (track: CaptionTrack) => {
    const pref = preferred.indexOf(track.languageCode);
    return (track.kind === "asr" ? 100 : 0) + (pref >= 0 ? pref : 50);
  };
  return [...tracks].sort((a, b) => score(a) - score(b)).slice(0, limit);
}

/** Group short caption cues into searchable paragraphs that keep their time range. */
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

  const ordered = [...segments].sort((a, b) => a.start - b.start);
  for (const segment of ordered) {
    if (buffer.length === 0) {
      groupStart = segment.start;
    }
    groupEnd = Math.max(segment.end, segment.start);
    buffer.push(segment.text);
    if (buffer.join(" ").length >= maxChars) {
      flush();
    }
  }
  flush();
  return nodes;
}

// ──────────────────────────────────────────────
// Transcript panel (page-provided transcript, read from the DOM)
// ──────────────────────────────────────────────

const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer, transcript-segment-view-model";
const TIMESTAMP_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;

export function parseTimestamp(value: string): number | null {
  const match = TIMESTAMP_RE.exec(value.trim());
  if (!match) return null;
  const [, h, m, s] = match;
  return (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m as string, 10) * 60 + parseInt(s as string, 10);
}

/** Read YouTube's own transcript panel if it is rendered. */
export function readTranscriptPanel(
  root: Document | Element = document,
  durationSeconds?: number,
): TranscriptSegment[] | null {
  const raw: { start: number; text: string }[] = [];
  for (const el of Array.from(root.querySelectorAll(SEGMENT_SELECTOR))) {
    const stampEl = el.querySelector(
      ".segment-timestamp, [class*='Timestamp'], [class*='timestamp']",
    );
    const stampText = (stampEl?.textContent ?? "").trim();
    const start = parseTimestamp(stampText);
    if (start === null) continue;
    const textEl = el.querySelector(".segment-text, [class*='segment-text'], [class*='SegmentText']");
    let text = (textEl?.textContent ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!textEl && stampText && text.startsWith(stampText)) {
      text = text.slice(stampText.length).trim();
    }
    if (text) raw.push({ start, text });
  }
  if (raw.length === 0) return null;
  raw.sort((a, b) => a.start - b.start);
  return raw.map((seg, i) => {
    const next = raw[i + 1]?.start;
    const end = next ?? (durationSeconds && durationSeconds > seg.start ? durationSeconds : seg.start + 5);
    return { text: seg.text, start: seg.start, end };
  });
}

function findTranscriptButton(root: Document | Element): HTMLElement | null {
  return (
    (root.querySelector(
      "ytd-video-description-transcript-section-renderer button",
    ) as HTMLElement | null) ??
    (root.querySelector("button[aria-label*='transcript' i]") as HTMLElement | null)
  );
}

// ──────────────────────────────────────────────
// Player response
// ──────────────────────────────────────────────

/**
 * Fallback for when the main-world bridge is unavailable: parse the inline
 * `ytInitialPlayerResponse` script. Only valid for the initial page load, so
 * the video ID is always verified.
 */
export function extractInlinePlayerResponse(
  doc: Document,
  videoId: string,
): YoutubePlayerResponse | null {
  const marker = "ytInitialPlayerResponse";
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const source = script.textContent ?? "";
    const at = source.indexOf(marker);
    if (at < 0) continue;
    const open = source.indexOf("{", at);
    if (open < 0) continue;
    const json = sliceBalancedObject(source, open);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as YoutubePlayerResponse;
      if (parsed?.videoDetails?.videoId === videoId) return parsed;
    } catch {
      // keep looking
    }
  }
  return null;
}

function sliceBalancedObject(source: string, open: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/** Ask the background worker to read the player response from the page's main world. */
export function requestPlayerResponseFromBackground(
  videoId: string,
): Promise<YoutubePlayerResponse | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "GET_YOUTUBE_PLAYER_RESPONSE", videoId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve((response?.playerResponse as YoutubePlayerResponse | undefined) ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

// ──────────────────────────────────────────────
// Metadata
// ──────────────────────────────────────────────

export interface YoutubeVideoMetadata {
  videoId: string;
  canonicalUrl: string;
  title: string;
  author?: string;
  channelId?: string;
  durationSeconds?: number;
  thumbnailUrl: string;
  isLive: boolean;
}

export function extractVideoMetadata(
  videoId: string,
  playerResponse: YoutubePlayerResponse | null,
  doc: Document = document,
): YoutubeVideoMetadata {
  const details = playerResponse?.videoDetails;
  const domTitle =
    doc.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent ??
    doc.querySelector("meta[property='og:title']")?.getAttribute("content") ??
    doc.querySelector("meta[name='title']")?.getAttribute("content") ??
    doc.title.replace(/\s*-\s*YouTube\s*$/i, "");
  const title = (details?.title || domTitle || "YouTube Video").trim().slice(0, 1024);

  const domAuthor =
    doc.querySelector("#owner #channel-name a")?.textContent ??
    doc.querySelector("ytd-channel-name a")?.textContent ??
    undefined;
  const author = (details?.author || domAuthor || "").trim().slice(0, 512) || undefined;

  const length = Number(details?.lengthSeconds);
  const thumbnails = details?.thumbnail?.thumbnails ?? [];
  const largest = [...thumbnails]
    .filter((t) => typeof t?.url === "string")
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];

  return {
    videoId,
    canonicalUrl: canonicalYoutubeUrl(videoId),
    title,
    author,
    channelId: details?.channelId,
    durationSeconds: Number.isFinite(length) && length > 0 ? length : undefined,
    thumbnailUrl: largest?.url ?? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    isLive: Boolean(details?.isLive),
  };
}

// ──────────────────────────────────────────────
// Capture
// ──────────────────────────────────────────────

export interface YoutubeCaptureDeps {
  href: string;
  doc: Document;
  requestPlayerResponse: (videoId: string) => Promise<YoutubePlayerResponse | null>;
  fetchText: (url: string) => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

async function defaultFetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(url, { signal: controller.signal, credentials: "include" });
    if (!resp.ok) return null;
    const raw = await resp.text();
    return raw.trim() ? raw : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function defaultDeps(): YoutubeCaptureDeps {
  return {
    href: window.location.href,
    doc: document,
    requestPlayerResponse: requestPlayerResponseFromBackground,
    fetchText: defaultFetchText,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
  };
}

async function fetchCaptionTrack(
  track: CaptionTrack,
  fetchText: YoutubeCaptureDeps["fetchText"],
): Promise<TranscriptSegment[] | null> {
  const json3Url = track.baseUrl.includes("fmt=") ? track.baseUrl : `${track.baseUrl}&fmt=json3`;
  const json3 = await fetchText(json3Url);
  const fromJson = json3 ? (parseTimedTextJson3(json3) ?? parseTimedTextXml(json3)) : null;
  if (fromJson) return fromJson;
  if (json3Url === track.baseUrl) return null;
  const xml = await fetchText(track.baseUrl);
  return xml ? (parseTimedTextXml(xml) ?? parseTimedTextJson3(xml)) : null;
}

async function readPanelTranscript(
  deps: YoutubeCaptureDeps,
  allowOpen: boolean,
  durationSeconds?: number,
): Promise<TranscriptSegment[] | null> {
  const existing = readTranscriptPanel(deps.doc, durationSeconds);
  if (existing || !allowOpen) return existing;
  const button = findTranscriptButton(deps.doc);
  if (!button) return null;
  button.click();
  for (let waited = 0; waited < 6000; waited += 250) {
    await deps.sleep(250);
    const segments = readTranscriptPanel(deps.doc, durationSeconds);
    if (segments) return segments;
  }
  return null;
}

const UNAVAILABLE_STATUSES = new Set(["ERROR", "UNPLAYABLE", "LOGIN_REQUIRED", "CONTENT_CHECK_REQUIRED", "AGE_CHECK_REQUIRED"]);

/**
 * Extract a YouTube transcript capture. Throws YoutubeCaptureError when no real
 * transcript is accessible: metadata alone is never returned as a capture.
 *
 * @param isForce manual capture from the popup. Only manual captures may open
 *   YouTube's transcript panel; automatic captures never touch the page UI.
 */
export async function captureYoutube(
  isForce = false,
  overrides: Partial<YoutubeCaptureDeps> = {},
): Promise<YoutubeCapturePayload> {
  const deps = { ...defaultDeps(), ...overrides };
  const started = deps.now();
  const ref = parseYoutubeVideoUrl(deps.href);
  if (!ref) {
    fail("YOUTUBE_PLAYER_UNREADY", "This is not a supported YouTube video page.");
  }

  const playerResponse =
    (await deps.requestPlayerResponse(ref.videoId)) ??
    extractInlinePlayerResponse(deps.doc, ref.videoId);

  const playability = playerResponse?.playabilityStatus?.status;
  if (playability && UNAVAILABLE_STATUSES.has(playability)) {
    fail(
      "YOUTUBE_VIDEO_UNAVAILABLE",
      `This video is not accessible (${playability.toLowerCase().replace(/_/g, " ")}). Nothing was saved.`,
    );
  }

  const metadata = extractVideoMetadata(ref.videoId, playerResponse, deps.doc);
  const tracks = pickCaptionTracks(parseCaptionTracks(playerResponse));

  let segments: TranscriptSegment[] | null = null;
  let source: "captions" | "panel" | null = null;
  for (const track of tracks) {
    segments = await fetchCaptionTrack(track, deps.fetchText);
    if (segments) {
      source = "captions";
      break;
    }
  }
  if (!segments) {
    segments = await readPanelTranscript(deps, isForce, metadata.durationSeconds);
    if (segments) source = "panel";
  }

  if (!segments) {
    if (!playerResponse && tracks.length === 0) {
      fail(
        "YOUTUBE_PLAYER_UNREADY",
        "The YouTube player is still loading. Wait for the video to start, then try again.",
      );
    }
    if (tracks.length === 0) {
      fail(
        "YOUTUBE_CAPTIONS_UNAVAILABLE",
        `"${metadata.title}" has no accessible captions or transcript, so nothing was saved.`,
      );
    }
    fail(
      "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
      isForce
        ? "Captions exist but YouTube did not return the transcript. Open the video's transcript panel and try again."
        : "Captions exist but YouTube did not return the transcript. Use Capture in the Sentiora popup to retry.",
    );
  }

  const nodes = groupTranscriptSegments(segments);
  const content = capExtractedContent(buildPlainTextFromNodes(nodes));
  if (content.split(/\s+/).filter(Boolean).length < 12) {
    fail("YOUTUBE_TRANSCRIPT_PARSE_FAILED", "The transcript is too short to be meaningful. Nothing was saved.");
  }

  const status: ExtractionStatus = "success";
  const { quality_score, quality_reasons } = scoreExtractionQuality(nodes, "youtube_transcript", status);
  if (source === "panel") quality_reasons.push("transcript_from_panel");

  return {
    source_type: "youtube",
    url: metadata.canonicalUrl,
    title: metadata.title,
    content,
    author: metadata.author,
    thumbnail_url: metadata.thumbnailUrl,
    captured_at: new Date().toISOString(),
    structured_content: nodes.slice(0, 5000),
    extraction: {
      method: "youtube_transcript",
      duration_ms: Math.max(0, Math.round(deps.now() - started)),
      status,
      quality_score,
      quality_reasons,
    },
    is_force: isForce,
  };
}
