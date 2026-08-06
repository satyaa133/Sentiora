import { useState, useMemo } from "react";
import MemoryCard from "../MemoryCard";
import type { MemoryItem } from "../../types/memory";

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
        (item.author?.toLowerCase().includes(q) ?? false)
    );
  }, [items, query]);

  return (
    <div className="space-y-6 max-w-4xl font-sans">
      {/* Big Search Input */}
      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500">
          ARCHIVE SEARCH & DISCOVERY
        </h2>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type any keyword, phrase, or domain name..."
            className="w-full bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl pl-11 pr-4 py-3.5 text-sm text-ink-900 placeholder-ink-500 focus:outline-none focus:border-moss-600 focus:bg-white font-medium transition-colors"
            autoFocus
          />
          <svg
            className="w-5 h-5 text-ink-500 absolute left-4 top-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Suggested tags */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-ink-500 font-medium">Quick suggestions:</span>
          {(items.length > 0
            ? Array.from(
                new Set(
                  items.flatMap((item) => {
                    try {
                      return [new URL(item.url).hostname.replace(/^www\./, "")];
                    } catch {
                      return [item.source_type];
                    }
                  })
                )
              ).slice(0, 5)
            : ["Webpages", "PDFs", "YouTube", "Notes"]
          ).map((tag) => (
            <button
              key={tag}
              onClick={() => setQuery(tag)}
              className="px-2.5 py-1 rounded-lg bg-parchment-100/80 hover:bg-moss-100 backdrop-blur-xs text-ink-700 hover:text-moss-600 transition-all font-medium text-[11px] hover:scale-105"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Results Header */}
      {query.trim() && (
        <div className="flex items-center justify-between text-xs text-ink-500 px-1">
          <span>Found {searchResults.length} results for "{query}"</span>
        </div>
      )}

      {/* Results Grid */}
      {searchResults.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {searchResults.map((item) => (
            <MemoryCard key={item.id} item={item} onSelect={onSelectItem} />
          ))}
        </div>
      ) : query.trim() ? (
        <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-12 text-center space-y-2 shadow-card">
          <p className="text-sm font-serif font-bold text-ink-900">No results found</p>
          <p className="text-xs text-ink-500">
            No memories match your query "{query}".
          </p>
        </div>
      ) : (
        <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-12 text-center space-y-2 shadow-card">
          <p className="text-sm font-serif font-bold text-ink-900">Search Your Digital Memory</p>
          <p className="text-xs text-ink-500">
            Enter a search term above to instantly locate saved articles, PDFs, or YouTube transcripts.
          </p>
        </div>
      )}
    </div>
  );
}
