import { forwardRef, useId } from "react";
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import { cx } from "./cx.js";

const CONTROL =
  "w-full rounded-btn border bg-surface text-base text-fg transition-colors placeholder:text-muted hover:border-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx("block text-[15px] font-semibold text-fg", className)}
      {...rest}
    />
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Icon shown inside the left edge (decorative). */
  leadingIcon?: ReactNode;
  /** Content inside the right edge, e.g. a Kbd hint or show-password button. */
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, leadingIcon, trailing, className, ...rest },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        CONTROL,
        "h-11 px-3.5",
        invalid ? "border-accent" : "border-line",
        leadingIcon ? "pl-11" : null,
        trailing ? "pr-12" : null,
        className,
      )}
      {...rest}
    />
  );
  if (!leadingIcon && !trailing) return control;
  return (
    <div className="relative">
      {leadingIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">
          {leadingIcon}
        </span>
      ) : null}
      {control}
      {trailing ? (
        <span className="absolute inset-y-0 right-1.5 flex items-center">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid = false, rows = 4, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cx(
          CONTROL,
          "min-h-[96px] resize-y px-3.5 py-3 leading-relaxed",
          invalid ? "border-accent" : "border-line",
          className,
        )}
        {...rest}
      />
    );
  },
);

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

function FieldShell({ id, label, hint, error, children, className }: FieldShellProps) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[15px] text-link">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[15px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: ReactNode, error: ReactNode, extra?: string) {
  const own = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return [own, extra].filter(Boolean).join(" ") || undefined;
}

export interface TextFieldProps extends Omit<InputProps, "invalid"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

/** Label + input + hint/error, wired together with ids. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { label, hint, error, id, fieldClassName, "aria-describedby": extra, ...rest },
    ref,
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <FieldShell
        id={inputId}
        label={label}
        hint={hint}
        error={error}
        className={fieldClassName}
      >
        <Input
          ref={ref}
          id={inputId}
          invalid={Boolean(error)}
          aria-describedby={describedBy(inputId, hint, error, extra)}
          {...rest}
        />
      </FieldShell>
    );
  },
);

export interface TextAreaFieldProps extends Omit<TextareaProps, "invalid"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    { label, hint, error, id, fieldClassName, "aria-describedby": extra, ...rest },
    ref,
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <FieldShell
        id={inputId}
        label={label}
        hint={hint}
        error={error}
        className={fieldClassName}
      >
        <Textarea
          ref={ref}
          id={inputId}
          invalid={Boolean(error)}
          aria-describedby={describedBy(inputId, hint, error, extra)}
          {...rest}
        />
      </FieldShell>
    );
  },
);
