import { cx } from "./cx.js";

export interface SkeletonProps {
  className?: string;
  /** Rounded pill instead of a soft rectangle. */
  round?: boolean;
}

/** Loading placeholder. Decorative: announce loading with text elsewhere (e.g. aria-busy). */
export function Skeleton({ className, round = false }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "block animate-pulse bg-raised",
        round ? "rounded-full" : "rounded-md",
        className,
      )}
    />
  );
}

/** Placeholder matching MemoryRow's layout. */
export function MemoryRowSkeleton() {
  return (
    <li className="flex items-start gap-4 px-4 py-4 sm:px-5" aria-hidden="true">
      <Skeleton className="h-11 w-11 rounded-btn" />
      <span className="flex-1 space-y-2 pt-1">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </span>
    </li>
  );
}
