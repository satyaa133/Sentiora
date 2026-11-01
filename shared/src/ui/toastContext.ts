import { createContext, useContext } from "react";

export type ToastTone = "default" | "success" | "error";

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Optional single action, e.g. { label: "Undo", onClick }. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Default 5000. */
  duration?: number;
}

export interface ToastApi {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
