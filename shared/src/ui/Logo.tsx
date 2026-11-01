import type { CSSProperties } from "react";

import { cx } from "./cx.js";
import { useLogoWave } from "./useLogoWave.js";

/** "inverse" draws the logo for graphite panels (bg-inverse). */
export type LogoTone = "default" | "inverse";

/** The wordmark's letters; index 4 is the dotless ı that carries the coral dot. */
const LETTERS = ["s", "e", "n", "t", "ı", "o", "r", "a"] as const;
const DOT_INDEX = 4;

export interface LogoMarkProps {
  size?: number;
  /** Accessible name; decorative when omitted. */
  title?: string;
  tone?: LogoTone;
  className?: string;
}

/** Compact mark: the dotless ı with its coral dot (DESIGN.md §13). */
export function LogoMark({
  size = 24,
  title,
  tone = "default",
  className,
}: LogoMarkProps) {
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
  return (
    <svg
      viewBox="0 0 24 32"
      width={(size * 24) / 32}
      height={size}
      className={className}
      data-logo-mark=""
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x={8}
        y={13}
        width={8}
        height={19}
        rx={1.5}
        fill={tone === "inverse" ? "var(--on-inverse)" : "var(--text)"}
      />
      <circle cx={12} cy={5.5} r={5.5} fill="var(--accent)" />
    </svg>
  );
}

export interface LogoProps {
  /** Wordmark font size in px. */
  size?: number;
  /** Show the compact mark alone (it then carries the name). */
  markOnly?: boolean;
  tone?: LogoTone;
  /** Wave the letters on load, every 10s and on hover. On by default. */
  animated?: boolean;
  className?: string;
}

/** Wordmark "sentiora" whose ı is dotted with a coral circle (DESIGN.md §13). */
export default function Logo({
  size = 22,
  markOnly = false,
  tone = "default",
  animated = true,
  className,
}: LogoProps) {
  const { ref, waving, wave } = useLogoWave<HTMLSpanElement>(animated && !markOnly);

  if (markOnly) {
    return (
      <LogoMark
        size={Math.round(size * 1.3)}
        title="sentiora"
        tone={tone}
        className={className}
      />
    );
  }

  return (
    <span
      ref={ref}
      role="img"
      aria-label="sentiora"
      onMouseEnter={wave}
      className={cx(
        "logo-wordmark",
        waving && "logo-waving",
        tone === "inverse" ? "text-on-inverse" : "text-fg",
        className,
      )}
      style={{ fontSize: size }}
    >
      {LETTERS.map((letter, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cx("logo-letter", i === DOT_INDEX && "logo-i")}
          style={{ "--logo-i": i } as CSSProperties}
        >
          {letter}
          {i === DOT_INDEX ? <span className="logo-dot" data-logo-dot="" /> : null}
        </span>
      ))}
    </span>
  );
}
