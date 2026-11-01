import type { HTMLAttributes } from "react";

import { cx } from "./cx.js";

export type CardTone = "surface" | "raised" | "inverse";
export type CardPadding = "none" | "sm" | "md" | "lg";

const TONES: Record<CardTone, string> = {
  surface: "border border-line bg-surface text-fg",
  raised: "bg-raised text-fg",
  inverse: "border border-inverse-border bg-inverse text-on-inverse",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside" | "li";
  tone?: CardTone;
  padding?: CardPadding;
}

export function Card({
  as: Tag = "div",
  tone = "surface",
  padding = "md",
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx("rounded-card", TONES[tone], PADDING[padding], className)}
      {...rest}
    />
  );
}

/** Small uppercase mono label above headings ("RESURFACED · SAVED 6 WEEKS AGO"). */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cx("font-mono text-eyebrow uppercase text-muted", className)}
      {...rest}
    />
  );
}

/** Keyboard shortcut cap, e.g. <Kbd>Ctrl</Kbd><Kbd>K</Kbd>. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line bg-surface px-1.5 font-mono text-xs font-medium text-muted",
        className,
      )}
      {...rest}
    />
  );
}
