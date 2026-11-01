import { useEffect, useMemo, useState } from "react";
import { useEchoSearchEvents } from "../echo/useEchoSearchEvents";
import { Button, Chip, IconSearch, Input, MemoryList, MemoryRow } from "@shared/ui";
import EmptyState from "../EmptyState";
import MemoryFeedSkeleton from "../MemoryFeedSkeleton";
import { searchMemories, type SearchHit } from "../../services/askService";
import type { MemoryItem } from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";
import { dayLabel } from "../../utils/dates";

const SEMANTIC_MIN_CHARS = 2;
const SEMANTIC_DEBOUNCE_MS = 300;

/** A search result row: the memory, and the passage that matched when we know it. */
interface SearchResult {
  item: MemoryItem;
  matched: string | null;
}

interface SearchViewProps {
  items: MemoryItem[];
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onSelectItem: (item: MemoryItem) => void;
}

export default function SearchView({
  items,
  isLoading,
  loadError,
  onRetry,
  onSelectItem,
}: SearchViewProps) {
  const [query, setQuery] = useState("");

  const [hits, setHits] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  // Waiting for semantic matches (debounce + request) for the current query, so
  // "No results" is not shown before they arrive.
  const trimmed = query.trim();
  const searching = trimmed.length >= SEMANTIC_MIN_CHARS && hits?.query !== trimmed;

  const localResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        (item.content?.toLowerCase().includes(q) ?? false) ||
        (item.author?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  // Semantic matches once typing settles; a newer query cancels the older request.
  useEffect(() => {
    const q = query.trim();
    if (q.length < SEMANTIC_MIN_CHARS) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchMemories(q, controller.signal)
        .then((found) => setHits({ query: q, hits: found }))
        .catch(() => {
          // Failed (not cancelled): settle with no semantic matches, so the
          // local matches or "No results" show instead of waiting forever.
          if (!controller.signal.aborted) setHits({ query: q, hits: [] });
        });
    }, SEMANTIC_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const merged: SearchResult[] = [];
    if (hits && hits.query === query.trim()) {
      for (const hit of hits.hits) {
        const item = byId.get(hit.memory_id);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        const matched = hit.content.replace(/\s+/g, " ").trim();
        merged.push({ item, matched: matched || null });
      }
    }
    for (const item of localResults) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push({ item, matched: null });
    }
    return merged;
  }, [hits, items, localResults, query]);

  useEchoSearchEvents(query, searchResults.length);

  // Quick suggestions: the domains you've saved from.
  const suggestions = useMemo(
    () =>
      Array.from(
        new Set(
          items.flatMap((item) => {
            try {
              return [new URL(item.url).hostname.replace(/^www\./, "")];
            } catch {
              return [];
            }
          }),
        ),
      ).slice(0, 5),
    [items],
  );

  return (
    <div className="space-y-6">
      <div role="search" className="space-y-3">
        <label htmlFor="search-query" className="sr-only">
          Search your memories
        </label>
        <Input
          id="search-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, text or address"
          leadingIcon={<IconSearch size={20} />}
          className="h-14 rounded-card text-[17px]"
          autoFocus
        />
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] text-muted">Try:</span>
            {suggestions.map((tag) => (
              <Chip key={tag} selected={query === tag} onClick={() => setQuery(tag)}>
                {tag}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <MemoryFeedSkeleton />
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
      ) : (
        <SearchResults
          query={query}
          results={searchResults}
          searching={searching}
          onSelectItem={onSelectItem}
        />
      )}
    </div>
  );
}

function SearchResults({
  query,
  results: searchResults,
  searching,
  onSelectItem,
}: {
  query: string;
  results: SearchResult[];
  searching: boolean;
  onSelectItem: (item: MemoryItem) => void;
}) {
  return (
    <>
      {query.trim() ? (
        <p role="status" className="text-[15px] text-muted">
          {searchResults.length} {searchResults.length === 1 ? "result" : "results"} for
          &ldquo;{query}&rdquo;
          {searching ? <span> · Searching…</span> : null}
        </p>
      ) : null}

      {searchResults.length > 0 ? (
        <MemoryList>
          {searchResults.map(({ item, matched }) => (
            <MemoryRow
              key={item.id}
              title={item.title}
              snippet={(matched ?? formatExtractedContent(item).cleanText).slice(0, 240)}
              sourceType={item.source_type}
              dateLabel={dayLabel(item.captured_at)}
              dateTime={item.captured_at}
              onSelect={() => onSelectItem(item)}
            />
          ))}
        </MemoryList>
      ) : query.trim() && searching ? null : query.trim() ? (
        <EmptyState
          title="No results"
          body={
            <>
              Nothing you saved matches &ldquo;{query}&rdquo;. Try fewer words, or ask
              Sentiora.
            </>
          }
        />
      ) : (
        <EmptyState
          echo="idle"
          title="Search your memory"
          body="Type a word, a phrase or a website to find saved articles, PDFs and videos."
        />
      )}
    </>
  );
}
