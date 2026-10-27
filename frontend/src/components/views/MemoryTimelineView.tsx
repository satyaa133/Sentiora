import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Chip,
  IconButton,
  IconExternalLink,
  IconMessage,
  IconSearch,
  Input,
  MemoryList,
  MemoryRow,
  Tag,
} from "@shared/ui";
import EmptyState from "../EmptyState";
import MemoryFeedSkeleton from "../MemoryFeedSkeleton";
import { useStatistics } from "../../hooks/useStatistics";
import { useTimeline } from "../../hooks/useTimeline";
import type { DashboardStatistics } from "../../services/dashboardService";
import {
  SOURCE_FILTERS,
  type ItemStatus,
  type MemoryItem,
  type MemoryListFilters,
  type SourceFilter,
} from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";
import { safeHref } from "../../utils/safeHref";

type RangeFilter = "all" | "today" | "7d" | "30d";
type StatusFilter = "all" | ItemStatus;

/** Filters another view can open the Timeline with (e.g. Intelligence). */
export interface TimelinePreset {
  source?: SourceFilter;
  status?: StatusFilter;
}

interface MemoryTimelineViewProps {
  /** Changes whenever the memory feed changes, so the list and totals refresh. */
  refreshKey?: string;
  preset?: TimelinePreset;
  onSelectItem: (item: MemoryItem) => void;
  onAskAbout: (item: MemoryItem) => void;
}

const RANGES: { id: RangeFilter; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const STATUSES: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Any status" },
  { id: "ready", label: "Ready for Ask" },
  { id: "pending", label: "Waiting to index" },
  { id: "processing", label: "Indexing" },
  { id: "failed", label: "Failed" },
];

function rangeStart(range: RangeFilter): string | undefined {
  if (range === "all") return undefined;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start.toISOString();
}

