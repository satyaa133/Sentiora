import { Button, IconCheck, IconCopy, IconRefresh, IconSparkles, Skeleton } from "@shared/ui";
import type { FeedbackRating } from "../../../services/feedbackService";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { ModeBadge } from "./ModeBadge";
import { RatingButtons, type RatingState } from "./RatingButtons";
import { SourcesPanel } from "./SourcesPanel";
import { usedSourceList, type Explanation, type OpenMemory } from "./types";

interface ExplainSectionProps {
  explain: Explanation;
  onOpenMemory?: OpenMemory;
  /** Ask the AI again (busy, error, stopped). Disabled while anything answers. */
  onRetry: () => void;
  retryDisabled: boolean;
  onCopy: () => void;
  copied: boolean;
  rating?: RatingState;
  onRate: (rating: FeedbackRating) => void;
}

/** The written AI answer under an instant answer ("Explain with AI", S7). */
export function ExplainSection({
  explain,
  onOpenMemory,
  onRetry,
  retryDisabled,
  onCopy,
  copied,
  rating,
  onRate,
}: ExplainSectionProps) {
  const used = usedSourceList(explain);
  const busy = explain.status === "pending" || explain.status === "streaming";
  const retry = (
    <Button
      variant="secondary"
      size="sm"
      leadingIcon={<IconRefresh size={16} />}
      disabled={retryDisabled}
      onClick={onRetry}
    >
      Try again
    </Button>
  );

  return (
    <section
      aria-label="AI answer"
      aria-busy={busy}
      className="space-y-3 rounded-card border border-line bg-surface px-4 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-eyebrow uppercase text-muted">
          <IconSparkles size={14} />
          Explained with AI
        </span>
        {explain.status === "done" && explain.mode ? <ModeBadge mode={explain.mode} /> : null}
      </div>

      {explain.status === "pending" ? (
        <div role="status" className="space-y-2">
          <span className="text-[16px] text-muted">
            {explain.sources.length
              ? `Writing an answer from ${explain.sources.length} saved ${explain.sources.length === 1 ? "source" : "sources"}…`
              : "Writing an answer…"}
          </span>
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : null}

      {explain.text ? (
        <AnswerMarkdown
          text={explain.text}
          sources={explain.sources}
          onOpenMemory={onOpenMemory}
          streaming={explain.status === "streaming"}
        />
      ) : null}

      {explain.status === "busy" ? (
        <div role="alert" className="space-y-3 rounded-btn bg-raised px-4 py-3">
          <p className="text-[16px] text-fg">
            {`Echo's AI is busy answering other questions. Try again in ${explain.retryAfter ?? 10} seconds. The quoted answer above still stands.`}
          </p>
          {retry}
        </div>
      ) : null}

      {explain.status === "error" ? (
        <div role="alert" className="space-y-3 rounded-btn bg-accent-soft px-4 py-3">
          <p className="text-[16px] text-accent-soft-fg">{explain.error}</p>
          {retry}
        </div>
      ) : null}

      {explain.status === "stopped" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-eyebrow uppercase text-muted">Stopped</p>
          {retry}
        </div>
      ) : null}

      {explain.status === "done" && used.length > 0 ? (
        <SourcesPanel sources={used} onOpenMemory={onOpenMemory} defaultOpen={false} />
      ) : null}

      {explain.status === "done" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            onClick={onCopy}
          >
            {copied ? "Copied" : "Copy AI answer"}
          </Button>
          <RatingButtons label="Rate the AI answer" value={rating} onRate={onRate} />
        </div>
      ) : null}
    </section>
  );
}
