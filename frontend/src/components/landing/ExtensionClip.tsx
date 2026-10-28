import { useEffect, useRef, useState } from "react";

import { Echo, IconShield, LogoMark, SourceBadge, cx } from "@shared/ui";

import { useInView } from "../../hooks/useInView";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { emitEcho } from "../echo/echoEvents";
import { EXTENSION_CLIP_VIDEO } from "./links";

const STEP_MS = 4_200;
const CLICK_AT_MS = 800;
const SAVE_AT_MS = 1_700;
const START_COUNT = 41;

type TabKind = "web" | "video" | "pdf" | "bank";

interface ClipTab {
  title: string;
  url: string;
  kind: TabKind;
  toast: string;
}

const TABS: ClipTab[] = [
  {
    title: "HTTP caching · MDN",
    url: "developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
    kind: "web",
    toast: "Saved: HTTP caching",
  },
  {
    title: "Intro to WebSockets",
    url: "youtube.com/watch?v=websockets-intro",
    kind: "video",
    toast: "Saved transcript: Intro to WebSockets",
  },
  {
    title: "os-notes-ch6.pdf",
    url: "file:///C:/notes/os-notes-ch6.pdf",
    kind: "pdf",
    toast: "Saved: OS notes, chapter 6",
  },
  {
    title: "NetBanking",
    url: "netbanking.example-bank.in/login",
    kind: "bank",
    toast: "Skipped: banking page",
  },
];

const FIRST_TAB = TABS[0] as ClipTab;

