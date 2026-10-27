import { isDashboardPath } from "../../routes";

export type EchoMode = "corner";

/** Which Echo a route gets: corner on logged-in app pages, none elsewhere yet. */
export function echoModeFor(pathname: string, isAuthenticated: boolean): EchoMode | null {
  return isAuthenticated && isDashboardPath(pathname) ? "corner" : null;
}
