import { Echo } from "@shared/ui";

/** Shown while the session is being checked. */
export default function FullPageLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-fg"
    >
      <Echo state="idle" size={64} />
      <span className="text-[15px] text-muted">Loading Sentiora</span>
    </div>
  );
}
