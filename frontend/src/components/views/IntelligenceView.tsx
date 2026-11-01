import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Chip,
  Echo,
  IconArrowUp,
  IconMessage,
  Input,
  MemoryList,
  MemoryRow,
  Tag,
} from "@shared/ui";
import EmptyState from "../EmptyState";
import MemoryFeedSkeleton from "../MemoryFeedSkeleton";
import type { TimelinePreset } from "./MemoryTimelineView";
import { useStatistics } from "../../hooks/useStatistics";
import type { AskScope } from "../../services/askService";
import type { MemoryItem, SourceType } from "../../types/memory";
import { dayLabel } from "../../utils/dates";

interface IntelligenceViewProps {
  items: MemoryItem[];
  isLoading: boolean;
  loadError: string | null;
  refreshKey?: string;
  onRetry: () => void;
  /** Open Ask with a question; `send` asks right away instead of pre-filling. */
  onAsk: (question: string, options?: { scope?: AskScope; send?: boolean }) => void;
  onOpenTimeline: (preset: TimelinePreset) => void;
  onSelectItem: (item: MemoryItem) => void;
}

const SOURCE_LABELS: Record<SourceType, { singular: string; plural: string }> = {
  webpage: { singular: "web page", plural: "web pages" },
  pdf: { singular: "PDF", plural: "PDFs" },
  youtube: { singular: "video", plural: "videos" },
};

