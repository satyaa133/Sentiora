import { ECHO_BODY_PATH } from "./echoShape.js";

/** "inverse" draws the logo for graphite panels (bg-inverse). */
export type LogoTone = "default" | "inverse";

export interface LogoMarkProps {
  size?: number;
  /** Accessible name; decorative when omitted. */
  title?: string;
  tone?: LogoTone;
  className?: string;
}

/** Simplified Echo: body and eyes, no cheeks (DESIGN.md §4). */
export function LogoMark({
  size = 24,
  title,
  tone = "default",
  className,
}: LogoMarkProps) {
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
  const inverse = tone === "inverse";
  return (
    <svg
      viewBox="26 22 68 82"
      width={size}
      height={size}
      className={className}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <path d={ECHO_BODY_PATH} fill={inverse ? "var(--on-inverse)" : "var(--text)"} />
      <g fill={inverse ? "var(--inverse)" : "var(--surface)"}>
        <ellipse cx={50} cy={56} rx={6} ry={8} />
        <ellipse cx={70} cy={56} rx={6} ry={8} />
      </g>
    </svg>
  );
}

export interface LogoProps {
  /** Wordmark font size in px; the mark scales with it. */
  size?: number;
  /** Hide the wordmark and show the mark alone (it then carries the name). */
  markOnly?: boolean;
  tone?: LogoTone;
  className?: string;
}

/** Logo lockup: ghost mark + lowercase "sentiora" wordmark. */
export default function Logo({
  size = 22,
  markOnly = false,
  tone = "default",
  className,
}: LogoProps) {
  if (markOnly) {
    return (
      <LogoMark
        size={Math.round(size * 1.15)}
        title="Sentiora"
        tone={tone}
        className={className}
      />
    );
  }
  const textClass = tone === "inverse" ? "text-on-inverse" : "text-fg";
  return (
    <span
      className={["inline-flex items-center gap-2", textClass, className]
        .filter(Boolean)
        .join(" ")}
    >
      <LogoMark size={Math.round(size * 1.05)} tone={tone} />
      <span
        className="font-display font-bold leading-none"
        style={{ fontSize: size, letterSpacing: "-0.035em" }}
      >
        sentiora
      </span>
    </span>
  );
}
