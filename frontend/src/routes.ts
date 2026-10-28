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

/** Public pages with their own route; anything else that isn't an app tab is a 404. */
const PUBLIC_PATHS = ["", "login", "signup", "forgot-password", "onboarding", "dev/components"];

export function isKnownPath(pathname: string): boolean {
  const segment = pathname.replace(/^\/+|\/+$/g, "");
  return PUBLIC_PATHS.includes(segment) || isDashboardPath(pathname);
}