function clip(title: string, limit = 44) {
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

/** Overview of what memory holds, what needs attention, and what to ask. */
export default function IntelligenceView({
  items,
  isLoading,
  loadError,
  refreshKey = "",
  onRetry,
  onAsk,
  onOpenTimeline,
  onSelectItem,
}: IntelligenceViewProps) {
  const [question, setQuestion] = useState("");
  const { stats } = useStatistics(refreshKey);

  const recent = useMemo(
    () =>
      [...items]
        .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
        .slice(0, 5),
    [items],
  );
  const attention = useMemo(
    () => items.filter((item) => item.status !== "ready").slice(0, 5),
    [items],
  );
  const ready = useMemo(() => items.filter((item) => item.status === "ready"), [items]);

  // Suggestions come from what is actually saved, never from a template list.
  const suggestions = useMemo(() => {
    const list: { question: string; scope?: AskScope }[] = [];
    if (ready[0]) list.push({ question: `Summarize “${clip(ready[0].title)}”` });
    if (ready[1]) list.push({ question: `What are the key ideas in “${clip(ready[1].title)}”?` });
    if (stats && stats.this_week > 0) list.push({ question: "What did I capture this week?" });
    const topSource = stats
      ? (Object.entries(stats.by_source_type) as [SourceType, number][])
          .filter(([, count]) => count > 1)
          .sort((a, b) => b[1] - a[1])[0]
      : undefined;
    if (topSource) {
      const { plural } = SOURCE_LABELS[topSource[0]];
      list.push({
        question: "Summarize my latest saves",
        scope: { sourceType: topSource[0], label: `Your ${plural}` },
      });
    }
    return list;
  }, [ready, stats]);

  function handleAsk(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    onAsk(question.trim(), { send: true });
    setQuestion("");
  }

  if (isLoading) return <MemoryFeedSkeleton />;
  if (loadError) {
    return (
      <EmptyState
        title="Could not load your memories"
        body={loadError}
        action={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  const overview = stats
    ? [
        `${stats.total} ${stats.total === 1 ? "memory" : "memories"}`,
        `${stats.ready_for_ai} ready for Ask`,
        stats.this_week > 0 ? `${stats.this_week} saved this week` : null,
        stats.last_captured_at ? `last capture ${dayLabel(stats.last_captured_at).toLowerCase()}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="space-y-8">
      <Card as="section" aria-labelledby="ask-echo-heading" padding="lg">
        <div className="flex items-start gap-4">
          <Echo state={ready.length > 0 ? "idle" : "faded"} size={48} still className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id="ask-echo-heading" className="text-[18px] font-semibold text-fg">
              Ask Echo
            </h2>
            <p className="mt-0.5 text-[15px] text-muted">
              {overview ?? "Ask about anything you've saved, or a general question."}
            </p>
            <form onSubmit={handleAsk} className="mt-4 flex gap-2">
              <label htmlFor="intelligence-ask" className="sr-only">
                Ask Echo a question
              </label>
              <Input
                id="intelligence-ask"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What did I save about…"
                className="flex-1"
              />
              <Button type="submit" aria-label="Ask Echo" disabled={!question.trim()}>
                <IconArrowUp size={18} />
              </Button>
            </form>
            {suggestions.length > 0 ? (
              <div role="group" aria-label="Suggested questions" className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <Chip
                    key={suggestion.question + (suggestion.scope?.label ?? "")}
                    onClick={() => onAsk(suggestion.question, { scope: suggestion.scope, send: true })}
                  >
                    {suggestion.scope ? `${suggestion.scope.label}: summarize` : suggestion.question}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Save a page, PDF or video with the extension. Echo can still answer general questions."
        />
      ) : (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <section aria-labelledby="recent-heading">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="recent-heading" className="text-[17px] font-semibold text-fg">
                Recent captures
              </h2>
              <button
                type="button"
                onClick={() => onOpenTimeline({})}
                className="touch-target text-[15px] font-semibold text-link hover:underline"
              >
                Open Timeline
              </button>
            </div>
            <MemoryList>
              {recent.map((item) => (
                <MemoryRow
                  key={item.id}
                  title={item.title}
                  sourceType={item.source_type}
                  snippet={item.domain}
                  dateLabel={dayLabel(item.captured_at)}
                  dateTime={item.captured_at}
                  onSelect={() => onSelectItem(item)}
                  actions={
                    item.status === "ready" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={<IconMessage size={16} />}
                        aria-label={`Ask Echo about ${item.title}`}
                        onClick={() =>
                          onAsk(`What is “${clip(item.title)}” about?`, {
                            scope: { memoryId: item.id, label: item.title },
                          })
                        }
                      >
                        Ask
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </MemoryList>
          </section>

          <div className="space-y-8">
            <section aria-labelledby="attention-heading">
              <h2 id="attention-heading" className="mb-3 text-[17px] font-semibold text-fg">
                Needs attention
              </h2>
              {attention.length === 0 ? (
                <p className="rounded-card border border-line bg-surface px-4 py-3 text-[15px] text-muted">
                  Every capture is indexed and ready for Ask.
                </p>
              ) : (
                <ul className="divide-y divide-line-soft rounded-card border border-line bg-surface">
                  {attention.map((item) => (
                    <li key={item.id} className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onSelectItem(item)}
                        className="block w-full text-left"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold text-fg">{item.title}</span>
                          <Tag>{item.status === "failed" ? "Failed" : "Indexing"}</Tag>
                        </span>
                        <span className="mt-0.5 block text-[15px] text-muted">
                          {item.status === "failed"
                            ? item.processing_error || "Processing failed, so Ask can't use it."
                            : "Not searchable yet. It will be ready shortly."}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {stats && stats.by_status.failed > 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenTimeline({ status: "failed" })}
                  className="mt-2 text-[15px] font-semibold text-link hover:underline"
                >
                  See all failed captures
                </button>
              ) : null}
            </section>

            {stats ? (
              <section aria-labelledby="explore-heading">
                <h2 id="explore-heading" className="mb-3 text-[17px] font-semibold text-fg">
                  Explore by type
                </h2>
                <ul className="space-y-2">
                  {(Object.keys(SOURCE_LABELS) as SourceType[])
                    .filter((source) => stats.by_source_type[source] > 0)
                    .map((source) => (
                      <li
                        key={source}
                        className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-4 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenTimeline({ source })}
                          className="min-h-touch text-left text-[15px] text-fg hover:underline"
                        >
                          {stats.by_source_type[source]}{" "}
                          {stats.by_source_type[source] === 1
                            ? SOURCE_LABELS[source].singular
                            : SOURCE_LABELS[source].plural}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            onAsk("Summarize my latest saves", {
                              scope: {
                                sourceType: source,
                                label: `Your ${SOURCE_LABELS[source].plural}`,
                              },
                            })
                          }
                        >
                          Ask Echo
                        </Button>
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
