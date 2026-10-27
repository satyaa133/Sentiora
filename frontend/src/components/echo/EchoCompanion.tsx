import CornerEcho from "./CornerEcho";
import type { EchoMode } from "./echoMode";
import "./echo.css";

/**
 * Echo companion (DESIGN.md §8), mounted once at the app root. Corner mode on
 * the logged-in app; never in the extension.
 */
export default function EchoCompanion({ mode }: { mode: EchoMode }) {
  return mode === "corner" ? <CornerEcho /> : null;
}
