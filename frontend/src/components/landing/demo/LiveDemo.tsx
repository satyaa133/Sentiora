import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { Button, Chip, Echo, Eyebrow, SourceBadge, Tabs, cx } from "@shared/ui";

import { useInView } from "../../../hooks/useInView";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import {
  AUDIENCES,
  DEMO_FALLBACK,
  DEMO_LIBRARIES,
  findDemoAnswer,
  splitCitations,
  type Audience,
  type DemoQA,
} from "./demoLibrary";

/** Untouched this long, the demo asks its own questions (§9.1). */
const AUTOPLAY_IDLE_MS = 12_000;
const AUTOPLAY_FIRST_MS = 1_500;
/** Pause between an autoplayed answer and the next question. */
const AUTOPLAY_GAP_MS = 4_500;
const LOOK_MS = 650;
const TYPE_STEP_MS = 18;
const TYPE_CHARS = 3;
const KEY_MS = 45;

type Phase = "idle" | "looking" | "typing" | "done";

interface Asked {
  question: string;
  qa: DemoQA | null;
}

/**
 * "Try it · sample library" (DESIGN.md §9.1): ask a prepared sample library and
 * watch Echo answer with citations. All answers are static data; no API calls.
 */
export default function LiveDemo({ onAnswered }: { onAnswered?: () => void }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const [audience, setAudience] = useState<Audience>("students");
  const library = DEMO_LIBRARIES[audience];
  const [input, setInput] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState(0);

  const phaseRef = useRef<Phase>("idle");
  const timers = useRef<number[]>([]);
  const lastTouch = useRef(Date.now() - AUTOPLAY_IDLE_MS + AUTOPLAY_FIRST_MS);
  const lastAnswerAt = useRef(0);
  const autoTyping = useRef(false);
  const autoIndex = useRef(0);
  const onAnsweredRef = useRef(onAnswered);

  useEffect(() => {
    onAnsweredRef.current = onAnswered;
  }, [onAnswered]);

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) {
      window.clearTimeout(id);
      window.clearInterval(id);
    }
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text) return;
      clearTimers();
      autoTyping.current = false;
      const qa = findDemoAnswer(library, text);
      const plain = splitCitations(qa?.answer ?? DEMO_FALLBACK)
        .map((part) => ("text" in part ? part.text : ""))
        .join("");
      setAsked({ question: text, qa });
      setInput("");
      setTyped(0);

      const finish = () => {
        setTyped(plain.length);
        setPhaseBoth("done");
        lastAnswerAt.current = Date.now();
        if (qa) onAnsweredRef.current?.();
      };
      if (reduced) {
        finish();
        return;
      }
      setPhaseBoth("looking");
      timers.current.push(
        window.setTimeout(() => {
          setPhaseBoth("typing");
          let shown = 0;
          const interval = window.setInterval(() => {
            shown = Math.min(plain.length, shown + TYPE_CHARS);
            setTyped(shown);
            if (shown >= plain.length) {
              window.clearInterval(interval);
              finish();
            }
          }, TYPE_STEP_MS);
          timers.current.push(interval);
        }, LOOK_MS),
      );
    },
    [clearTimers, library, reduced, setPhaseBoth],
  );

  /** Any real interaction holds autoplay off for 12s and stops a half-typed question. */
  const touch = useCallback(() => {
    lastTouch.current = Date.now();
    if (autoTyping.current) {
      clearTimers();
      autoTyping.current = false;
      setInput("");
    }
  }, [clearTimers]);

  // Autoplay: type and ask the audience's own questions while untouched and on screen.
  useEffect(() => {
    if (!inView) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (autoTyping.current) return;
      if (phaseRef.current === "looking" || phaseRef.current === "typing") return;
      if (now - lastTouch.current < AUTOPLAY_IDLE_MS) return;
      if (now - lastAnswerAt.current < AUTOPLAY_GAP_MS) return;
      const qa = library.qas[autoIndex.current % library.qas.length];
      autoIndex.current += 1;
      if (!qa) return;
      autoTyping.current = true;
      if (reduced) {
        ask(qa.question);
        return;
      }
      let count = 0;
      const typer = window.setInterval(() => {
        count += 1;
        setInput(qa.question.slice(0, count));
        if (count >= qa.question.length) {
          window.clearInterval(typer);
          timers.current.push(window.setTimeout(() => ask(qa.question), 300));
        }
      }, KEY_MS);
      timers.current.push(typer);
    }, 500);
    return () => window.clearInterval(interval);
  }, [ask, inView, library, reduced]);

  function changeAudience(id: string) {
    touch();
    clearTimers();
    autoTyping.current = false;
    autoIndex.current = 0;
    setAudience(id as Audience);
    setAsked(null);
    setInput("");
    setTyped(0);
    setPhaseBoth("idle");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    touch();
    ask(input);
  }

  const parts = splitCitations(asked?.qa?.answer ?? DEMO_FALLBACK);
  const done = phase === "done";
  const cited = done && asked?.qa ? asked.qa.sources : [];

  // Reveal the answer's text runs up to `typed` characters; citations wait for the end.
  let remaining = typed;
  const answer = parts.map((part, index) => {
    if ("cite" in part) {
      return done ? (
        <sup key={index} className="ml-0.5">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-soft px-1 font-mono text-xs font-semibold not-italic text-accent-soft-fg">
            {part.cite}
          </span>
        </sup>
      ) : null;
    }
    const shown = part.text.slice(0, Math.max(0, remaining));
    remaining -= part.text.length;
    return <span key={index}>{shown}</span>;
  });

  const body = (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="demo-question" className="sr-only">
          Ask the sample library
        </label>
        <input
          id="demo-question"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the sample library"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-btn border border-line bg-surface px-3 text-[16px] text-fg placeholder:text-muted focus-visible:border-accent"
        />
        <Button type="submit" variant="inverse">
          Ask
        </Button>
      </form>

      <div className="flex flex-wrap gap-2" aria-label="Suggested questions" role="group">
        {library.qas.map((qa) => (
          <Chip key={qa.question} className="h-auto min-h-9 py-1.5 text-left" onClick={() => ask(qa.question)}>
            {qa.question}
          </Chip>
        ))}
      </div>

      <div className="min-h-[124px] rounded-card bg-raised p-4" aria-live="polite" aria-busy={!done && phase !== "idle"}>
        {asked ? (
          <>
            <p className="text-[15px] font-semibold text-fg">{asked.question}</p>
            <div className="mt-2 flex gap-3">
              <Echo
                state={phase === "looking" ? "searching" : asked.qa ? "happy" : "idle"}
                size={36}
                still
                className="mt-0.5 shrink-0"
              />
              <p className={cx("text-[16px] leading-relaxed text-fg", phase === "typing" && "demo-caret")}>
                {phase === "looking" ? (
                  <span className="text-muted">Echo is looking through the library…</span>
                ) : (
                  answer
                )}
              </p>
            </div>
            {cited.length > 0 ? (
              <ol className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Sources">
                {cited.map((itemIndex, i) => {
                  const item = library.items[itemIndex];
                  if (!item) return null;
                  return (
                    <li
                      key={itemIndex}
                      className="demo-source flex items-start gap-2 rounded-btn border border-line bg-surface p-2.5"
                      style={{ "--i": i } as CSSProperties}
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-semibold text-on-accent">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium text-fg">{item.title}</span>
                        <span className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted">
                          <SourceBadge type={item.kind} />
                          {item.saved}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-3 text-[15px] text-muted">
            <Echo state="idle" size={36} still className="shrink-0" />
            Pick a question or type your own.
          </div>
        )}
      </div>

      <div>
        <p className="font-mono text-eyebrow uppercase text-muted">Sample library</p>
        <ul className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-2" data-demo-library="">
          {library.items.map((item, index) => {
            const cite = cited.indexOf(index);
            return (
              <li
                key={item.title}
                data-cited={cite >= 0 ? "" : undefined}
                className={cx(
                  "flex items-center gap-2 rounded-md px-2 py-1 transition-colors duration-200",
                  cite >= 0 && "bg-accent-soft",
                )}
              >
                <SourceBadge type={item.kind} />
                <span className={cx("truncate text-[15px]", cite >= 0 ? "font-medium text-accent-soft-fg" : "text-fg")}>
                  {item.title}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      onPointerDown={touch}
      onKeyDown={touch}
      // Roaming Echo may fly across the demo but never parks on it, and no scraps pop out of it.
      data-echo-avoid=""
      className="relative rounded-panel border border-line bg-surface p-4 shadow-float sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <Eyebrow>Try it · sample library</Eyebrow>
        <span className="font-mono text-xs text-muted">{library.items.length} saved pages</span>
      </div>
      <Tabs
        label="Sample library"
        value={audience}
        onChange={changeAudience}
        items={AUDIENCES.map((id) => ({
          id,
          label: DEMO_LIBRARIES[id].label,
          panel: id === audience ? body : null,
        }))}
      />
    </div>
  );
}
