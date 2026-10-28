export type TabSourceType = "webpage" | "youtube" | "pdf";

/** Card label for the kind of page in the active tab. */
export function sourceLabel(type: string): string {
  switch (type) {
    case "youtube":
      return "Video";
    case "pdf":
      return "PDF";
    default:
      return "Article";
  }
}

/** Compact age for list rows: "now", "5m", "2h", "3d", then a short date. */
export function shortAge(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
