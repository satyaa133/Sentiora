import { useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "./Button.js";
import { IconClose } from "./icons.js";
import { useDialogBehavior, usePortalContainer } from "./overlay.js";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Small line above the title (e.g. source type and date). */
  eyebrow?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement>;
}

/** Right-hand side panel (full width on phones), e.g. the memory detail view. */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  initialFocusRef,
}: DrawerProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const container = usePortalContainer();
  useDialogBehavior(open, onClose, panelRef, initialFocusRef);

  if (!open || !container) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className="drawer-in relative flex h-full w-full max-w-[520px] flex-col border-l border-line bg-surface text-fg shadow-float"
      >
        <div className="flex items-start gap-4 border-b border-line-soft px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <div className="mb-1 font-mono text-eyebrow uppercase text-muted">
                {eyebrow}
              </div>
            ) : null}
            <h2
              id={`${id}-title`}
              className="font-display text-xl font-bold leading-snug tracking-tight"
            >
              {title}
            </h2>
          </div>
          <IconButton
            label="Close"
            icon={<IconClose />}
            onClick={onClose}
            className="-mr-2"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>
        {footer ? (
          <div className="flex flex-wrap gap-2 border-t border-line-soft px-5 py-4 sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    container,
  );
}
