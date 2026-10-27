import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Echo, cx, type EchoLook, type EchoState } from "@shared/ui";

import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import EchoControls from "../EchoControls";
import { emitEcho } from "../echoEvents";
import { readEchoPaused, readEchoSound, writeEchoPaused, writeEchoSound } from "../echoPrefs";
import type { EchoSound } from "../echoSound";
import {
  KONAMI,
  createClickCounter,
  createSequenceMatcher,
  createWordMatcher,
  isTypingTarget,
} from "./easterEggs";
import {
  clampToBox,
  distance,
  insideAny,
  nearestIndex,
  randomPoint,
  steer,
  type Box,
  type Vec,
} from "./steering";

const SIZE = 96;
const SIZE_SMALL = 64;
const SMALL_SCREEN = "(max-width: 719px)";

const MAX_SCRAPS = 7;
const SPAWN_EVERY_MS = 2_000;
const WANDER_EVERY_MS = 3_500;
const NAP_AFTER_MS = 40_000;
const NAP_MS = 5_000;
const BLINK_EVERY_MS = 4_000;
const POINT_COOLDOWN_MS = 8_000;
const SCARE_COOLDOWN_MS = 4_000;
/** Pointer speed (px/ms) that counts as a swipe, and how close it must pass. */
const SWIPE_SPEED = 2.4;
const SWIPE_RADIUS = 140;
/** Echo may cross the hero CTA but never linger on it (§8.1). */
const AVOID_PAD = 24;
const AVOID_LINGER_MS = 700;
const TOP_MARGIN = 76;

const SCRAP_LABELS = ["article", "PDF", "video", "note", "paper", "slides", "talk", "thread"];
const SCRAP_SOURCES = "main h1, main h2, main h3, main p";

interface Scrap {
  id: number;
  x: number;
  y: number;
  label: string;
}

interface Bubble {
  id: number;
  text: string;
}

interface Reaction {
  face: EchoState;
  until: number;
}

