import { cx } from "./cx.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-fg hover:bg-raised",
  ghost: "bg-transparent text-fg hover:bg-raised",
  inverse: "bg-inverse text-on-inverse hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-3 text-sm",
  md: "h-11 gap-2 px-4 text-[15px]",
  lg: "h-[52px] gap-2 px-6 text-base",
};

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-btn font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** Button look for elements that are not <Button>, e.g. a router <Link>. */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  fullWidth = false,
): string {
  return cx(BASE, BUTTON_VARIANTS[variant], SIZES[size], fullWidth && "w-full");
}
