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
