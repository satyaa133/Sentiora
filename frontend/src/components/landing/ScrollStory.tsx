import { useEffect, useRef, useState, type ReactNode } from "react";

import { Echo, IconSearch, LogoMark, SourceBadge, Tag, cx } from "@shared/ui";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { emitEcho } from "../echo/echoEvents";

const WIDE = "(min-width: 860px)";

interface Beat {
  title: string;
  body: string;
  scene: ReactNode;
}

function ReadScene() {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-card border border-line bg-surface shadow-pop">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate rounded-full bg-raised px-3 py-1 font-mono text-xs text-muted">
          blog.example.dev/docker-containers
        </span>
        <span className="story-pulse flex h-7 w-7 items-center justify-center rounded-md bg-inverse">
          <LogoMark size={16} tone="inverse" />
        </span>
      </div>
      <div className="space-y-2.5 p-5">
        <p className="font-display text-[22px] font-bold leading-tight text-fg">Understanding Docker containers</p>
        <span className="block h-2.5 w-full rounded-full bg-raised" />
        <span className="block h-2.5 w-11/12 rounded-full bg-raised" />
        <span className="block h-2.5 w-4/5 rounded-full bg-raised" />
        <span className="block h-2.5 w-2/3 rounded-full bg-raised" />
      </div>
    </div>
  );
}

function MemoryScene() {
  return (
    <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-pop">
      <div className="flex items-center gap-2">
        <SourceBadge type="web" />
        <span className="text-[17px] font-semibold text-fg">Understanding Docker containers</span>
      </div>
      <p className="mt-1 font-mono text-xs text-muted">blog.example.dev · 9 min · saved just now</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Tag>docker</Tag>
        <Tag>linux</Tag>
        <Tag>devops</Tag>
      </div>
      <blockquote className="mt-4 border-l-2 border-accent pl-3 text-[16px] leading-relaxed text-fg">
        &ldquo;Containers isolate processes using kernel namespaces and cgroups rather than full
        virtualization&hellip;&rdquo;
      </blockquote>
    </div>
  );
}

