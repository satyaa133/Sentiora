import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.js";
import { SourceBadge } from "./SourceBadge.js";

export interface MemoryRowProps {
  title: string;
  /** API source_type or badge kind. */
  sourceType: string;
  snippet?: string | null;
  /** Pre-formatted date label ("Today", "Oct 21"). */
  dateLabel?: string;
  /** Machine-readable date for <time dateTime>. */
  dateTime?: string;
  onSelect?: () => void;
  /** Extra controls on the right (rendered outside the main button). */
  actions?: ReactNode;
  className?: string;
}

/**
 * One saved memory in a list: source tile, title, snippet, date.
 * Renders an <li>; place inside <MemoryList>.
 */
export function MemoryRow({
  title,
  sourceType,
  snippet,
  dateLabel,
  dateTime,
  onSelect,
  actions,
  className,
}: MemoryRowProps) {
  const body = (
    <>
      <SourceBadge type={sourceType} variant="tile" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-snug text-fg sm:text-[17px]">
          {title}
        </span>
        {snippet ? (
          <span className="mt-0.5 line-clamp-2 block text-[15px] leading-normal text-muted">
            {snippet}
          </span>
        ) : null}
      </span>
      {dateLabel ? (
        <time
          dateTime={dateTime}
          className="hidden shrink-0 self-center font-mono text-[13px] text-muted sm:block"
        >
          {dateLabel}
        </time>
      ) : null}
    </>
  );

  return (
    <li className={cx("flex items-stretch", className)}>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-raised focus-visible:-outline-offset-2 sm:px-5"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-4 px-4 py-4 sm:px-5">
          {body}
        </div>
      )}
      {actions ? (
        <div className="flex shrink-0 items-center pr-3">{actions}</div>
      ) : null}
    </li>
  );
}

/** Bordered list container for MemoryRow items. */
export function MemoryList({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cx(
        "divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-surface",
        className,
      )}
      {...rest}
    />
  );
}