function avoidBoxes(): Box[] {
  return [...document.querySelectorAll<HTMLElement>("[data-echo-avoid]")]
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function viewportBounds(size: number): Box {
  const half = size / 2;
  return {
    left: half + 8,
    right: window.innerWidth - half - 8,
    top: TOP_MARGIN + half,
    bottom: window.innerHeight - half - 72,
  };
}

/**
 * Roaming mode (DESIGN.md §8.1): landing and 404 only. Echo steers around the
 * page chasing memory scraps that pop out of real headings and paragraphs. One
 * requestAnimationFrame loop writes transforms directly; React state changes
 * only for faces, bubbles and scraps. The loop stops when paused or hidden.
 */
export default function RoamingEcho({ easterEggs }: { easterEggs: boolean }) {
  const reducedMotion = usePrefersReducedMotion();
  const [size, setSize] = useState(() =>
    typeof window.matchMedia === "function" && window.matchMedia(SMALL_SCREEN).matches
      ? SIZE_SMALL
      : SIZE,
  );
  const [face, setFace] = useState<EchoState>("idle");
  const [look, setLook] = useState<EchoLook>({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [squish, setSquish] = useState(0);
  const [spin, setSpin] = useState(0);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [scraps, setScraps] = useState<Scrap[]>([]);
  const [paused, setPaused] = useState(readEchoPaused);
  const [soundOn, setSoundOn] = useState(readEchoSound);

  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pos = useRef<Vec>({ x: 0, y: 0 });
  const vel = useRef<Vec>({ x: 0, y: 0 });
  const target = useRef<Vec>({ x: 0, y: 0 });
  const facing = useRef(1);
  const nextWander = useRef(0);
  const lingerSince = useRef<number | null>(null);
  const reaction = useRef<Reaction | null>(null);
  const flee = useRef<{ to: Vec; until: number } | null>(null);
  const point = useRef<{ to: Vec; until: number } | null>(null);
  const napUntil = useRef(0);
  const lastInput = useRef(Date.now());
  const lastPoint = useRef(0);
  const lastScare = useRef(0);
  const cursor = useRef<{ x: number; y: number; t: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean; lastX: number; lastY: number; lastT: number; vx: number; vy: number } | null>(null);
  const scrapsRef = useRef<Scrap[]>([]);
  const scrapId = useRef(0);
  const saved = useRef(0);
  const faceRef = useRef<EchoState>("idle");
  const lookRef = useRef<EchoLook>({ x: 0, y: 0 });
  const sound = useRef<EchoSound | null>(null);
  const soundOnRef = useRef(soundOn);
  const pausedRef = useRef(paused);
  const sizeRef = useRef(size);
  const reducedRef = useRef(reducedMotion);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const clickEgg = useRef(createClickCounter(7, 3_000));

  useEffect(() => {
    soundOnRef.current = soundOn;
    pausedRef.current = paused;
    sizeRef.current = size;
    reducedRef.current = reducedMotion;
    scrapsRef.current = scraps;
  }, [soundOn, paused, size, reducedMotion, scraps]);

  const sfx = useCallback((name: Exclude<keyof EchoSound, "close" | "babble">) => {
    if (soundOnRef.current && !pausedRef.current) sound.current?.[name]();
  }, []);

  const say = useCallback((text: string, ms = 1500) => {
    window.clearTimeout(bubbleTimer.current);
    setBubble({ id: Date.now(), text });
    if (soundOnRef.current && !pausedRef.current) sound.current?.babble(text);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  const react = useCallback((state: EchoState, ms: number) => {
    reaction.current = { face: state, until: performance.now() + ms };
  }, []);

  // Start somewhere sensible: lower right, clear of the hero buttons.
  useEffect(() => {
    const bounds = viewportBounds(sizeRef.current);
    const start = randomPoint(
      { ...bounds, left: (bounds.left + bounds.right) / 2 },
      avoidBoxes(),
      AVOID_PAD,
    );
    pos.current = start;
    target.current = start;
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SMALL_SCREEN);
    const onChange = () => setSize(media.matches ? SIZE_SMALL : SIZE);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const eatScrap = useCallback(
    (id: number) => {
      setScraps((current) => current.filter((scrap) => scrap.id !== id));
      scrapsRef.current = scrapsRef.current.filter((scrap) => scrap.id !== id);
      saved.current += 1;
      emitEcho({ type: "landing-saved", total: saved.current });
      sfx("chomp");
      window.setTimeout(() => sfx("pop"), 120);
      // A brief smile, unless a bigger reaction (tickle, scare, egg) is playing.
      if (!reaction.current || performance.now() > reaction.current.until) react("happy", 500);
    },
    [react, sfx],
  );

  const addScrap = useCallback((x: number, y: number) => {
    const scrap: Scrap = {
      id: (scrapId.current += 1),
      x,
      y,
      label: SCRAP_LABELS[Math.floor(Math.random() * SCRAP_LABELS.length)] ?? "note",
    };
    scrapsRef.current = [...scrapsRef.current, scrap];
    setScraps(scrapsRef.current);
  }, []);

  // The animation loop.
  useEffect(() => {
    if (paused) return;
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 50) / 16.67;
      last = now;
      const currentSize = sizeRef.current;
      const reduced = reducedRef.current;
      const bounds = viewportBounds(currentSize);
      const avoid = avoidBoxes();
      const p = pos.current;
      const napping = now < napUntil.current;

      if (drag.current) {
        vel.current = { x: 0, y: 0 };
      } else if (napping) {
        vel.current = { x: vel.current.x * 0.9, y: vel.current.y * 0.9 };
        pos.current = { x: p.x + vel.current.x, y: p.y + vel.current.y };
      } else {
        let speed = 4.2;
        if (flee.current && now < flee.current.until) {
          target.current = flee.current.to;
          speed = 7.5;
        } else if (point.current && now < point.current.until) {
          target.current = point.current.to;
          speed = 6;
        } else {
          flee.current = null;
          point.current = null;
          const live = scrapsRef.current;
          const index = nearestIndex(p, live);
          const scrap = live[index];
          if (scrap) {
            target.current = { x: scrap.x, y: scrap.y };
            speed = 5;
          } else if (now > nextWander.current) {
            target.current = randomPoint(bounds, avoid, AVOID_PAD + currentSize / 2);
            nextWander.current = now + WANDER_EVERY_MS;
          }
        }

        // Crossing the hero CTA is fine; staying on it is not.
        if (insideAny(p, avoid, AVOID_PAD)) {
          lingerSince.current ??= now;
          if (now - lingerSince.current > AVOID_LINGER_MS) {
            target.current = randomPoint(bounds, avoid, AVOID_PAD + currentSize / 2);
            nextWander.current = now + WANDER_EVERY_MS;
            lingerSince.current = now;
          }
        } else {
          lingerSince.current = null;
        }

        const step = steer(
          p,
          vel.current,
          target.current,
          {
            maxSpeed: speed * (reduced ? 0.6 : 1) * (currentSize / SIZE) ** 0.5,
            maxForce: 0.22,
            arriveRadius: 120,
          },
          dt,
        );
        pos.current = clampToBox(step.pos, {
          ...bounds,
          top: bounds.top - TOP_MARGIN / 2,
        });
        vel.current = step.vel;

        const ate = scrapsRef.current.find(
          (scrap) => distance(pos.current, scrap) < currentSize * 0.42,
        );
        if (ate) eatScrap(ate.id);
      }

      // Face: a timed reaction wins, then napping, then chomping when close to food.
      const reacting = reaction.current && now < reaction.current.until ? reaction.current.face : null;
      const nearFood = scrapsRef.current.some((scrap) => distance(pos.current, scrap) < 170);
      const nextFace: EchoState = reacting ?? (napping ? "sleeping" : nearFood ? "chomp" : "idle");
      if (nextFace !== faceRef.current) {
        faceRef.current = nextFace;
        setFace(nextFace);
      }

      // Eyes follow the cursor, in coarse steps so React re-renders rarely.
      if (cursor.current) {
        const dx = cursor.current.x - pos.current.x;
        const dy = cursor.current.y - pos.current.y;
        const len = Math.hypot(dx, dy) || 1;
        const next = {
          x: (Math.round((dx / len) * 4) / 4) * facing.current,
          y: Math.round((dy / len) * 4) / 4,
        };
        if (next.x !== lookRef.current.x || next.y !== lookRef.current.y) {
          lookRef.current = next;
          setLook(next);
        }
      }

      const v = vel.current;
      if (Math.abs(v.x) > 0.3) facing.current = v.x > 0 ? 1 : -1;
      const tilt = Math.max(-14, Math.min(14, v.x * 2.4));
      const bob = reduced || napping ? 0 : Math.sin((now / 3000) * Math.PI * 2) * 4;
      const swing = Math.min(28, Math.hypot(v.x, v.y) * 5 + Math.sin(now / 160) * Math.min(8, Math.hypot(v.x, v.y) * 2));
      const wrap = wrapRef.current;
      const body = bodyRef.current;
      if (wrap) {
        wrap.style.transform = `translate3d(${pos.current.x - currentSize / 2}px, ${pos.current.y - currentSize / 2 + bob}px, 0)`;
      }
      if (body) {
        body.style.transform = `rotate(${tilt}deg) scaleX(${facing.current})`;
        body.style.setProperty("--echo-swing", `${swing}deg`);
      }

      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      last = performance.now();
      if (document.visibilityState !== "hidden") frame = window.requestAnimationFrame(tick);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", start);
    };
  }, [paused, eatScrap]);

  // Scraps pop out of real headings and paragraphs on screen, every ~2s.
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden" || scrapsRef.current.length >= MAX_SCRAPS) return;
      const avoid = avoidBoxes();
      const sources = [...document.querySelectorAll<HTMLElement>(SCRAP_SOURCES)].filter((el) => {
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 40 &&
          rect.bottom > TOP_MARGIN + 20 &&
          rect.top < window.innerHeight - 90 &&
          !el.closest("[data-echo-avoid]")
        );
      });
      const source = sources[Math.floor(Math.random() * sources.length)];
      if (!source) return;
      const rect = source.getBoundingClientRect();
      const x = rect.left + Math.random() * Math.min(rect.width, 320);
      const y = Math.max(TOP_MARGIN + 20, rect.top + Math.random() * Math.min(rect.height, 40));
      if (insideAny({ x, y }, avoid, AVOID_PAD)) return;
      addScrap(Math.min(window.innerWidth - 40, x), Math.min(window.innerHeight - 90, y));
    }, SPAWN_EVERY_MS);
    return () => window.clearInterval(interval);
  }, [paused, addScrap]);

  // Slow behaviours: blink, power nap, the occasional spin.
  useEffect(() => {
    if (paused) return;
    let nextSpin = Date.now() + 25_000 + Math.random() * 20_000;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      setBlink(true);
      window.setTimeout(() => setBlink(false), 140);
      if (now - lastInput.current > NAP_AFTER_MS && performance.now() > napUntil.current) {
        napUntil.current = performance.now() + NAP_MS;
        lastInput.current = now + NAP_MS;
        window.setTimeout(() => {
          sfx("wake");
          say("huh? I'm up");
        }, NAP_MS);
      }
      if (!reducedRef.current && now > nextSpin && !drag.current) {
        nextSpin = now + 25_000 + Math.random() * 20_000;
        setSpin((count) => count + 1);
      }
    }, BLINK_EVERY_MS);
    return () => window.clearInterval(interval);
  }, [paused, say, sfx]);

  // Pointer: eyes, swipe scares, double-click drops a memory, hover on a primary button.
  useEffect(() => {
    if (paused) return;
    const onMove = (event: PointerEvent) => {
      const now = performance.now();
      lastInput.current = Date.now();
      const previous = cursor.current;
      cursor.current = { x: event.clientX, y: event.clientY, t: now };
      if (!previous || drag.current || now - lastScare.current < SCARE_COOLDOWN_MS) return;
      const elapsed = Math.max(1, now - previous.t);
      const speed = Math.hypot(event.clientX - previous.x, event.clientY - previous.y) / elapsed;
      if (speed > SWIPE_SPEED && distance(pos.current, { x: event.clientX, y: event.clientY }) < SWIPE_RADIUS) {
        lastScare.current = now;
        const away = { x: pos.current.x - event.clientX, y: pos.current.y - event.clientY };
        const len = Math.hypot(away.x, away.y) || 1;
        flee.current = {
          to: clampToBox(
            { x: pos.current.x + (away.x / len) * 260, y: pos.current.y + (away.y / len) * 260 },
            viewportBounds(sizeRef.current),
          ),
          until: now + 1300,
        };
        react("scared", 1300);
        sfx("scared");
        say("eek!", 1200);
      }
    };
    const onDoubleClick = (event: MouseEvent) => {
      const el = event.target as HTMLElement | null;
      if (el?.closest("a, button, input, textarea, select, label, summary, p, li, h1, h2, h3, h4, h5, h6, [contenteditable]")) return;
      if (scrapsRef.current.length >= MAX_SCRAPS + 2) return;
      addScrap(event.clientX, event.clientY);
      sfx("pop");
    };
    const onOver = (event: PointerEvent) => {
      const el = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-echo-point]");
      const now = performance.now();
      if (!el || drag.current || now - lastPoint.current < POINT_COOLDOWN_MS) return;
      lastPoint.current = now;
      const rect = el.getBoundingClientRect();
      const avoid = avoidBoxes().find((box) => insideAny({ x: rect.left + 1, y: rect.top + 1 }, [box]));
      const top = Math.min(rect.top, avoid?.top ?? rect.top) - AVOID_PAD - sizeRef.current * 0.55;
      const y = top > TOP_MARGIN + sizeRef.current / 2 ? top : rect.bottom + AVOID_PAD + sizeRef.current * 0.6;
      point.current = { to: { x: rect.left + rect.width / 2, y }, until: now + 1800 };
      react("happy", 1800);
      say("click this one", 1600);
    };
    const onInput = () => {
      lastInput.current = Date.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("dblclick", onDoubleClick);
    document.addEventListener("pointerover", onOver);
    window.addEventListener("keydown", onInput);
    window.addEventListener("scroll", onInput, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("pointerover", onOver);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("scroll", onInput);
    };
  }, [paused, addScrap, react, say, sfx]);

  // Easter eggs, landing only (§10).
  useEffect(() => {
    if (!easterEggs || paused) return;
    const konami = createSequenceMatcher(KONAMI);
    const boo = createWordMatcher("boo");
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (konami(event.key)) {
        if (!reducedRef.current) setSpin((count) => count + 1);
        react("giggle", 2400);
        sfx("whee");
        say("dance party!", 2200);
      } else if (boo(event.key)) {
        vel.current = { x: vel.current.x, y: -9 };
        react("scared", 1400);
        sfx("scared");
        say("hey, that's MY line!", 1800);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [easterEggs, paused, react, say, sfx]);

  // Sound loads only after the user turns it on.
  useEffect(() => {
    if (!soundOn || paused || sound.current) return;
    let cancelled = false;
    void import("../echoSound").then(({ createEchoSound }) => {
      if (!cancelled && !sound.current) sound.current = createEchoSound();
    });
    return () => {
      cancelled = true;
    };
  }, [soundOn, paused]);

  useEffect(
    () => () => {
      window.clearTimeout(bubbleTimer.current);
      sound.current?.close();
    },
    [],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (paused) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      dx: event.clientX - pos.current.x,
      dy: event.clientY - pos.current.y,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    const now = performance.now();
    if (!state.moved && Math.hypot(event.clientX - state.lastX, event.clientY - state.lastY) < 5) return;
    const elapsed = Math.max(1, now - state.lastT);
    state.vx = ((event.clientX - state.lastX) / elapsed) * 16;
    state.vy = ((event.clientY - state.lastY) / elapsed) * 16;
    state.moved = true;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.lastT = now;
    pos.current = { x: event.clientX - state.dx, y: event.clientY - state.dy };
    react("happy", 400);
  }

  function onPointerUp() {
    const state = drag.current;
    drag.current = null;
    if (!state || paused) return;
    if (state.moved) {
      vel.current = { x: Math.max(-12, Math.min(12, state.vx)), y: Math.max(-12, Math.min(12, state.vy)) };
      target.current = { x: pos.current.x + vel.current.x * 10, y: pos.current.y + vel.current.y * 10 };
      nextWander.current = performance.now() + 1500;
      react("happy", 1400);
      sfx("whee");
      say("wheee", 1400);
      return;
    }
    // A plain click: tickle.
    setSquish((count) => count + 1);
    sfx("giggle");
    if (easterEggs && clickEgg.current(Date.now())) {
      react("love", 2200);
      say("ok ok, you found my secret", 2200);
    } else {
      react("giggle", 1100);
      say("hehe!", 1100);
    }
  }

  function togglePause() {
    const next = !paused;
    setPaused(next);
    writeEchoPaused(next);
    setBubble(null);
    drag.current = null;
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writeEchoSound(next);
    if (next) {
      void import("../echoSound").then(({ createEchoSound }) => {
        sound.current ??= createEchoSound();
        sound.current?.chime();
      });
    } else {
      sound.current?.close();
      sound.current = null;
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-echo-mode="roam"
        className={cx("echo-roam pointer-events-none fixed inset-0 z-40 overflow-hidden", paused && "echo-paused")}
      >
        {scraps.map((scrap) => (
          <span
            key={scrap.id}
            className="echo-scrap absolute rounded-md bg-accent px-1.5 py-0.5 font-mono text-xs font-semibold text-on-accent shadow-pop"
            style={{ left: scrap.x, top: scrap.y }}
          >
            {scrap.label}
          </span>
        ))}
        <div ref={wrapRef} className="absolute left-0 top-0 will-change-transform" style={{ width: size, height: size }}>
          {bubble ? (
            <p
              key={bubble.id}
              className="echo-bubble absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-card border border-line bg-surface px-3 py-1.5 text-[15px] text-fg shadow-pop"
            >
              {bubble.text}
            </p>
          ) : null}
          <div
            ref={bodyRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
            }}
            className="pointer-events-auto h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
          >
            {/* Keys restart the one-shot spin and squish animations. */}
            <div key={`spin-${spin}`} className={cx("h-full w-full", spin > 0 && !reducedMotion && "echo-spin")}>
              <div
                key={`squish-${squish}`}
                className={cx("h-full w-full", squish > 0 && "echo-squish", blink && "echo-blink")}
              >
                <Echo state={face} size={size} arms still look={look} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none fixed bottom-3 right-3 z-40 sm:bottom-5 sm:right-5">
        <EchoControls
          paused={paused}
          onTogglePause={togglePause}
          soundOn={soundOn}
          onToggleSound={toggleSound}
        />
      </div>
    </>
  );
}
