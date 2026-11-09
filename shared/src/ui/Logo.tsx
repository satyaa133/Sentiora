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

/** Compact mark: the "S" logo with its coral dot. */
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
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      data-logo-mark=""
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M 22 11 C 22 8.5 19.5 7 16 7 C 12.5 7 10 9 10 11.5 C 10 14.5 12.5 15.5 16 16.5 C 19.5 17.5 22 18.5 22 21 C 22 23.5 19.5 25 16 25 C 12 25 10 23 10 20.5"
        fill="none"
        stroke={tone === "inverse" ? "var(--on-inverse)" : "var(--text)"}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="7.5" r="2" fill="var(--accent)" />
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
