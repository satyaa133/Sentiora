import { createContext, useContext, useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Where Modal, Drawer and Toast portal to. Defaults to document.body; a subtree with
 * its own data-theme (the /dev/components panels) can provide a container inside it
 * so overlays inherit that theme.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  const container = useContext(PortalContainerContext);
  return container ?? (typeof document === "undefined" ? null : document.body);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog behaviour: moves focus in on open, traps Tab, closes on Escape,
 * locks page scroll and restores focus to the trigger on close.
 */
export function useDialogBehavior(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement>,
  initialFocusRef?: RefObject<HTMLElement>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (initialFocusRef?.current ?? firstFocusable ?? dialog).focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, dialogRef, initialFocusRef]);
}
