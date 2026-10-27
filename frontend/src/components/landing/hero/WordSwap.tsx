import { useEffect, useRef, useState } from "react";

import { useInView } from "../../../hooks/useInView";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";

const WORDS = ["read", "watch", "study", "skim", "bookmark"];
const SWAP_MS = 2_600;

/**
 * The hero's last word (DESIGN.md §9.1): read → watch → study → skim →
 * bookmark, each with a coral underline that draws in. Screen readers always
 * get "read."; reduced motion keeps "read" still.
 */
export default function WordSwap() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced || !inView) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % WORDS.length), SWAP_MS);
    return () => window.clearInterval(timer);
  }, [reduced, inView]);

  const word = reduced ? WORDS[0] : WORDS[index];
  return (
    <span ref={ref}>
      <span className="sr-only">read.</span>
      <span aria-hidden="true" className="hero-swap" data-word={word}>
        <span key={word} className="hero-swap-word">
          {word}
          <span className="hero-underline" />
        </span>
        .
      </span>
    </span>
  );
}
