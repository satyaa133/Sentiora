import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import { echoModeFor } from "./echoMode";

const EchoCompanion = lazy(() => import("./EchoCompanion"));

/**
 * Load Echo after first paint, at an idle moment (DESIGN.md §11). Effects run
 * after the first commit; the idle callback (or a short timer) waits for the
 * main thread to settle. No rAF: throttled frames would hold Echo back forever.
 */
function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const done = () => setReady(true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(done, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(done, 300);
    return () => window.clearTimeout(id);
  }, []);
  return ready;
}

export default function EchoMount() {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuth();
  const ready = useAfterFirstPaint();
  const mode = echoModeFor(pathname, isAuthenticated);
  if (!ready || !mode) return null;
  return (
    <Suspense fallback={null}>
      {/* Keyed by mode so switching between landing and app starts fresh. */}
      <EchoCompanion key={mode} mode={mode} landing={pathname === "/"} />
    </Suspense>
  );
}
