import type { ReactNode } from "react";

import { cx } from "./cx.js";
import { IconMonitor, IconMoon, IconSun } from "./icons.js";
import type { ThemePreference } from "./theme.js";
import { useThemePreference } from "./useThemePreference.js";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: "system", label: "System", icon: <IconMonitor size={16} /> },
  { value: "light", label: "Light", icon: <IconSun size={16} /> },
  { value: "dark", label: "Dark", icon: <IconMoon size={16} /> },
];

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

export interface ThemeToggleProps {
  /** "segmented" shows System / Light / Dark; "icon" is a single cycling button. */
  variant?: "segmented" | "icon";
  className?: string;
}

export function ThemeToggle({ variant = "segmented", className }: ThemeToggleProps) {
  const { preference, resolved, setPreference } = useThemePreference();

  if (variant === "icon") {
    const current =
      OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0]!;
    const next = OPTIONS.find((option) => option.value === NEXT[preference])!;
    return (
      <button
        type="button"
        onClick={() => setPreference(next.value)}
        aria-label={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}.`}
        title={`Theme: ${current.label}`}
        className={cx(
          "inline-flex h-11 w-11 items-center justify-center rounded-btn text-muted transition-colors hover:bg-raised hover:text-fg",
          className,
        )}
      >
        {preference === "system" ? (
          <IconMonitor size={20} />
        ) : resolved === "dark" ? (
          <IconMoon size={20} />
        ) : (
          <IconSun size={20} />
        )}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cx("inline-flex gap-1 rounded-full bg-raised p-1", className)}
    >
      {OPTIONS.map((option) => {
        const checked = option.value === preference;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={checked}
            onClick={() => setPreference(option.value)}
            className={cx(
              "touch-target inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
              checked ? "bg-surface text-fg shadow-pop" : "text-muted hover:text-fg",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
