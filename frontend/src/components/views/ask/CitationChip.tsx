import { useId, useRef, useState } from "react";
import { SourceBadge } from "@shared/ui";
import type { StreamSource } from "../../../services/askStream";
import { savedDate, sourceLink } from "./sourceLinks";
import { sourceNumber, type OpenMemory } from "./types";

interface CitationChipProps {
  source: StreamSource;
  onOpenMemory?: OpenMemory;
}

const PREVIEW_ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
} as const;

const CHIP =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-[11px] font-semibold leading-none text-on-accent no-underline transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Coral [S#] chip inside an answer. Hover or keyboard focus shows a preview of
 * the cited excerpt; clicking opens the source (a video opens at the cited time).
 */
export function CitationChip({ source, onOpenMemory }: CitationChipProps) {
  const tipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  // Keep the preview on screen: open it toward the side with room.
  const [align, setAlign] = useState<"center" | "start" | "end">("center");
  function placePreview() {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const half = 150;
    setAlign(rect.left < half ? "start" : window.innerWidth - rect.right < half ? "end" : "center");
  }
  const number = sourceNumber(source.id);
  const { href, start } = sourceLink(source);
  const label = `Source ${number}: ${source.title}${start ? `, at ${start.label}` : ""}`;
  const meta = [savedDate(source.captured_at), start ? `at ${start.label}` : null, source.domain]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      ref={anchorRef}
      onPointerEnter={placePreview}
      onFocus={placePreview}
      className="group relative mx-0.5 inline-block align-[2px]"
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label} (opens in a new tab)`}
          aria-describedby={tipId}
          className={CHIP}
        >
          {number}
        </a>
      ) : (
        <button
          type="button"
          aria-label={label}
          aria-describedby={tipId}
          onClick={() => onOpenMemory?.(source.memory_id)}
          className={CHIP}
        >
          {number}
        </button>
      )}
      <span
        role="tooltip"
        id={tipId}
        className={`pointer-events-none invisible absolute bottom-full z-30 mb-2 w-72 max-w-[80vw] ${PREVIEW_ALIGN[align]} rounded-card border border-line bg-surface p-3 text-left text-[14px] font-normal leading-snug text-fg opacity-0 shadow-pop transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 motion-reduce:transition-none`}
      >
        <span className="flex items-center gap-2">
          <SourceBadge type={source.source_type} />
          {meta ? <span className="truncate font-mono text-xs text-muted">{meta}</span> : null}
        </span>
        <span className="mt-1.5 block font-semibold">{source.title}</span>
        {source.excerpt ? (
          <span className="mt-1 line-clamp-4 block text-muted">“{source.excerpt}”</span>
        ) : null}
      </span>
    </span>
  );
}
