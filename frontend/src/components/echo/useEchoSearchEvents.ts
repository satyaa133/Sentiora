import { useEffect, useRef } from "react";

import { emitEcho } from "./echoEvents";

const RESULTS_AFTER_MS = 700;

/** Typing a search makes Echo search; once typing settles it reports the real count. */
export function useEchoSearchEvents(query: string, resultCount: number) {
  const count = useRef(resultCount);
  useEffect(() => {
    count.current = resultCount;
  }, [resultCount]);

  useEffect(() => {
    if (!query.trim()) return;
    emitEcho({ type: "searching" });
    const timer = window.setTimeout(
      () => emitEcho({ type: "found", count: count.current }),
      RESULTS_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query]);
}
