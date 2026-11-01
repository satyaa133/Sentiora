import { useEffect, useRef, useState, type CSSProperties } from "react";

import { SourceBadge, cx } from "@shared/ui";

import { useInView } from "../../../hooks/useInView";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";

// Compact pills that peek over the demo's edges, in front of it, slightly tilted,
// placed over its quiet spots: the top edge, beside the tabs, the bottom corner.
const CARDS = [
  { kind: "video", title: "Intro to WebSockets", meta: "youtube.com · 18 min", className: "-top-9 right-24 rotate-[4deg]", depth: 10 },
  { kind: "pdf", title: "Attention is all you need", meta: "arxiv.org · 15 pages", className: "top-[58px] -right-14 -rotate-[3deg]", depth: 16 },
  { kind: "web", title: "Understanding Docker containers", meta: "blog.example.dev · 9 min", className: "-bottom-5 -left-9 -rotate-[5deg]", depth: 7 },
] as const;

const FLY_MS = 900;
const RETURN_AFTER_MS = 1_600;

/**
 * Three "saved item" cards around the live demo (DESIGN.md §9.1), with slight
 * mouse parallax. After each answer one flies into the sample library. Shown
 * only beside the two-column hero (lg, so never under 860px), never under
 * reduced motion; decorative.
 */
export default function FloatingCards({ flyKey }: { flyKey: number }) {
  const reduced = usePrefersReducedMotion();
  const layerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const inView = useInView(layerRef);
  const [flying, setFlying] = useState<{ index: number; x: number; y: number } | null>(null);
  const [returning, setReturning] = useState<number | null>(null);

  // Parallax: a few pixels toward the cursor; deeper cards move more.
  useEffect(() => {
    if (reduced || !inView) return;
    const onMove = (event: PointerEvent) => {
      const mx = event.clientX / window.innerWidth - 0.5;
      const my = event.clientY / window.innerHeight - 0.5;
      cardRefs.current.forEach((card, index) => {
        const depth = CARDS[index]?.depth ?? 0;
        if (card) card.style.transform = `translate(${mx * depth * 2}px, ${my * depth * 2}px)`;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced, inView]);

  // After an answer, the next card flies into the library list, then comes back.
  useEffect(() => {
    if (flyKey === 0 || reduced) return;
    const index = (flyKey - 1) % CARDS.length;
    const card = cardRefs.current[index];
    const library = document.querySelector("[data-demo-library]");
    if (!card || !library) return;
    const from = card.getBoundingClientRect();
    const to = library.getBoundingClientRect();
    setReturning(null);
    setFlying({
      index,
      x: to.left + to.width / 2 - (from.left + from.width / 2),
      y: to.top + to.height / 2 - (from.top + from.height / 2),
    });
    const back = window.setTimeout(() => {
      setFlying(null);
      setReturning(index);
    }, FLY_MS + RETURN_AFTER_MS);
    return () => window.clearTimeout(back);
  }, [flyKey, reduced]);

  if (reduced) return null;

  return (
    <div ref={layerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 hidden lg:block">
      {CARDS.map((card, index) => (
        <div key={card.title} className={cx("absolute", card.className)}>
          <div
            ref={(el) => {
              cardRefs.current[index] = el;
            }}
            className="demo-float"
          >
            <div
              key={returning === index ? "back" : "here"}
              className={cx(
                "flex items-center gap-2.5 whitespace-nowrap rounded-btn border border-line bg-surface py-2 pl-2 pr-3.5 shadow-pop",
                flying?.index === index && "demo-float-fly",
                returning === index && "demo-float-return",
              )}
              style={
                flying?.index === index
                  ? ({ "--fly-x": `${flying.x}px`, "--fly-y": `${flying.y}px` } as CSSProperties)
                  : undefined
              }
            >
              <SourceBadge type={card.kind} variant="tile" className="h-9 w-9" />
              <span>
                <span className="block text-[15px] font-semibold leading-tight text-fg">{card.title}</span>
                <span className="block font-mono text-xs text-muted">{card.meta}</span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
