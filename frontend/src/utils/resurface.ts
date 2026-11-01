import type { MemoryItem } from "../types/memory";
import { daysSince } from "./dates";

/** Memories at least this old can be resurfaced on Home. */
export const RESURFACE_MIN_DAYS = 14;

/**
 * Pick one older memory to resurface, client-side from the already loaded feed.
 * The pick is stable for a given day (so it doesn't jump on every refresh) and
 * skips anything the user dismissed. Returns null when nothing qualifies.
 */
export function pickResurfaced(
  items: MemoryItem[],
  dismissedIds: ReadonlySet<string>,
  now: Date = new Date(),
): MemoryItem | null {
  const candidates = items
    .filter((item) => item.status === "ready")
    .filter((item) => !dismissedIds.has(item.id))
    .filter(
      (item) =>
        daysSince(item.captured_at || item.created_at, now) >= RESURFACE_MIN_DAYS,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  return candidates[dayIndex % candidates.length] ?? null;
}
