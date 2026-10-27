import { useCallback, useEffect, useRef, useState } from "react";

import { Echo, cx, type EchoLook, type EchoState } from "@shared/ui";

import { useStatistics } from "../../hooks/useStatistics";
import EchoControls from "./EchoControls";
import { onEcho, type EchoEvent } from "./echoEvents";
import { readEchoPaused, readEchoSound, writeEchoPaused, writeEchoSound } from "./echoPrefs";
import type { EchoSound } from "./echoSound";

const SLEEP_AFTER_MS = 20_000;
const RANDOM_FACE_EVERY_MS = 4_500;
const TICK_MS = 1_000;
const BUBBLE_MS = 1_800;
const ASK_HOLD_MS = 30_000;

/** Faces Echo pulls on its own while idle (§8.2); "look" is idle with eyes moving. */
const IDLE_FACES: Array<EchoState | "look"> = ["happy", "love", "thinking", "reading", "giggle", "look"];

const TIPS = [
  "Press Ctrl K to search",
  "Ask me about anything you saved",
  "Block a site in Privacy",
  "I save pages while you read",
];

const NAV_REACTIONS: Record<string, { face: EchoState; line: string }> = {
  timeline: { face: "reading", line: "Your timeline" },
  ask: { face: "thinking", line: "Ask me about anything you saved" },
  sources: { face: "searching", line: "Your sources" },
  privacy: { face: "guarding", line: "Keeping watch" },
};

interface Step {
  face: EchoState;
  ms: number;
  look?: EchoLook;
}

interface Bubble {
  id: number;
  text: string;
}

function clip(text: string, max = 32): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Corner mode (DESIGN.md §8.2): Echo flies to the bottom-right on entering the
 * app and stays there, reacting in place to real app events only.
 */
