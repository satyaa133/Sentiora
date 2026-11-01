import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Echo, IconSearch, LogoMark, cx } from "@shared/ui";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface Step {
  number: string;
  title: string;
  body: string;
  visual: ReactNode;
}

function SaveVisual() {
  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="flex items-center gap-2 rounded-btn border border-line bg-surface px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
          blog.example.dev/understanding-docker
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-2 ring-accent">
          <LogoMark size={18} />
        </span>
      </div>
      <div className="ml-auto w-56 rounded-card border border-line bg-surface p-3 shadow-pop">
        <p className="truncate text-sm font-semibold text-fg">Understanding Docker…</p>
        <span className="mt-2 flex h-9 items-center justify-center rounded-btn bg-accent text-sm font-semibold text-on-accent">
          Save to memory
        </span>
      </div>
    </div>
  );
}

function SearchVisual() {
  return (
    <div className="w-full max-w-md space-y-2.5">
      <div className="flex items-center gap-2.5 rounded-btn border border-line bg-surface px-3.5 py-3 text-[15px] text-fg">
        <IconSearch size={18} className="shrink-0 text-muted" />
        <span className="truncate">that thing about isolating processes</span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-btn border-2 border-accent bg-surface px-3.5 py-3">
        <span className="truncate text-[15px] font-semibold text-fg">
          Understanding Docker containers
        </span>
        <span className="shrink-0 font-mono text-xs text-muted">Web</span>
      </div>
    </div>
  );
}

function AskVisual() {
  return (
    <div className="w-full max-w-md space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-card bg-inverse px-4 py-2.5 text-[15px] text-on-inverse">
        How do containers differ from VMs?
      </p>
      <div className="flex items-start gap-2.5">
        <Echo state="happy" size={32} still className="mt-1 shrink-0" />
        <p className="rounded-card border border-line bg-surface px-4 py-2.5 text-[15px] text-fg">
          They share the host kernel instead of booting their own{" "}
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent-soft px-1 font-mono text-xs font-semibold text-accent-soft-fg">
            1
          </span>
        </p>
      </div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    number: "01",
    title: "Save with one click",
    body: "Pages save as you read. To keep one right away, click the Sentiora icon. Sentiora strips out ads and menus and keeps the text.",
    visual: <SaveVisual />,
  },
  {
    number: "02",
    title: "Search by meaning",
    body: "Type the idea, not the title. Search finds the page even if you forgot every word in it.",
    visual: <SearchVisual />,
  },
  {
    number: "03",
    title: "Ask, with sources",
    body: "Ask a question and get an answer built only from what you saved, each claim linked back.",
    visual: <AskVisual />,
  },
];

function StepText({ step }: { step: Step }) {
  return (
    <>
      <p className="font-mono text-sm text-link">{step.number}</p>
      <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-fg sm:text-[28px]">
        {step.title}
      </h3>
      <p className="mt-2 max-w-md text-[17px] leading-relaxed text-muted">
        {step.body}
      </p>
    </>
  );
}

/** Stacked cards: phones, tablets, and anyone who prefers reduced motion. */
function StackedSteps() {
  return (
    <ol className="space-y-4">
      {STEPS.map((step) => (
        <li
          key={step.number}
          className="rounded-panel border border-line bg-surface p-5 sm:p-8"
        >
          <StepText step={step} />
          <div className="mt-6 flex justify-center rounded-card bg-raised px-4 py-8">
            {step.visual}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Desktop: the visual stays pinned while the step texts scroll past it. */
function StickySteps() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = refs.current.indexOf(entry.target as HTMLLIElement);
            if (index >= 0) setActive(index);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-2 gap-16 [&>*]:min-w-0">
      <ol>
        {STEPS.map((step, index) => (
          <li
            key={step.number}
            ref={(el) => {
              refs.current[index] = el;
            }}
            aria-current={active === index ? "step" : undefined}
            className={cx(
              "flex min-h-[70vh] flex-col justify-center transition-opacity duration-200",
              active === index ? "opacity-100" : "opacity-40",
            )}
          >
            <StepText step={step} />
          </li>
        ))}
      </ol>
      <div className="relative">
        <div
          aria-hidden="true"
          className="sticky top-24 flex h-[calc(100vh-8rem)] max-h-[560px] items-center"
        >
          <div className="relative flex h-[420px] w-full items-center justify-center rounded-panel border border-line bg-surface p-8">
            {STEPS.map((step, index) => (
              <div
                key={step.number}
                className={cx(
                  "absolute inset-8 flex items-center justify-center transition-all duration-200",
                  active === index
                    ? "translate-y-0 opacity-100"
                    : "translate-y-2 opacity-0",
                )}
              >
                {step.visual}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="scroll-mt-16 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <h2 id="how-heading" className="max-w-xl font-display text-section text-fg">
            Save it once. Find it by what it meant.
          </h2>
          <p className="max-w-sm text-[17px] leading-relaxed text-muted">
            No folders to maintain. Sentiora reads what you save so you can search the
            way you remember.
          </p>
        </div>
        <div className="mt-12">
          {reducedMotion ? (
            <StackedSteps />
          ) : (
            <>
              <div className="hidden lg:block">
                <StickySteps />
              </div>
              <div className="lg:hidden">
                <StackedSteps />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
