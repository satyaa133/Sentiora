import { sourceKind } from "@shared/ui";
import type { AskCitation } from "../../../services/askService";
import { sourceHref } from "../../../utils/safeHref";
import { citationStart, videoJumpUrl, type VideoStart } from "../../../utils/videoJump";

export interface SourceLink {
  /** Where clicking the source goes: the video at its timestamp, else the original. */
  href?: string;
  /** The original page, when it can be opened. */
  originalHref?: string;
  start: VideoStart | null;
}

export function sourceLink(citation: AskCitation): SourceLink {
  const originalHref =
    citation.source_available === false ? undefined : sourceHref(citation.url);
  const start = sourceKind(citation.source_type) === "video" ? citationStart(citation) : null;
  const jump = originalHref && start ? videoJumpUrl(originalHref, start.seconds) : null;
  return { href: jump ?? originalHref, originalHref, start };
}

export function sourceTypeLabel(sourceType: string): string {
  const kind = sourceKind(sourceType);
  return kind === "video" ? "Video" : kind === "pdf" ? "PDF" : kind === "note" ? "Note" : "Web page";
}

export function savedDate(capturedAt?: string | null): string | null {
  return capturedAt
    ? new Date(capturedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
}