function TabPage({ tab }: { tab: ClipTab }) {
  if (tab.kind === "video") {
    return (
      <div className="space-y-3">
        <div className="flex aspect-video items-center justify-center rounded-btn bg-inverse">
          <span className="ml-1 h-0 w-0 border-y-[14px] border-l-[22px] border-y-transparent border-l-on-inverse" />
        </div>
        <p className="text-[17px] font-semibold text-fg">Intro to WebSockets</p>
      </div>
    );
  }
  if (tab.kind === "pdf") {
    return (
      <div className="mx-auto max-w-xs rounded-md border border-line bg-surface p-5 shadow-pop">
        <p className="font-mono text-xs text-muted">Chapter 6</p>
        <p className="mt-1 font-display text-[19px] font-bold text-fg">Synchronization</p>
        <div className="mt-3 space-y-2">
          <span className="block h-2 w-full rounded-full bg-raised" />
          <span className="block h-2 w-11/12 rounded-full bg-raised" />
          <span className="block h-2 w-4/5 rounded-full bg-raised" />
        </div>
      </div>
    );
  }
  if (tab.kind === "bank") {
    return (
      <div className="mx-auto max-w-xs space-y-3 rounded-card border border-line bg-surface p-5">
        <p className="font-display text-[19px] font-bold text-fg">Welcome back</p>
        <div className="space-y-1">
          <p className="text-sm text-muted">Customer ID</p>
          <span className="block h-9 rounded-md border border-line" />
        </div>
        <div className="space-y-1">
          <p className="text-sm text-muted">Password</p>
          <span className="block h-9 rounded-md border border-line" />
        </div>
        <span className="flex h-9 items-center justify-center rounded-md bg-inverse text-sm font-semibold text-on-inverse">
          Log in
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="font-display text-[24px] font-bold text-fg">HTTP caching</p>
      <span className="block h-2.5 w-full rounded-full bg-raised" />
      <span className="block h-2.5 w-11/12 rounded-full bg-raised" />
      <span className="block h-2.5 w-3/4 rounded-full bg-raised" />
      <span className="block h-2.5 w-5/6 rounded-full bg-raised" />
    </div>
  );
}

interface ClipBrowserProps {
  /** Tab the cursor is heading for. */
  cursor: number;
  /** Tab shown as open. */
  active: number;
  /** Tabs whose save (or skip) has landed. */
  done: number;
  showCursor: boolean;
}

function ClipBrowser({ cursor, active, done, showCursor }: ClipBrowserProps) {
  const tab = TABS[active] ?? FIRST_TAB;
  const saved = TABS.slice(0, done).filter((t) => t.kind !== "bank").length;
  const guarding = tab.kind === "bank" && done > active;
  const toasts = TABS.slice(0, done);

  return (
    <div className="relative overflow-hidden rounded-panel border border-line bg-surface shadow-float">
      <div className="relative flex gap-1 border-b border-line bg-raised px-2 pt-2">
        {TABS.map((t, i) => (
          <div
            key={t.title}
            className={cx(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-t-md px-2.5 py-2 text-sm transition-colors",
              i === active ? "bg-surface text-fg" : "text-muted",
            )}
          >
            {t.kind === "bank" ? (
              <IconShield size={14} className="shrink-0" />
            ) : (
              <SourceBadge type={t.kind} className="hidden sm:inline-flex" />
            )}
            <span className="truncate">{t.title}</span>
          </div>
        ))}
        {showCursor ? (
          <svg
            viewBox="0 0 16 22"
            width={16}
            height={22}
            className="clip-cursor absolute top-4"
            style={{ left: `calc(${(cursor + 0.5) * 25}% - 4px)` }}
          >
            <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="var(--text)" stroke="var(--surface)" strokeWidth={1.4} strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate rounded-full bg-raised px-3 py-1.5 font-mono text-xs text-muted">
          {tab.url}
        </span>
        <span
          key={`${done}-${guarding}`}
          className={cx(
            "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            guarding ? "bg-badge-note-bg text-badge-note-fg" : "bg-inverse",
            done > 0 && "clip-icon-pulse",
          )}
        >
          {guarding ? <IconShield size={18} /> : <LogoMark size={18} tone="inverse" />}
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-semibold text-on-accent">
            {START_COUNT + saved}
          </span>
        </span>
      </div>
      <div className="min-h-[260px] p-5 sm:p-7">
        <TabPage tab={tab} />
      </div>
      <ol className="pointer-events-none absolute bottom-3 right-3 flex w-64 max-w-[80%] flex-col gap-2">
        {toasts.slice(-3).map((t) => (
          <li
            key={t.title}
            className="clip-toast flex items-center gap-2 rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg shadow-pop"
          >
            <Echo state={t.kind === "bank" ? "guarding" : "happy"} size={24} still className="shrink-0" />
            <span className="truncate">{t.toast}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * "Watch it save a real page." (DESIGN.md §9.4): an animated Chrome mock that
 * saves three tabs and skips a banking login. Runs only while on screen, 4.2s
 * per step, looping. Set EXTENSION_CLIP_VIDEO to swap in a real recording.
 */
export default function ExtensionClip() {
  const reduced = usePrefersReducedMotion();
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef);
  const [step, setStep] = useState(0);
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (reduced || !inView || EXTENSION_CLIP_VIDEO) return;
    const timers: number[] = [];
    // Step `step`: the cursor moves, clicks the tab, then the save (or skip) lands.
    timers.push(window.setTimeout(() => setActive(step), CLICK_AT_MS));
    timers.push(
      window.setTimeout(() => {
        setDone(step + 1);
        if (TABS[step]?.kind !== "bank") emitEcho({ type: "clip-saved" });
      }, SAVE_AT_MS),
    );
    timers.push(
      window.setTimeout(() => {
        if (step === TABS.length - 1) {
          setDone(0);
          setStep(0);
        } else {
          setStep(step + 1);
        }
      }, STEP_MS),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [step, reduced, inView]);

  return (
    <section id="extension" aria-labelledby="extension-heading" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 id="extension-heading" className="font-display text-section text-fg">
            Watch it save a real page.
          </h2>
          <p className="mt-4 text-[18px] leading-relaxed text-muted">
            The extension sits in your toolbar. Echo tells you when a page is saved, and when
            it&apos;s skipped on purpose.
          </p>
        </div>
        <figure ref={frameRef} className="mt-12">
          {EXTENSION_CLIP_VIDEO ? (
            <video
              className="w-full rounded-panel border border-line shadow-float"
              src={EXTENSION_CLIP_VIDEO.src}
              poster={EXTENSION_CLIP_VIDEO.poster}
              muted
              loop
              playsInline
              autoPlay={!reduced}
              controls={reduced}
            />
          ) : (
            <div aria-hidden="true">
              {reduced ? (
                <ClipBrowser cursor={TABS.length - 1} active={TABS.length - 1} done={TABS.length} showCursor={false} />
              ) : (
                <ClipBrowser cursor={step} active={active} done={done} showCursor />
              )}
            </div>
          )}
          <figcaption className="sr-only">
            The Sentiora extension saves an article, a YouTube transcript and a local PDF, and
            skips a banking login page.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
