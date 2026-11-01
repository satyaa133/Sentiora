import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { BUTTON_VARIANTS, buttonClasses } from "./buttonStyles.js";
import type { ButtonSize, ButtonVariant } from "./buttonStyles.js";
import { cx } from "./cx.js";
import { IconLoader } from "./icons.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    loading = false,
    fullWidth = false,
    disabled,
    type = "button",
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClasses(variant, size, fullWidth), className)}
      {...rest}
    >
      {loading ? <IconLoader size={18} className="animate-spin" /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

const ICON_SIZES = { sm: "touch-target h-9 w-9", md: "h-11 w-11" } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon,
      variant = "ghost",
      size = "md",
      type = "button",
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-btn transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          BUTTON_VARIANTS[variant],
          variant === "ghost" && "text-muted hover:text-fg",
          ICON_SIZES[size],
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
