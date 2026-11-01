import { MemoryRowSkeleton } from "@shared/ui";

/** Loading placeholder for memory lists (Timeline, Search). */
export default function MemoryFeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading memories">
      <ul className="overflow-hidden rounded-card border border-line bg-surface">
        {Array.from({ length: rows }).map((_, idx) => (
          <MemoryRowSkeleton key={idx} />
        ))}
      </ul>
    </div>
  );
}