export default function CornerEcho() {
  const [face, setFace] = useState<EchoState>("idle");
  const [look, setLook] = useState<EchoLook | undefined>(undefined);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [paused, setPaused] = useState(readEchoPaused);
  const [soundOn, setSoundOn] = useState(readEchoSound);
  const [sleeping, setSleeping] = useState(false);
  const [lift, setLift] = useState(0);
  const [statsKey, setStatsKey] = useState(0);
  const { stats } = useStatistics(statsKey);
  const total = stats?.total ?? null;
  const [flashKey, setFlashKey] = useState(0);
  const previousTotal = useRef<number | null>(null);

  const stepTimer = useRef<number | undefined>(undefined);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const reacting = useRef(false);
  const lastActivity = useRef(Date.now());
  const lastRandomFace = useRef(Date.now());
  const tipIndex = useRef(0);
  const sound = useRef<EchoSound | null>(null);
  const pausedRef = useRef(paused);
  const soundOnRef = useRef(soundOn);
  const sleepingRef = useRef(sleeping);

  useEffect(() => {
    pausedRef.current = paused;
    soundOnRef.current = soundOn;
    sleepingRef.current = sleeping;
  }, [paused, soundOn, sleeping]);

  /** Play faces in order, then settle back to idle. */
  const play = useCallback((steps: Step[]) => {
    window.clearTimeout(stepTimer.current);
    reacting.current = true;
    const run = (index: number) => {
      const step = steps[index];
      if (!step) {
        reacting.current = false;
        // Idle faces resume ~4.5s after a reaction, not straight after it.
        lastRandomFace.current = Date.now();
        setFace("idle");
        setLook(undefined);
        return;
      }
      setFace(step.face);
      setLook(step.look);
      stepTimer.current = window.setTimeout(() => run(index + 1), step.ms);
    };
    run(0);
  }, []);

  const say = useCallback((text: string, ms = BUBBLE_MS) => {
    window.clearTimeout(bubbleTimer.current);
    setBubble({ id: Date.now(), text });
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  const tick = useCallback(() => {
    if (soundOnRef.current && !pausedRef.current) sound.current?.tick();
  }, []);

  /** Any input or event wakes Echo and resets the idle clock. */
  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    if (sleepingRef.current) {
      sleepingRef.current = false;
      setSleeping(false);
      setFace("idle");
    }
  }, []);

  // Real app events (echoEvents). The counter refreshes even while paused.
  useEffect(
    () =>
      onEcho((event: EchoEvent) => {
        if (event.type === "feed-changed") {
          setStatsKey((key) => key + 1);
          return;
        }
        markActive();
        if (pausedRef.current) return;
        switch (event.type) {
          case "saved":
            tick();
            play([
              { face: "chomp", ms: 600 },
              { face: "happy", ms: 1600 },
            ]);
            say(event.count === 1 ? `+1 ${clip(event.title)}` : `+${event.count} memories`);
            break;
          case "searching":
            play([{ face: "searching", ms: 1500 }]);
            break;
          case "found":
            play([{ face: event.count > 0 ? "happy" : "idle", ms: BUBBLE_MS }]);
            say(
              event.count === 0
                ? "No matches yet"
                : `Found ${event.count} ${event.count === 1 ? "match" : "matches"}`,
            );
            break;
          case "ask":
            play([{ face: "thinking", ms: ASK_HOLD_MS }]);
            break;
          case "answer":
            if (event.status === "ready") {
              play([{ face: "happy", ms: BUBBLE_MS }]);
              say(event.cited ? "Answer ready, with sources" : "Answer ready");
            } else if (event.status === "not_found") {
              play([{ face: "idle", ms: BUBBLE_MS }]);
              say("Not in your memory yet");
            } else {
              play([{ face: "idle", ms: 400 }]);
            }
            break;
          case "resurfaced":
            if (event.action === "revisit") {
              play([{ face: "love", ms: BUBBLE_MS }]);
              say("Good one to revisit");
            } else {
              play([{ face: "reading", ms: BUBBLE_MS }]);
              say("Maybe later");
            }
            break;
          case "navigate": {
            const reaction = NAV_REACTIONS[event.tab];
            if (reaction) {
              play([{ face: reaction.face, ms: BUBBLE_MS }]);
              say(reaction.line);
            }
            break;
          }
        }
      }),
    [markActive, play, say, tick],
  );

  // Any input wakes Echo.
  useEffect(() => {
    const options = { capture: true, passive: true } as const;
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, markActive, options);
    return () => {
      for (const name of events) window.removeEventListener(name, markActive, options);
    };
  }, [markActive]);

  // Stay above a docked composer (the Ask box) where it reaches the corner.
  const measureLift = useCallback(() => {
    const rect = document.querySelector<HTMLElement>("[data-echo-dock]")?.getBoundingClientRect();
    const overlaps = rect && rect.height > 0 && rect.right > window.innerWidth - 140;
    const nextLift = overlaps ? Math.max(0, window.innerHeight - rect.top) : 0;
    setLift((current) => (Math.abs(current - nextLift) > 2 ? nextLift : current));
  }, []);

  useEffect(() => {
    measureLift();
    window.addEventListener("resize", measureLift);
    return () => window.removeEventListener("resize", measureLift);
  }, [measureLift]);

  // One slow clock: sleep after 20s idle, a random face every ~4.5s while
  // awake and idle, and re-check the dock as views change. Skips hidden tabs.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      measureLift();

      if (pausedRef.current || reacting.current) return;
      const now = Date.now();
      if (!sleepingRef.current && now - lastActivity.current > SLEEP_AFTER_MS) {
        sleepingRef.current = true;
        setSleeping(true);
        setFace("sleeping");
        return;
      }
      if (!sleepingRef.current && now - lastRandomFace.current > RANDOM_FACE_EVERY_MS) {
        lastRandomFace.current = now;
        const pick = IDLE_FACES[Math.floor(Math.random() * IDLE_FACES.length)] ?? "happy";
        if (pick === "look") {
          const side = Math.random() < 0.5 ? -1 : 1;
          play([
            { face: "idle", ms: 700, look: { x: side, y: -0.3 } },
            { face: "idle", ms: 700, look: { x: -side, y: 0.2 } },
          ]);
        } else {
          play([{ face: pick, ms: 1200 }]);
        }
      }
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [measureLift, play]);

  // The counter flashes coral when the real total changes.
  useEffect(() => {
    if (total === null) return;
    if (previousTotal.current !== null && previousTotal.current !== total) {
      setFlashKey((key) => key + 1);
    }
    previousTotal.current = total;
  }, [total]);

  // Sound loads only after the user turns it on.
  useEffect(() => {
    if (!soundOn || paused || sound.current) return;
    let cancelled = false;
    void import("./echoSound").then(({ createEchoSound }) => {
      if (!cancelled && !sound.current) sound.current = createEchoSound();
    });
    return () => {
      cancelled = true;
    };
  }, [soundOn, paused]);

  useEffect(
    () => () => {
      window.clearTimeout(stepTimer.current);
      window.clearTimeout(bubbleTimer.current);
      sound.current?.close();
    },
    [],
  );

  function togglePause() {
    const next = !paused;
    setPaused(next);
    writeEchoPaused(next);
    window.clearTimeout(stepTimer.current);
    reacting.current = false;
    setBubble(null);
    setFace("idle");
    setLook(undefined);
    markActive();
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writeEchoSound(next);
    if (next) {
      void import("./echoSound").then(({ createEchoSound }) => {
        sound.current ??= createEchoSound();
        sound.current?.chime();
      });
    } else {
      sound.current?.close();
      sound.current = null;
    }
  }

  function handleEchoClick() {
    markActive();
    if (paused) return;
    tick();
    play([{ face: "giggle", ms: 900 }]);
    say(TIPS[tipIndex.current % TIPS.length] ?? "Press Ctrl K to search", 2200);
    tipIndex.current += 1;
  }

  return (
    <div
      data-echo-mode="corner"
      className={cx(
        "pointer-events-none fixed right-3 z-40 flex flex-col items-end gap-2 transition-[bottom] duration-200 sm:right-5",
        paused && "echo-paused",
      )}
      style={{ bottom: 12 + lift }}
    >
      <div className="echo-corner-enter flex items-end gap-2">
        {bubble ? (
          <p
            key={bubble.id}
            aria-hidden="true"
            className="echo-bubble mb-8 max-w-[220px] rounded-card border border-line bg-surface px-3 py-2 text-[15px] leading-snug text-fg shadow-pop"
          >
            {bubble.text}
          </p>
        ) : null}
        <div className="flex flex-col items-center gap-1">
          <div
            aria-hidden="true"
            onClick={handleEchoClick}
            className={cx("pointer-events-auto cursor-pointer", !paused && !sleeping && "echo-bob-small")}
          >
            <Echo
              state={face}
              size={76}
              arms
              still
              look={look}
              className="h-[60px] w-[60px] sm:h-[76px] sm:w-[76px]"
            />
          </div>
          {total !== null ? (
            <p
              key={flashKey}
              className={cx(
                "rounded-full px-2 font-mono text-xs tabular-nums text-muted",
                flashKey > 0 && "echo-count-flash",
              )}
            >
              {total} {total === 1 ? "memory" : "memories"}
            </p>
          ) : null}
        </div>
      </div>
      <EchoControls
        paused={paused}
        onTogglePause={togglePause}
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
    </div>
  );
}
