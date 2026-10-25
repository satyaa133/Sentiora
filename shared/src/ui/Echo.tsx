/**
 * Echo, Sentiora's mascot (DESIGN.md §4). One SVG, five states:
 *
 *   idle      popup ready state, resurfaced card (bobs gently)
 *   saving    capture in progress (raised, "o" mouth, dashed trail)
 *   happy     after save, next to AI answers
 *   faded     empty states, no results
 *   guarding  blocked / sensitive pages (coral shield)
 *
 * Colours come from tokens, so Echo inverts with the theme automatically.
 */
import { ECHO_BODY_PATH } from "./echoShape.js";

export type EchoState = "idle" | "saving" | "happy" | "faded" | "guarding";

export interface EchoProps {
  state?: EchoState;
  size?: number;
  /** Accessible name. Without it Echo is decorative and hidden from assistive tech. */
  title?: string;
  /** Disable the idle bob / save float (reduced motion is always respected). */
  still?: boolean;
  className?: string;
}

const FACE_STROKE = {
  fill: "none",
  stroke: "var(--surface)",
  strokeWidth: 3.5,
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

function Face({ state }: { state: EchoState }) {
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
          <path d="M44 58 Q50 50 56 58" {...FACE_STROKE} />
          <path d="M64 58 Q70 50 76 58" {...FACE_STROKE} />
          <path d="M52 69 Q60 76 68 69" {...FACE_STROKE} />
          <Cheeks />
        </>
      );
    case "faded":
      return (
        <>
          <path d="M44 56 Q50 61 56 56" {...FACE_STROKE} />
          <path d="M64 56 Q70 61 76 56" {...FACE_STROKE} />
        </>
      );
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
    case "idle":
    default:
      return (
        <>
          <g fill="var(--surface)">
            <ellipse cx={50} cy={56} rx={5} ry={7} />
            <ellipse cx={70} cy={56} rx={5} ry={7} />
          </g>
          <Cheeks />
        </>
      );
  }
}

export default function Echo({
  state = "idle",
  size = 64,
  title,
  still = false,
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

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={[motionClass, className].filter(Boolean).join(" ") || undefined}
      data-echo-state={state}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <g
        transform={state === "saving" ? "translate(0 -8)" : undefined}
        opacity={state === "faded" ? 0.35 : undefined}
      >
        <path d={ECHO_BODY_PATH} fill="var(--text)" />
        <Face state={state} />
      </g>
      {state === "saving" ? (
        <path
          d="M38 106 Q60 100 82 106"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="4 6"
        />
      ) : null}
      {state === "faded" ? (
        <path
          d="M86 26 h6 l-6 7 h6 M96 14 h8 l-8 9 h8"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
