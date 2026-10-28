const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", or a short date like "Oct 21" (with year when not this year). */
export function dayLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Whole days between a timestamp and now (never negative). */
export function daysSince(iso: string, now: Date = new Date()): number {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

/** "saved 3 weeks ago", "saved 2 months ago". */
export function savedAgo(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  if (days < 14) return `saved ${days} days ago`;
  if (days < 60) return `saved ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `saved ${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return `saved ${years} ${years === 1 ? "year" : "years"} ago`;
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
