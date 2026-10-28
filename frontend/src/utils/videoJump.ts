/**
 * Video citations carry their transcript range in the chunk heading, written by
 * the backend chunker as "[02:15–04:30]" (older captures: "Title [02:15–04:30]";
 * "[1:02:15–…]" past an hour).
 * These helpers turn that into a "Jump to 02:15" link (DESIGN.md §5.5).
 */
const RANGE = /\[(\d{1,2}(?::\d{2}){1,2})\s*[–-]/;

export interface VideoStart {
  seconds: number;
  /** As written in the heading, e.g. "02:15". */
  label: string;
}

/** Format seconds the way the backend writes headings: "02:15" or "1:02:15". */
export function formatTimestamp(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** The video start of a citation: its `start_sec` when present, else parsed from the heading. */
export function citationStart(citation: {
  start_sec?: number | null;
  heading?: string | null;
}): VideoStart | null {
  if (typeof citation.start_sec === "number" && Number.isFinite(citation.start_sec)) {
    const seconds = Math.max(0, Math.floor(citation.start_sec));
    return { seconds, label: formatTimestamp(seconds) };
  }
  return videoStart(citation.heading);
}

export function videoStart(heading: string | null | undefined): VideoStart | null {
  const match = heading ? RANGE.exec(heading) : null;
  if (!match?.[1]) return null;
  const parts = match[1].split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return { seconds, label: match[1] };
}

/** The video URL opened at `seconds`, for YouTube links only; null otherwise. */
export function videoJumpUrl(url: string, seconds: number): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") return null;
    parsed.searchParams.set("t", `${seconds}s`);
    return parsed.toString();
  } catch {
    return null;
  }
}
