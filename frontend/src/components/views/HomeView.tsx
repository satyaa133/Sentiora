import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { emitEcho } from "../echo/echoEvents";
import { useEchoSearchEvents } from "../echo/useEchoSearchEvents";
import { useStatistics } from "../../hooks/useStatistics";
import ThisWeekChart from "./ThisWeekChart";

import {
  Button,
  Card,
  Chip,
  Echo,
  Eyebrow,
  IconArrowRight,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconButton,
  Input,
  Kbd,
  MemoryList,
  MemoryRow,
  MemoryRowSkeleton,
} from "@shared/ui";

import EmptyState from "../EmptyState";
import { SOURCE_FILTERS, type MemoryItem, type SourceFilter } from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";
import { dayLabel, greeting, savedAgo } from "../../utils/dates";
import { pickResurfaced } from "../../utils/resurface";

const DISMISSED_KEY = "sentiora-resurface-dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function snippet(item: MemoryItem): string {
  return formatExtractedContent(item)
    .cleanText.replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function shortTitle(title: string, max = 40): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

interface HomeViewProps {
  name: string;
  items: MemoryItem[];
  isLoading: boolean;
  loadError: string | null;
  isSyncing: boolean;
  status: string | null;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onRetry: () => void;
  onSync: () => void;
  onAddMemory: () => void;
  onSelectItem: (item: MemoryItem) => void;
  onAsk: (question: string) => void;
  onOpenPalette: () => void;
  onViewTimeline: () => void;
  /** Changes when memories are added, removed or change status; refreshes "This week". */
  statsRefreshKey?: unknown;
}

