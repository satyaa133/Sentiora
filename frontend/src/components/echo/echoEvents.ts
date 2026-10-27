/**
 * Real app events Echo reacts to (DESIGN.md §8.2). Views emit; the lazily loaded
 * companion listens. Events emitted before it loads are simply missed, and
 * nothing here may be emitted for things that did not happen.
 */
export type EchoAnswerStatus = "ready" | "not_found" | "error";

export type EchoEvent =
  /** New memories appeared in the feed after the first load (capture or upload). */
  | { type: "saved"; title: string; count: number }
  /** The memory feed changed (added, removed, status); refreshes the counter. */
  | { type: "feed-changed" }
  | { type: "searching" }
  | { type: "found"; count: number }
  | { type: "ask" }
  | { type: "answer"; status: EchoAnswerStatus; cited: boolean }
  | { type: "resurfaced"; action: "revisit" | "dismiss" }
  | { type: "navigate"; tab: string }
  /** Landing page: roaming Echo ate a memory scrap; total for the nav chip. */
  | { type: "landing-saved"; total: number };

type Listener = (event: EchoEvent) => void;

const listeners = new Set<Listener>();

export function emitEcho(event: EchoEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must never break the view that emitted.
    }
  }
}

/** Subscribe; returns the unsubscribe function. */
export function onEcho(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
