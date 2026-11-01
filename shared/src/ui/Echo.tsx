/**
 * Echo, Sentiora's mascot (DESIGN.md §4, §8.3). One SVG, many states:
 *
 *   idle       popup ready state, resurfaced card (bobs gently)
 *   saving     capture in progress (raised, "o" mouth, dashed trail)
 *   happy      after save, next to AI answers
 *   faded      empty states, no results
 *   guarding   blocked / sensitive pages (coral shield)
 *   searching  looking through memories (magnifier)
 *   thinking   working on an answer (thought dots)
 *   reading    an open book
 *   love       a coral heart
 *   sleeping   dozing ("z z")
 *   chomp      eating a memory (wide-open mouth)
 *   scared     startled (wide eyes, wobbly mouth)
 *   giggle     laughing (open grin)
 *
 * Colours come from tokens, so Echo inverts with the theme automatically.
 */
import type { CSSProperties, ReactNode } from "react";

import { ECHO_BODY_PATH, type EchoState } from "./echoShape.js";

export type { EchoState };

/** Where Echo looks, each axis in -1..1 (eyes or pupils shift a few units). */
export interface EchoLook {
  x: number;
  y: number;
}

export interface EchoProps {
  state?: EchoState;
  size?: number;
  /** Accessible name. Without it Echo is decorative and hidden from assistive tech. */
  title?: string;
  /** Disable the idle bob / save float (reduced motion is always respected). */
  still?: boolean;
  /** "inverse" draws Echo for graphite panels (bg-inverse): light body, dark face. */
  tone?: "default" | "inverse";
  /** Two small arms at the sides (the companion; DESIGN.md §8.3). */
  arms?: boolean;
  /** Eye direction, e.g. toward the cursor. */
  look?: EchoLook;
  className?: string;
}

// Echo is drawn with --text (body) and --surface (face); the inverse tone remaps
// both for this SVG only.
const INVERSE_TONE = {
  "--text": "var(--on-inverse)",
  "--surface": "var(--inverse)",
} as CSSProperties;

