import { useId } from "react";
import type { ReactNode } from "react";

import { cx } from "./cx.js";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; also the switch's accessible name. */
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** On/off switch (role="switch") with a visible label. The whole row is clickable. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
  className,
}: ToggleProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  return (
    <div
      className={cx("flex min-h-touch items-center justify-between gap-4", className)}
    >
      <span className="min-w-0">
        <label
          htmlFor={switchId}
          className="block cursor-pointer text-[15px] font-medium text-fg"
        >
          {label}
        </label>
        {description ? (
          <span id={`${switchId}-desc`} className="mt-0.5 block text-sm text-muted">
            {description}
          </span>
        ) : null}
      </span>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${switchId}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "border-accent bg-accent" : "border-line bg-raised",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "inline-block h-5 w-5 rounded-full transition-transform",
            checked ? "translate-x-[22px] bg-on-accent" : "translate-x-[3px] bg-muted",
          )}
        />
      </button>
    </div>
  );
}