function SearchScene() {
  const results = [
    { type: "web", title: "Understanding Docker containers" },
    { type: "video", title: "Production Dockerfiles, a talk" },
    { type: "pdf", title: "OS notes: processes and threads" },
  ];
  return (
    <div className="w-full max-w-md space-y-3">
      <div className="flex items-center gap-2 rounded-btn border border-accent bg-surface px-3 py-3 text-[16px] text-fg shadow-pop">
        <IconSearch size={18} className="shrink-0 text-link" />
        that thing about isolating processes
      </div>
      <ul className="space-y-2">
        {results.map((result, i) => (
          <li
            key={result.title}
            className={cx(
              "flex items-center gap-3 rounded-btn border border-line bg-surface px-3 py-2.5",
              i === 0 && "border-accent",
            )}
          >
            <SourceBadge type={result.type} />
            <span className="truncate text-[15px] text-fg">{result.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AskScene() {
  return (
    <div className="w-full max-w-md space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-card bg-inverse px-4 py-2.5 text-[16px] text-on-inverse">
        How do containers differ from VMs?
      </p>
      <div className="flex gap-3 rounded-card border border-line bg-surface p-4 shadow-pop">
        <Echo state="happy" size={36} still className="shrink-0" />
        <div>
          <p className="text-[16px] leading-relaxed text-fg">
            They share the host kernel and isolate processes with namespaces{" "}
            <sup className="font-mono text-xs font-semibold text-link">1</sup>, so they start in
            milliseconds while a VM boots a full OS{" "}
            <sup className="font-mono text-xs font-semibold text-link">2</sup>.
          </p>
          <ol className="mt-3 space-y-1 font-mono text-xs text-muted">
            <li>1 · Understanding Docker containers</li>
            <li>2 · OS notes: processes and threads</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

const BEATS: Beat[] = [
  {
    title: "You read like normal",
    body: "Sentiora saves the page in the background while you're signed in.",
    scene: <ReadScene />,
  },
  {
    title: "It becomes a memory",
    body: "Clean text, the source and a few tags. Ads and menus are thrown away.",
    scene: <MemoryScene />,
  },
  {
    title: "Find it by meaning",
    body: "Search the idea, not the title. The right page comes back even if you forgot every word.",
    scene: <SearchScene />,
  },
  {
    title: "Ask, with sources",
    body: "Answers come only from what you saved, each claim linked to its page.",
    scene: <AskScene />,
  },
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

function Heading() {
  return (
    <h2 id="how-heading" className="max-w-2xl font-display text-section text-fg">
      From a page you read to an answer you trust.
    </h2>
  );
}

function StackedStory() {
  return (
    <ol className="mt-12 space-y-14">
      {BEATS.map((beat, i) => (
        <li key={beat.title} className="grid gap-6 md:grid-cols-2 md:items-center">
          <div>
            <p className="font-mono text-eyebrow text-muted">0{i + 1}</p>
            <h3 className="mt-1 font-display text-[26px] font-bold tracking-tight text-fg">{beat.title}</h3>
            <p className="mt-2 text-[17px] leading-relaxed text-muted">{beat.body}</p>
          </div>
          <div className="flex justify-center">{beat.scene}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * How it works as a scroll story (DESIGN.md §9.3): a tall section with a sticky
 * inner layout. Four beats on the left, one stage on the right that cross-fades
 * between scenes. Under 860px or with reduced motion it simply stacks.
 */
export default function ScrollStory() {
  const reduced = usePrefersReducedMotion();
  const wide = useMediaQuery(WIDE);
  const sticky = wide && !reduced;
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const announced = useRef(-1);

  useEffect(() => {
    if (!sticky) return;
    const update = () => {
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      const beat = Math.min(BEATS.length - 1, Math.floor(progress * BEATS.length));
      setActive(beat);
      // Tell the roaming Echo once per beat, only while the story fills the screen.
      const mid = window.innerHeight / 2;
      const onScreen = rect.top < mid && rect.bottom > mid;
      if (onScreen && beat !== announced.current) {
        announced.current = beat;
        emitEcho({ type: "story-beat", beat });
      }
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sticky]);

  function goTo(index: number) {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const travel = section.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + ((index + 0.5) / BEATS.length) * travel, behavior: "smooth" });
  }

  if (!sticky) {
    return (
      <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Heading />
          <StackedStory />
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      aria-labelledby="how-heading"
      className="relative h-[340vh] scroll-mt-16"
    >
      <div className="sticky top-16 flex h-[calc(100vh-4rem)] items-center">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-12 px-6">
          <div>
            <Heading />
            <ol className="mt-10 space-y-2">
              {BEATS.map((beat, i) => (
                <li
                  key={beat.title}
                  className={cx(
                    "relative rounded-btn transition-colors",
                    i === active ? "bg-surface" : "hover:bg-surface/60",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute bottom-3 left-2 top-3 w-1 rounded-full transition-colors duration-200",
                      i === active ? "bg-accent" : "bg-line",
                    )}
                  />
                  <h3>
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      aria-current={i === active ? "step" : undefined}
                      className="w-full rounded-btn pb-1 pl-6 pr-3 pt-3 text-left"
                    >
                      <span className="block font-mono text-eyebrow text-muted">0{i + 1}</span>
                      <span
                        className={cx(
                          "block font-display text-[22px] font-bold tracking-tight transition-colors",
                          i === active ? "text-fg" : "text-muted",
                        )}
                      >
                        {beat.title}
                      </span>
                    </button>
                  </h3>
                  <p
                    className={cx(
                      "pl-6 pr-3 text-[16px] leading-relaxed text-muted transition-[opacity,max-height] duration-200",
                      i === active ? "max-h-24 pb-3 opacity-100" : "max-h-0 overflow-hidden pb-2 opacity-0",
                    )}
                  >
                    {beat.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div
            data-story-stage=""
            className="relative flex aspect-[5/4] items-center justify-center rounded-panel border border-line bg-raised p-8"
          >
            {BEATS.map((beat, i) => (
              <div
                key={beat.title}
                aria-hidden={i !== active}
                className={cx(
                  "absolute inset-0 flex items-center justify-center p-8 transition-opacity duration-300",
                  i === active ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                {beat.scene}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