const FACE_STROKE = {
  fill: "none",
  stroke: "var(--surface)",
  strokeWidth: 3.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const PROP_STROKE = {
  fill: "none",
  stroke: "var(--accent)",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Cheeks() {
  return (
    <g fill="var(--accent)">
      <circle cx={42} cy={68} r={4} />
      <circle cx={78} cy={68} r={4} />
    </g>
  );
}

/** Light eye whites with dark pupils, offset by `look`; used by the alert states. */
function WideEyes({ look, ry = 8, pupil = 2.6 }: { look: EchoLook; ry?: number; pupil?: number }) {
  const dx = look.x * 2;
  const dy = look.y * 2.5;
  return (
    <g className="echo-eyes">
      <g fill="var(--surface)">
        <ellipse cx={50} cy={55} rx={6} ry={ry} />
        <ellipse cx={70} cy={55} rx={6} ry={ry} />
      </g>
      <g fill="var(--text)">
        <circle cx={50 + dx} cy={55 + dy} r={pupil} />
        <circle cx={70 + dx} cy={55 + dy} r={pupil} />
      </g>
    </g>
  );
}

const ClosedEyes = () => (
  <>
    <path d="M44 56 Q50 61 56 56" {...FACE_STROKE} />
    <path d="M64 56 Q70 61 76 56" {...FACE_STROKE} />
  </>
);

const ArcEyes = () => (
  <>
    <path d="M44 58 Q50 50 56 58" {...FACE_STROKE} />
    <path d="M64 58 Q70 50 76 58" {...FACE_STROKE} />
  </>
);

const Smile = () => <path d="M52 69 Q60 76 68 69" {...FACE_STROKE} />;

function Face({ state, look }: { state: EchoState; look: EchoLook }) {
  switch (state) {
    case "saving":
      return (
        <>
          <g fill="var(--surface)">
            <circle cx={50} cy={55} r={5} />
            <circle cx={70} cy={55} r={5} />
            <circle cx={60} cy={69} r={3} />
          </g>
          <Cheeks />
        </>
      );
    case "happy":
      return (
        <>
          <ArcEyes />
          <Smile />
          <Cheeks />
        </>
      );
    case "faded":
    case "sleeping":
      return <ClosedEyes />;
    case "guarding":
      return (
        <>
          <g fill="var(--surface)">
            <circle cx={50} cy={50} r={4} />
            <circle cx={70} cy={50} r={4} />
          </g>
          <path
            d="M60 60 L75 65.5 V75 C75 84.5 68.5 90.5 60 94 C51.5 90.5 45 84.5 45 75 V65.5 Z"
            fill="var(--accent)"
          />
          <path
            d="M53 76.5 L58 81.5 L67.5 71"
            fill="none"
            stroke="var(--on-accent)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "searching":
      return (
        <>
          <WideEyes look={{ x: 0.6 + look.x * 0.4, y: -0.5 + look.y * 0.3 }} />
          <circle cx={60} cy={71} r={3.2} fill="var(--surface)" />
          <Cheeks />
        </>
      );
    case "thinking":
      return (
        <>
          <WideEyes look={{ x: 0.7, y: -0.8 }} />
          <path d="M55 72 L65 71" {...FACE_STROKE} />
          <Cheeks />
        </>
      );
    case "reading":
      return (
        <>
          <ClosedEyes />
          <path d="M54 68 Q60 72 66 68" {...FACE_STROKE} />
          <Cheeks />
        </>
      );
    case "love":
      return (
        <>
          <ArcEyes />
          <Smile />
          <Cheeks />
        </>
      );
    case "chomp":
      return (
        <>
          <ArcEyes />
          <ellipse
            className="echo-chomp-mouth"
            cx={60}
            cy={71}
            rx={8}
            ry={7}
            fill="var(--surface)"
          />
          <Cheeks />
        </>
      );
    case "scared":
      return (
        <>
          <WideEyes look={look} ry={9} pupil={1.8} />
          <path d="M51 73 Q54.5 70 58 73 Q61.5 76 65 73 Q67 71.5 69 73" {...FACE_STROKE} />
        </>
      );
    case "giggle":
      return (
        <>
          <ArcEyes />
          <path d="M51 66 H69 Q69 77 60 77 Q51 77 51 66 Z" fill="var(--surface)" />
          <Cheeks />
        </>
      );
    case "idle":
    default:
      return (
        <>
          <g fill="var(--surface)" className="echo-eyes">
            <ellipse cx={50 + look.x * 2.5} cy={56 + look.y * 2.5} rx={5} ry={7} />
            <ellipse cx={70 + look.x * 2.5} cy={56 + look.y * 2.5} rx={5} ry={7} />
          </g>
          <Cheeks />
        </>
      );
  }
}

/** Props drawn over or beside the body (DESIGN.md §8.3). */
function StateProp({ state }: { state: EchoState }): ReactNode {
  switch (state) {
    case "saving":
      return (
        <path
          d="M38 106 Q60 100 82 106"
          {...PROP_STROKE}
          strokeWidth={3}
          strokeDasharray="4 6"
        />
      );
    case "faded":
    case "sleeping":
      return (
        <path
          d="M86 26 h6 l-6 7 h6 M96 14 h8 l-8 9 h8"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "searching":
      return (
        <g className="echo-prop-search">
          <circle cx={84} cy={80} r={10} {...PROP_STROKE} strokeWidth={4.5} />
          <path d="M91.5 87.5 L101 97" {...PROP_STROKE} strokeWidth={5} />
        </g>
      );
    case "thinking":
      return (
        <g fill="var(--accent)" className="echo-prop-think">
          <circle cx={92} cy={34} r={3.5} />
          <circle cx={101} cy={23} r={5.5} />
          <circle cx={97} cy={10} r={3} opacity={0.6} />
        </g>
      );
    case "reading":
      return (
        <g>
          <path
            d="M36 80 L60 76 L84 80 L84 99 L60 95 L36 99 Z"
            fill="var(--surface)"
            stroke="var(--text)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <path d="M60 76 V95" stroke="var(--text)" strokeWidth={2} />
          <path
            d="M42 84 L54 82 M42 89 L54 87 M66 82 L78 84 M66 87 L78 89"
            {...PROP_STROKE}
            strokeWidth={2.2}
          />
        </g>
      );
    case "love":
      return (
        <path
          className="echo-prop-heart"
          d="M98 30 C98 24 90 22 88 28 C86 22 78 24 78 30 C78 37 88 42 88 42 C88 42 98 37 98 30 Z"
          fill="var(--accent)"
        />
      );
    default:
      return null;
  }
}

function Arms({ state }: { state: EchoState }) {
  // Holding the book: arms reach forward; otherwise they rest at the sides.
  const holding = state === "reading";
  const raised = state === "happy" || state === "giggle" || state === "love" || state === "scared";
  const left = holding
    ? "M32 72 Q34 82 40 86"
    : raised
      ? "M31 66 Q22 60 19 52"
      : "M31 70 Q22 75 20 83";
  const right = holding
    ? "M88 72 Q86 82 80 86"
    : raised
      ? "M89 66 Q98 60 101 52"
      : "M89 70 Q98 75 100 83";
  return (
    <g fill="none" stroke="var(--text)" strokeWidth={6} strokeLinecap="round">
      <path className="echo-arm-left" d={left} />
      <path className="echo-arm-right" d={right} />
    </g>
  );
}

const NO_LOOK: EchoLook = { x: 0, y: 0 };

export default function Echo({
  state = "idle",
  size = 64,
  title,
  still = false,
  tone = "default",
  arms = false,
  look = NO_LOOK,
  className,
}: EchoProps) {
  const motionClass = still
    ? ""
    : state === "idle"
      ? "echo-bob"
      : state === "saving" || state === "happy"
        ? "echo-float"
        : "";
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
  const dim = state === "faded" || state === "sleeping";

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      overflow="visible"
      className={[motionClass, className].filter(Boolean).join(" ") || undefined}
      data-echo-state={state}
      style={tone === "inverse" ? INVERSE_TONE : undefined}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <g
        transform={state === "saving" ? "translate(0 -8)" : undefined}
        opacity={dim ? 0.35 : state === "scared" ? 0.6 : undefined}
      >
        {arms && state !== "reading" ? <Arms state={state} /> : null}
        <path d={ECHO_BODY_PATH} fill="var(--text)" />
        <Face state={state} look={look} />
        {arms && state === "reading" ? <Arms state={state} /> : null}
      </g>
      <StateProp state={state} />
    </svg>
  );
}