function dayHeading(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const short = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (date.toDateString() === today.toDateString()) return `Today · ${short}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${short}`;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StatusTag({ status }: { status: ItemStatus }) {
  // Only states that need attention get a tag; ready rows stay quiet.
  if (status === "ready")
    return <span className="hidden text-sm text-muted sm:inline">Ready for Ask</span>;
  if (status === "failed") return <Tag>Failed</Tag>;
  return <Tag>{status === "processing" ? "Indexing" : "Waiting"}</Tag>;
}

export default function MemoryTimelineView({
  refreshKey = "",
  preset,
  onSelectItem,
  onAskAbout,
}: MemoryTimelineViewProps) {
  const [source, setSource] = useState<SourceFilter>(preset?.source ?? "all");
  const [status, setStatus] = useState<StatusFilter>(preset?.status ?? "all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filters = useMemo<MemoryListFilters>(
    () => ({
      source_type: source === "all" ? undefined : source,
      status: status === "all" ? undefined : status,
      date_from: rangeStart(range),
      q: debouncedQuery || undefined,
    }),
    [source, status, range, debouncedQuery],
  );
  const isFiltered = source !== "all" || status !== "all" || range !== "all" || Boolean(debouncedQuery);

  const timeline = useTimeline(filters, refreshKey);
  const { stats } = useStatistics(refreshKey);

  const groups = useMemo(() => {
    const map = new Map<string, MemoryItem[]>();
    for (const item of timeline.items) {
      const label = dayHeading(item.captured_at);
      map.set(label, [...(map.get(label) ?? []), item]);
    }
    return [...map.entries()];
  }, [timeline.items]);

  function clearFilters() {
    setSource("all");
    setStatus("all");
    setRange("all");
    setQuery("");
  }

  return (
    <div className="space-y-6">
      {stats && stats.total > 0 ? <TimelineSummary stats={stats} /> : null}

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
          {SOURCE_FILTERS.map((filter) => (
            <Chip
              key={filter.id}
              selected={source === filter.id}
              onClick={() => setSource(filter.id)}
            >
              {filter.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="timeline-filter" className="sr-only">
            Filter timeline
          </label>
          <Input
            id="timeline-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, site or address"
            leadingIcon={<IconSearch size={18} />}
            className="sm:w-56"
          />
          <label htmlFor="timeline-range" className="sr-only">
            Date range
          </label>
          <select
            id="timeline-range"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeFilter)}
            className="h-11 rounded-btn border border-line bg-surface px-3 text-[15px] text-fg focus:border-accent focus:outline-none"
          >
            {RANGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <label htmlFor="timeline-status" className="sr-only">
            Indexing status
          </label>
          <select
            id="timeline-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-11 rounded-btn border border-line bg-surface px-3 text-[15px] text-fg focus:border-accent focus:outline-none"
          >
            {STATUSES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {timeline.isLoading ? (
        <MemoryFeedSkeleton />
      ) : timeline.error ? (
        <EmptyState
          title="Could not load your memories"
          body={timeline.error}
          action={
            <Button variant="secondary" onClick={timeline.retry}>
              Try again
            </Button>
          }
        />
      ) : groups.length > 0 ? (
        <div className="space-y-8">
          {isFiltered ? (
            <p role="status" className="text-[15px] text-muted">
              {timeline.total} {timeline.total === 1 ? "memory matches" : "memories match"}.{" "}
              <button
                type="button"
                onClick={clearFilters}
                className="font-semibold text-link hover:underline"
              >
                Clear filters
              </button>
            </p>
          ) : null}
          {groups.map(([label, groupItems]) => (
            <section key={label} aria-label={label}>
              <h2 className="mb-3 flex items-baseline gap-2 text-[17px] font-semibold text-fg">
                {label}
                <span className="text-[15px] font-normal text-muted">
                  {groupItems.length} {groupItems.length === 1 ? "memory" : "memories"}
                </span>
              </h2>
              <MemoryList>
                {groupItems.map((item) => (
                  <TimelineRow
                    key={item.id}
                    item={item}
                    onSelect={() => onSelectItem(item)}
                    onAsk={() => onAskAbout(item)}
                  />
                ))}
              </MemoryList>
            </section>
          ))}
          {timeline.hasMore ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                loading={timeline.isLoadingMore}
                onClick={timeline.loadMore}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={isFiltered ? "No memories match" : "Nothing saved yet"}
          body={
            isFiltered
              ? "Try another filter or clear the search."
              : "Pages you save with the extension show up here, newest first."
          }
          action={
            isFiltered ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function TimelineRow({
  item,
  onSelect,
  onAsk,
}: {
  item: MemoryItem;
  onSelect: () => void;
  onAsk: () => void;
}) {
  const href = item.url.startsWith("file:") ? undefined : safeHref(item.url);
  const meta = [
    item.domain,
    item.word_count > 0 ? `${item.word_count.toLocaleString()} words` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const text = formatExtractedContent(item).cleanText;
  const preview = text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text;
  return (
    <MemoryRow
      title={item.title}
      snippet={[meta, preview].filter(Boolean).join(" — ")}
      sourceType={item.source_type}
      dateLabel={timeLabel(item.captured_at)}
      dateTime={item.captured_at}
      onSelect={onSelect}
      actions={
        <div className="flex items-center gap-1">
          <StatusTag status={item.status} />
          {item.status === "ready" ? (
            <IconButton
              label={`Ask Echo about ${item.title}`}
              icon={<IconMessage size={18} />}
              variant="ghost"
              size="sm"
              onClick={onAsk}
            />
          ) : null}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open source of ${item.title} (opens in a new tab)`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-btn text-muted hover:bg-raised hover:text-fg"
            >
              <IconExternalLink size={18} />
            </a>
          ) : null}
        </div>
      }
    />
  );
}

function TimelineSummary({ stats }: { stats: DashboardStatistics }) {
  const parts = [
    `${stats.total} ${stats.total === 1 ? "memory" : "memories"}`,
    `${stats.today} today`,
    `${stats.this_week} this week`,
  ];
  const sources = [
    ["Web", stats.by_source_type.webpage],
    ["PDF", stats.by_source_type.pdf],
    ["Video", stats.by_source_type.youtube],
  ] as const;
  const activeDays = stats.daily.filter((day) => day.count > 0).length;
  const peak = Math.max(1, ...stats.daily.map((day) => day.count));

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-end sm:justify-between">
      <dl className="space-y-1">
        <div>
          <dt className="sr-only">Totals</dt>
          <dd className="text-[17px] font-semibold text-fg">{parts.join(" · ")}</dd>
        </div>
        <div>
          <dt className="sr-only">By type and status</dt>
          <dd className="text-[15px] text-muted">
            {sources
              .filter(([, count]) => count > 0)
              .map(([label, count]) => `${label} ${count}`)
              .join(" · ")}
            {" · "}
            {stats.ready_for_ai} ready for Ask
            {stats.by_status.failed > 0 ? ` · ${stats.by_status.failed} failed` : ""}
          </dd>
        </div>
      </dl>
      {activeDays >= 2 ? (
        <figure className="shrink-0">
          <div
            role="img"
            aria-label={`Captures per day for the last ${stats.daily.length} days: ${stats.daily
              .map((day) => day.count)
              .join(", ")}`}
            className="flex h-10 items-end gap-1"
          >
            {stats.daily.map((day) => (
              <span
                key={day.date}
                title={`${day.date}: ${day.count}`}
                className={day.count > 0 ? "w-2 rounded-sm bg-accent" : "w-2 rounded-sm bg-line"}
                style={{ height: `${Math.max(8, (day.count / peak) * 100)}%` }}
              />
            ))}
          </div>
          <figcaption className="mt-1 text-right font-mono text-eyebrow uppercase text-muted">
            Last 14 days
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
