import { useId, useState } from "react";
import { IconChevronDown, IconExternalLink, SourceBadge, cx } from "@shared/ui";
import type { StreamSource } from "../../../services/askStream";
import { savedDate, sourceLink, sourceTypeLabel } from "./sourceLinks";
import { sourceNumber, type OpenMemory } from "./types";

interface SourcesPanelProps {
  sources: StreamSource[];
  onOpenMemory?: OpenMemory;
  defaultOpen?: boolean;
}

/** Collapsible list of the memories an answer cites, numbered like its chips. */
export function SourcesPanel({ sources, onOpenMemory, defaultOpen = true }: SourcesPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  if (!sources.length) return null;

  return (
    <section className="rounded-card border border-line bg-surface">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-touch w-full items-center gap-2 rounded-card px-4 py-2 text-left text-[15px] font-semibold text-fg hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Sources used
          <span aria-hidden="true" className="font-mono text-xs font-normal text-muted">
            {sources.length}
          </span>
          <IconChevronDown
            size={16}
            className={cx("ml-auto text-muted transition-transform", open && "rotate-180")}
          />
        </button>
      </h3>
      <ol id={listId} hidden={!open} className="space-y-2 px-3 pb-3">
        {sources.map((source) => (
          <SourceItem key={source.id} source={source} onOpenMemory={onOpenMemory} />
        ))}
      </ol>
    </section>
  );
}

function SourceItem({ source, onOpenMemory }: { source: StreamSource; onOpenMemory?: OpenMemory }) {
  const { href, originalHref, start } = sourceLink(source);
  const meta = [
    sourceTypeLabel(source.source_type),
    source.domain,
    source.page_number ? `p. ${source.page_number}` : null,
    savedDate(source.captured_at),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="rounded-btn bg-bg p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-xs font-semibold text-on-accent">
          {sourceNumber(source.id)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SourceBadge type={source.source_type} />
            <span className="truncate font-mono text-xs text-muted">{meta}</span>
          </div>
          <p className="mt-1 font-semibold leading-snug text-fg">{source.title}</p>
          {source.excerpt ? (
            <p className="mt-1 line-clamp-2 text-[15px] text-muted">{source.excerpt}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-x-4">
            {onOpenMemory ? (
              <button
                type="button"
                onClick={() => {
                  if (!onOpenMemory(source.memory_id) && originalHref)
                    window.open(originalHref, "_blank", "noopener");
                }}
                className="inline-flex min-h-touch items-center text-[15px] font-semibold text-link hover:underline"
              >
                Open memory
              </button>
            ) : null}
            {start && href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-touch items-center gap-1 text-[15px] font-semibold text-link hover:underline"
              >
                Jump to {start.label}
                <span className="sr-only">(opens the video in a new tab)</span>
              </a>
            ) : null}
            {originalHref ? (
              <a
                href={originalHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-touch items-center gap-1 text-[15px] text-muted hover:text-fg hover:underline"
              >
                Original
                <IconExternalLink size={14} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span className="inline-flex min-h-touch items-center text-[15px] text-muted">
                Original unavailable
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
