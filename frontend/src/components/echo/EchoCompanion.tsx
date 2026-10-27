import CornerEcho from "./CornerEcho";
import type { EchoMode } from "./echoMode";
import RoamingEcho from "./roam/RoamingEcho";
import "./echo.css";

/**
 * Echo companion (DESIGN.md §8), mounted once at the app root: roaming on the
 * landing and 404 pages, corner mode on the logged-in app; never in the extension.
 */
export default function EchoCompanion({ mode, landing }: { mode: EchoMode; landing: boolean }) {
  if (mode === "corner") return <CornerEcho />;
  return <RoamingEcho easterEggs={landing} />;
}
