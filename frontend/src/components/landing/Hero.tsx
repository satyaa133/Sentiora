import { useState } from "react";

import { IconArrowRight, buttonClasses } from "@shared/ui";

import AddToChromeButton from "./AddToChromeButton";
import FloatingCards from "./demo/FloatingCards";
import LiveDemo from "./demo/LiveDemo";
import WordSwap from "./hero/WordSwap";
import "./landing.css";

const TRUST = [
  "Saves automatically while signed in",
  "Skips banking, health and login pages",
  "Export or delete anytime",
];

/** Landing hero (DESIGN.md §9.1). `id="hero"` drives the header's button colour. */
export default function Hero() {
  const [answers, setAnswers] = useState(0);

  return (
    <section id="hero" aria-labelledby="hero-heading" className="pb-16 pt-10 sm:pt-16 lg:pb-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
            A private memory for everything you read
          </p>
          <h1 id="hero-heading" className="mt-6 font-display text-hero text-fg">
            Remember everything you <WordSwap />
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-muted">
            Sentiora saves the articles, PDFs and videos you read, then answers your questions
            from them, with the sources linked.
          </p>
          {/* Roaming Echo may cross the hero buttons but never sits on them. */}
          <div className="mt-8 flex flex-wrap gap-3" data-echo-avoid="">
            <AddToChromeButton size="lg" className="w-full sm:w-auto">
              Add to Chrome
              <IconArrowRight size={18} />
            </AddToChromeButton>
            <a href="#how-it-works" className={buttonClasses("secondary", "lg") + " w-full sm:w-auto"}>
              See how it works
            </a>
          </div>
          <ul className="mt-6 flex flex-col gap-2 text-[15px] text-muted sm:flex-row sm:flex-wrap sm:gap-x-5">
            {TRUST.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div aria-hidden="true" className="hero-dots pointer-events-none absolute -inset-10" />
          <FloatingCards flyKey={answers} />
          <div className="relative">
            <LiveDemo onAnswered={() => setAnswers((count) => count + 1)} />
          </div>
        </div>
      </div>
    </section>
  );
}