export default function HomeView({
  name,
  items,
  isLoading,
  loadError,
  isSyncing,
  status,
  searchQuery,
  onSearchQueryChange,
  onRetry,
  onSync,
  onAddMemory,
  onSelectItem,
  onAsk,
  onOpenPalette,
  onViewTimeline,
  statsRefreshKey,
}: HomeViewProps) {
  const { stats } = useStatistics(statsRefreshKey);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.source_type?.toLowerCase() !== filter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        (item.content?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, filter, searchQuery]);

  useEchoSearchEvents(searchQuery, filtered.length);

  const resurfaced = useMemo(
    () => pickResurfaced(items, dismissed),
    [items, dismissed],
  );

  const suggestions = useMemo(() => {
    const titles = items
      .filter((item) => item.status === "ready")
      .map((item) => item.title);
    const result: string[] = [];
    if (titles[0]) result.push(`What is “${shortTitle(titles[0])}” about?`);
    if (titles[1])
      result.push(`Summarize what I saved about “${shortTitle(titles[1])}”`);
    result.push("What did I save this week?");
    return result;
  }, [items]);

  function dismissResurfaced(id: string) {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable: dismissal lasts until reload.
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (searchQuery.trim()) onAsk(searchQuery.trim());
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-[28px] font-bold tracking-tight sm:text-page-title">
          {greeting()}, {name}
        </h1>
        <div className="flex items-center gap-2">
          {status ? (
            <span role="status" className="text-[15px] text-muted">
              {status}
            </span>
          ) : null}
          <IconButton
            label={isSyncing ? "Refreshing" : "Refresh memories"}
            icon={
              <IconRefresh
                size={18}
                className={isSyncing ? "animate-spin" : undefined}
              />
            }
            onClick={onSync}
            disabled={isSyncing}
          />
          <Button
            variant="inverse"
            leadingIcon={<IconPlus size={18} />}
            onClick={onAddMemory}
          >
            Add memory
          </Button>
        </div>
      </header>

      <form role="search" onSubmit={submitSearch}>
        <label htmlFor="home-search" className="sr-only">
          Search or ask anything you&apos;ve saved
        </label>
        <Input
          id="home-search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search or ask anything you've saved..."
          leadingIcon={<IconSearch size={20} />}
          className="h-14 rounded-card text-[17px] shadow-pop"
          aria-describedby="home-search-hint"
          trailing={
            <button
              type="button"
              onClick={onOpenPalette}
              aria-label="Open command palette"
              className="mr-1.5 hidden items-center gap-1 rounded-btn p-1.5 hover:bg-raised sm:flex"
            >
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </button>
          }
        />
        <p id="home-search-hint" className="mt-2 min-h-[22px] text-[15px] text-muted">
          {searchQuery.trim()
            ? "Filtering your recent memories. Press Enter to ask Sentiora."
            : ""}
        </p>
      </form>

      {resurfaced ? (
        <Card
          tone="raised"
          padding="lg"
          as="section"
          aria-labelledby="resurfaced-title"
          className="flex flex-col gap-5 sm:flex-row sm:items-center"
        >
          <Echo state="idle" size={64} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <Eyebrow>
              Resurfaced · {savedAgo(resurfaced.captured_at || resurfaced.created_at)}
            </Eyebrow>
            <h2
              id="resurfaced-title"
              className="mt-1 font-display text-[22px] font-bold leading-snug tracking-tight text-fg"
            >
              {resurfaced.title}
            </h2>
            {snippet(resurfaced) ? (
              <p className="mt-1 line-clamp-2 text-[16px] text-muted">
                {snippet(resurfaced)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              onClick={() => {
                emitEcho({ type: "resurfaced", action: "revisit" });
                onSelectItem(resurfaced);
              }}
            >
              Revisit
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                emitEcho({ type: "resurfaced", action: "dismiss" });
                dismissResurfaced(resurfaced.id);
              }}
            >
              Not now
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="recent-heading" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="recent-heading" className="text-[20px] font-semibold text-fg">
              Recent memories
            </h2>
            <div
              role="group"
              aria-label="Filter by type"
              className="flex flex-wrap gap-2"
            >
              {SOURCE_FILTERS.map((option) => (
                <Chip
                  key={option.id}
                  selected={filter === option.id}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
          </div>

          {isLoading ? (
            <ul
              aria-busy="true"
              aria-label="Loading memories"
              className="overflow-hidden rounded-card border border-line bg-surface"
            >
              {[0, 1, 2, 3].map((i) => (
                <MemoryRowSkeleton key={i} />
              ))}
            </ul>
          ) : loadError ? (
            <EmptyState
              title="Could not load your memories"
              body={loadError}
              action={
                <Button variant="secondary" onClick={onRetry}>
                  Try again
                </Button>
              }
            />
          ) : filtered.length > 0 ? (
            <>
              <MemoryList>
                {filtered.slice(0, 6).map((item) => (
                  <MemoryRow
                    key={item.id}
                    title={item.title}
                    snippet={snippet(item)}
                    sourceType={item.source_type}
                    dateLabel={dayLabel(item.captured_at || item.created_at)}
                    dateTime={item.captured_at || item.created_at}
                    onSelect={() => onSelectItem(item)}
                  />
                ))}
              </MemoryList>
              <button
                type="button"
                onClick={onViewTimeline}
                className="mt-3 inline-flex min-h-touch items-center gap-1 text-[15px] font-medium text-link hover:underline"
              >
                See everything in Timeline
                <IconArrowRight size={16} />
              </button>
            </>
          ) : (
            <Card className="flex flex-col items-center py-10 text-center">
              <Echo state="faded" size={72} />
              <p className="mt-4 text-[17px] font-semibold text-fg">
                {items.length === 0 ? "Nothing saved yet" : "No memories match"}
              </p>
              <p className="mt-1 max-w-sm text-[15px] text-muted">
                {items.length === 0
                  ? "Install the Sentiora extension and save a page, or add a memory here."
                  : "Try another filter or a different search."}
              </p>
            </Card>
          )}
        </section>

        <aside aria-labelledby="try-heading" className="min-w-0 space-y-6">
          <div>
            <h2 id="try-heading" className="mb-4 text-[20px] font-semibold text-fg">
              Try asking
            </h2>
            <ul className="space-y-3">
              {suggestions.map((question) => (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => onAsk(question)}
                    className="flex w-full items-start justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left text-[16px] text-fg transition-colors hover:bg-raised"
                  >
                    <span>{question}</span>
                    <IconArrowRight size={18} className="mt-0.5 shrink-0 text-link" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <ThisWeekChart daily={stats?.daily ?? null} />
        </aside>
      </div>
    </div>
  );
}
