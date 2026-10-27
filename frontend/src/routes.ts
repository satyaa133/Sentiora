/** Every logged-in app tab; each renders the same shell (DashboardHome). */
export const DASHBOARD_PATHS = [
  "dashboard",
  "intelligence",
  "timeline",
  "search",
  "ask",
  "sources",
  "privacy",
  "settings",
] as const;

export function isDashboardPath(pathname: string): boolean {
  const segment = pathname.replace(/^\/+|\/+$/g, "");
  return (DASHBOARD_PATHS as readonly string[]).includes(segment);
}
