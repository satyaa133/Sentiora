import { cx } from "./cx.js";
import { sourceKind } from "./sourceKind.js";
import type { SourceKind } from "./sourceKind.js";

const KIND: Record<SourceKind, { short: string; long: string; className: string }> = {
  web: { short: "WEB", long: "Web", className: "bg-badge-web-bg text-badge-web-fg" },
  pdf: { short: "PDF", long: "PDF", className: "bg-badge-pdf-bg text-badge-pdf-fg" },
  video: {
    short: "VID",
    long: "Video",
    className: "bg-badge-video-bg text-badge-video-fg",
  },
  note: {
    short: "NOTE",
    long: "Note",
    className: "bg-badge-note-bg text-badge-note-fg",
  },
};

export interface SourceBadgeProps {
  /** A SourceKind or a raw API source_type. */
  type: SourceKind | string;
  /** "pill" for inline labels, "tile" for the square in memory rows. */
  variant?: "pill" | "tile";
  className?: string;
}

export function SourceBadge({ type, variant = "pill", className }: SourceBadgeProps) {
  const kind = KIND[sourceKind(type)];
  if (variant === "tile") {
    return (
      <span
        className={cx(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn font-mono text-[11px] font-semibold tracking-[0.04em]",
          kind.className,
          className,
        )}
        title={kind.long}
      >
        <span aria-hidden="true">{kind.short}</span>
        <span className="sr-only">{kind.long}</span>
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center rounded-md px-2 font-mono text-xs font-semibold tracking-[0.04em]",
        kind.className,
        className,
      )}
    >
      <span aria-hidden="true">{kind.short}</span>
      <span className="sr-only">{kind.long}</span>
    </span>
  );
}
