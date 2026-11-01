import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.js";
import { IconClose, IconPlus } from "./icons.js";

export interface ChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed"
> {
  /** Selected chips flip to the text colour (graphite in light, paper in dark) and expose aria-pressed. */
  selected?: boolean;
  leadingIcon?: ReactNode;
}

/** Filter chip: a toggle button shaped as a pill. */
export function Chip({
  selected = false,
  leadingIcon,
  type = "button",
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "touch-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-colors",
        selected
          ? "border border-fg bg-fg text-bg"
          : "border border-line bg-surface text-fg hover:bg-raised",
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

export interface TagProps {
  children: ReactNode;
  /** When set, shows a remove button labelled "Remove tag {children}". */
  onRemove?: () => void;
  className?: string;
}

/** Coral-soft label for user tags and small status markers. */
export function Tag({ children, onRemove, className }: TagProps) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft text-sm font-medium text-accent-soft-fg",
        onRemove ? "pl-3 pr-1" : "px-3",
        className,
      )}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${typeof children === "string" ? children : ""}`.trim()}
          className="touch-target inline-flex h-5 w-5 items-center justify-center rounded-full hover:opacity-70"
        >
          <IconClose size={14} />
        </button>
      ) : null}
    </span>
  );
}

/** Dashed "+ tag" button that sits after a row of tags. */
export function AddTagButton({
  className,
  children = "tag",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line px-3 text-sm font-medium text-muted transition-colors hover:border-muted hover:text-fg",
        className,
      )}
      {...rest}
    >
      <IconPlus size={14} />
      {children}
    </button>
  );
}
