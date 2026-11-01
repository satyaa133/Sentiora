import { cx } from "@shared/ui";
import type { StreamMode } from "../../../services/askStream";

const LABELS: Record<StreamMode, string> = {
  memory: "From your memory",
  general: "General knowledge",
  mixed: "Mixed: memory + general",
};

interface ModeBadgeProps {
  mode: StreamMode;
  usedFallback?: boolean;
}

/** One small label for where an answer came from (instead of separate sections). */
export function ModeBadge({ mode, usedFallback = false }: ModeBadgeProps) {
  const label = usedFallback ? "From your memory · AI model unavailable" : LABELS[mode];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-eyebrow uppercase",
        mode === "general" ? "bg-raised text-muted" : "bg-accent-soft text-accent-soft-fg",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          mode === "general" ? "bg-muted" : mode === "mixed" ? "bg-fg" : "bg-accent",
        )}
      />
      {label}
    </span>
  );
}
