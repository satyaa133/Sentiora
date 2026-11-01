import { useState, useMemo } from "react";
import { Chip, IconSearch, Input, MemoryList, MemoryRow } from "@shared/ui";
import EmptyState from "../EmptyState";
import type { MemoryItem } from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";
import { dayLabel } from "../../utils/dates";

interface SearchViewProps {
  items: MemoryItem[];
  onSelectItem: (item: MemoryItem) => void;
}

export default function SearchView({ items, onSelectItem }: SearchViewProps) {
  const [query, setQuery] = useState("");

  const searchResults = useMemo(() => {
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

      {query.trim() ? (
        <p role="status" className="text-[15px] text-muted">
          {searchResults.length} {searchResults.length === 1 ? "result" : "results"} for
          &ldquo;{query}&rdquo;
        </p>
      ) : null}

      {searchResults.length > 0 ? (
        <MemoryList>
          {searchResults.map((item) => (
            <MemoryRow
              key={item.id}
              title={item.title}
              snippet={formatExtractedContent(item).cleanText.slice(0, 240)}
              sourceType={item.source_type}
              dateLabel={dayLabel(item.captured_at)}
              dateTime={item.captured_at}
              onSelect={() => onSelectItem(item)}
            />
          ))}
        </MemoryList>
      ) : query.trim() ? (
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
    </div>
  );
}
