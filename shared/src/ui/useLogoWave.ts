import { useCallback, useEffect, useRef, useState } from "react";

/** First wave after load, then the repeat interval (DESIGN.md §13). */
const FIRST_WAVE_MS = 1200;
const WAVE_INTERVAL_MS = 10_000;
/** Longest animation: last letter (7 × 60ms) or the dot (360ms + 900ms). */
const WAVE_DURATION_MS = 1300;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Drives the wordmark wave: at 1.2s, then every 10s, and on hover. Waves only
 * while the mark is on screen and the tab is visible; never under reduced motion.
 */
export function useLogoWave<T extends Element>(enabled: boolean) {
  const ref = useRef<T | null>(null);
  const [waving, setWaving] = useState(false);
  const visibleRef = useRef(true);
  const endTimer = useRef<number | undefined>(undefined);

  const wave = useCallback(() => {
    if (!enabled || waving || prefersReducedMotion()) return;
    if (!visibleRef.current || document.visibilityState === "hidden") return;
    setWaving(true);
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => setWaving(false), WAVE_DURATION_MS);
  }, [enabled, waving]);

  // Keep the latest wave in a ref so the timers below never restart.
  const waveRef = useRef(wave);
  useEffect(() => {
    waveRef.current = wave;
  }, [wave]);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    let observer: IntersectionObserver | undefined;
    if (node && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? true;
      });
      observer.observe(node);
    }
    let interval: number | undefined;
    const first = window.setTimeout(() => {
      waveRef.current();
      interval = window.setInterval(() => waveRef.current(), WAVE_INTERVAL_MS);
    }, FIRST_WAVE_MS);
    return () => {
      observer?.disconnect();
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.clearTimeout(endTimer.current);
    };
  }, [enabled]);

  return { ref, waving, wave };
}
