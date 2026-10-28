/** Landing-page easter egg detectors (DESIGN.md §10). Pure, so they test easily. */

export const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/** Returns a feeder that is true on the key completing `sequence`. */
export function createSequenceMatcher(sequence: string[]) {
  let position = 0;
  return (key: string): boolean => {
    const normalized = key.length === 1 ? key.toLowerCase() : key;
    if (normalized === sequence[position]) {
      position += 1;
    } else {
      position = normalized === sequence[0] ? 1 : 0;
    }
    if (position === sequence.length) {
      position = 0;
      return true;
    }
    return false;
  };
}

/** True when the last typed letters spell `word`. */
export function createWordMatcher(word: string) {
  let typed = "";
  return (key: string): boolean => {
    if (key.length !== 1) return false;
    typed = (typed + key.toLowerCase()).slice(-word.length);
    if (typed === word) {
      typed = "";
      return true;
    }
    return false;
  };
}

/** True on the `count`th click within `windowMs` of the first. */
export function createClickCounter(count: number, windowMs: number) {
  let clicks: number[] = [];
  return (now: number): boolean => {
    clicks = [...clicks.filter((time) => now - time < windowMs), now];
    if (clicks.length >= count) {
      clicks = [];
      return true;
    }
    return false;
  };
}

/** Typing in a field never triggers an egg. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
