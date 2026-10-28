import { useEffect, useRef } from "react";

import { emitEcho } from "../components/echo/echoEvents";
import type { MemoryItem } from "../types/memory";

function createdTime(item: MemoryItem): number {
  const time = Date.parse(item.created_at);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Tells Echo about real feed changes. "saved" fires only for memories created
 * after the first successful load; an older item that slides into the newest-100
 * window after a delete is not new and stays silent.
 */
export function useEchoFeedEvents(items: MemoryItem[], ready: boolean, feedKey: string) {
  const known = useRef<{ ids: Set<string>; newest: number } | null>(null);
  const lastFeedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const previous = known.current;
    if (previous) {
      const added = items.filter(
        (item) => !previous.ids.has(item.id) && createdTime(item) >= previous.newest,
      );
      const first = added[0];
      if (first) emitEcho({ type: "saved", title: first.title, count: added.length });
    }
    known.current = {
      ids: new Set(items.map((item) => item.id)),
      newest: Math.max(previous?.newest ?? 0, ...items.map(createdTime)),
    };
  }, [items, ready]);

  useEffect(() => {
    if (!ready) return;
    if (lastFeedKey.current !== null && lastFeedKey.current !== feedKey) {
      emitEcho({ type: "feed-changed" });
    }
    lastFeedKey.current = feedKey;
  }, [feedKey, ready]);
}
