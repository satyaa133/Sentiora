import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { cx } from "./cx.js";
import { IconAlert, IconCheck, IconClose, IconInfo } from "./icons.js";
import { usePortalContainer } from "./overlay.js";
import { ToastContext } from "./toastContext.js";
import type { ToastApi, ToastOptions, ToastTone } from "./toastContext.js";

interface ToastEntry extends ToastOptions {
  id: string;
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  default: <IconInfo size={18} />,
  success: <IconCheck size={18} />,
  error: <IconAlert size={18} />,
};

/** Hosts toasts for its subtree. Use useToast() to show one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);
  const container = usePortalContainer();

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current.slice(-2), { ...options, id }]);
      const duration = options.duration ?? 5000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {container
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
            >
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  className="echo-float pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card bg-inverse py-3 pl-4 pr-2 text-on-inverse shadow-float"
                >
                  <span
                    className={cx(
                      "shrink-0",
                      toast.tone === "default" || !toast.tone
                        ? "text-on-inverse-muted"
                        : "text-accent",
                    )}
                  >
                    {TONE_ICON[toast.tone ?? "default"]}
                  </span>
                  <p className="min-w-0 flex-1 text-[15px]">{toast.message}</p>
                  {toast.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        toast.action?.onClick();
                        dismiss(toast.id);
                      }}
                      className="h-9 shrink-0 rounded-btn px-3 text-[15px] font-semibold text-accent underline-offset-4 hover:underline"
                    >
                      {toast.action.label}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => dismiss(toast.id)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-on-inverse-muted hover:text-on-inverse"
                  >
                    <IconClose size={16} />
                  </button>
                </div>
              ))}
            </div>,
            container,
          )
        : null}
    </ToastContext.Provider>
  );
}
