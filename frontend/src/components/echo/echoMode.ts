import { isDashboardPath, isKnownPath } from "../../routes";

export type EchoMode = "corner" | "roam";

/**
 * Which Echo a route gets (DESIGN.md §8, §10): roaming on the landing page and
 * the 404 page, corner on logged-in app pages, none elsewhere.
 */
export function echoModeFor(pathname: string, isAuthenticated: boolean): EchoMode | null {
  if (isDashboardPath(pathname)) return isAuthenticated ? "corner" : null;
  if (pathname === "/" || !isKnownPath(pathname)) return "roam";
  return null;
}
