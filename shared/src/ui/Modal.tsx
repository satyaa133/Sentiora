import { useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "./Button.js";
import { cx } from "./cx.js";
import { IconClose } from "./icons.js";
import { useDialogBehavior, usePortalContainer } from "./overlay.js";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row, right-aligned on wide screens, stacked on phones. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  initialFocusRef?: RefObject<HTMLElement>;
}

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  initialFocusRef,
}: ModalProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const container = usePortalContainer();
  useDialogBehavior(open, onClose, dialogRef, initialFocusRef);

  if (!open || !container) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cx(
          "echo-float relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-panel border border-line bg-surface text-fg shadow-float",
          SIZES[size],
        )}
      >
        <div className="flex items-start gap-4 px-6 pb-2 pt-6">
          <div className="min-w-0 flex-1">
            <h2
              id={`${id}-title`}
              className="font-display text-xl font-bold tracking-tight"
            >
              {title}
            </h2>
            {description ? (
              <p id={`${id}-desc`} className="mt-1 text-[15px] text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            label="Close"
            icon={<IconClose />}
            onClick={onClose}
            className="-mr-2 -mt-2"
          />
        </div>
        {children ? <div className="overflow-y-auto px-6 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line-soft px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    container,
  );
}
