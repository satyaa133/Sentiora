import { useState, useMemo } from "react";
import MemoryFeedSkeleton from "../MemoryFeedSkeleton";
import type { MemoryItem, SourceType } from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";

interface MemoryTimelineViewProps {
  items: MemoryItem[];
  isLoading: boolean;
  onSelectItem: (item: MemoryItem) => void;
  onDeleteItem?: (id: string) => void;
}

export default function MemoryTimelineView({
  items,
  isLoading,
  onSelectItem,
  onDeleteItem,
}: MemoryTimelineViewProps) {
  const [selectedFilter, setSelectedFilter] = useState<"all" | SourceType>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    let result = items.filter((item) => {
      if (selectedFilter !== "all" && item.source_type !== selectedFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const formatted = formatExtractedContent(item);
        return (
          item.title.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q) ||
          formatted.cleanText.toLowerCase().includes(q)
        );
      }
      return true;
    });

    if (sortBy === "oldest") {
      result = [...result].sort(
        (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
      );
    } else {
      result = [...result].sort(
        (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
      );
    }

    return result;
  }, [items, selectedFilter, searchQuery, sortBy]);



  // Group items by date sequentially
  const groupedItems = useMemo(() => {
    const groups: { dateLabel: string; items: MemoryItem[] }[] = [];
    const map = new Map<string, MemoryItem[]>();

    filteredItems.forEach((item) => {
      const date = new Date(item.captured_at);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);

      let label = date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      if (date.toDateString() === today.toDateString()) {
        label = "Today — " + date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      } else if (date.toDateString() === yesterday.toDateString()) {
        label = "Yesterday — " + date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }

      if (!map.has(label)) {
        map.set(label, []);
      }
      map.get(label)!.push(item);
    });

    map.forEach((groupItems, dateLabel) => {
      groups.push({ dateLabel, items: groupItems });
    });

    return groups;
  }, [filteredItems]);

  function getTimeString(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function getDomain(urlStr: string): string {
    try {
      return new URL(urlStr).hostname.replace(/^www\./, "");
    } catch {
      return urlStr;
    }
  }

  function renderSourceBadge(sourceType: string) {
    switch (sourceType) {
      case "youtube":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-youtubeBadge-100 text-youtubeBadge-600">
            YOUTUBE
          </span>
        );
      case "pdf":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-amberBadge-100 text-amberBadge-600">
            PDF
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-moss-100 text-moss-600">
            WEBPAGE
          </span>
        );
    }
  }

  return (
    <div className="space-y-6 font-sans max-w-5xl">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 bg-white/85 backdrop-blur-md rounded-2xl border border-parchment-200/80 shadow-card">
        {/* Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto p-1">
          {(["all", "webpage", "pdf", "youtube"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-all duration-200 ${
                selectedFilter === filter
                  ? "bg-moss-600 text-white shadow-sm font-bold"
                  : "bg-white/80 hover:bg-white backdrop-blur-xs text-ink-700 border border-parchment-200/80"
              }`}
            >
              {filter === "all" ? "All Memories" : filter}
            </button>
          ))}
        </div>

        {/* Search + Sort */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter timeline..."
            className="bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-3 py-1.5 text-xs text-ink-900 placeholder-ink-500 focus:outline-none focus:border-moss-600 focus:bg-white w-48 font-medium transition-colors"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "newest" | "oldest")}
            className="bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-3 py-1.5 text-xs text-ink-900 font-medium focus:outline-none focus:border-moss-600 focus:bg-white transition-colors"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      {/* Sequential Vertical Timeline View */}
      {isLoading ? (
        <MemoryFeedSkeleton />
      ) : groupedItems.length > 0 ? (
        <div className="space-y-6 relative max-w-3xl">
          {groupedItems.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-3">
              {/* Date Group Header Banner */}
              <div className="sticky top-14 z-20 bg-white/90 backdrop-blur-md py-1 px-3 rounded-lg border border-parchment-200/80 w-fit text-xs font-bold text-ink-800 font-serif flex items-center gap-2 shadow-xs">
                <span>🗓️</span>
                <span>{group.dateLabel}</span>
                <span className="text-[11px] text-moss-600 font-sans font-semibold">
                  • {group.items.length} memory{group.items.length > 1 ? "ies" : ""}
                </span>
              </div>

              {/* Vertical Spine Timeline Items */}
              <div className="relative pl-5 sm:pl-7 space-y-3 border-l-2 border-moss-600/30 ml-2.5 sm:ml-3.5">
                {group.items.map((item) => {
                  const formatted = formatExtractedContent(item);
                  const cleanWords = formatted.cleanText.split(/\s+/).filter(Boolean).length;
                  const wordCount = item.word_count > 0 ? item.word_count : cleanWords;
                  const readMin = Math.max(1, Math.ceil(wordCount / 200));

                  return (
                    <div
                      key={item.id}
                      className="relative group transition-all duration-200"
                    >
                      {/* Timeline Node Icon Circle */}
                      <div className="absolute -left-[27px] sm:-left-[35px] top-3.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-moss-600 group-hover:bg-moss-600 group-hover:scale-125 transition-all shadow-xs" />

                      {/* Memory Compact Timeline Card */}
                      <article
                        onClick={() => onSelectItem(item)}
                        className="bg-white/90 hover:bg-white backdrop-blur-sm border border-parchment-200/80 hover:border-moss-600/40 rounded-xl p-3.5 sm:p-4 transition-all duration-200 cursor-pointer shadow-xs hover:shadow-md hover:-translate-y-0.5 space-y-2 relative"
                      >
                        {/* Compact Header: Source badge + Timestamp + Reading time */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {renderSourceBadge(item.source_type)}
                            <span className="text-[11px] text-ink-500 font-semibold flex items-center gap-1">
                              <span>⏰</span>
                              <span>{getTimeString(item.captured_at)}</span>
                            </span>
                          </div>
                          <span className="text-[11px] text-ink-400 font-medium">
                            {readMin} min read · {wordCount} words
                          </span>
                        </div>

                        {/* Title */}
                        <h3 className="text-sm font-bold text-ink-900 group-hover:text-moss-600 transition-colors leading-snug truncate">
                          {item.title}
                        </h3>

                        {/* Concise 2-line Excerpt */}
                        {formatted.cleanText && (
                          <p className="text-xs text-ink-600 line-clamp-2 leading-relaxed font-normal">
                            {formatted.cleanText}
                          </p>
                        )}

                        {/* Compact Card Footer */}
                        <div className="pt-2 flex items-center justify-between border-t border-parchment-200/50 text-[11px]">
                          <span className="text-ink-400 font-medium truncate max-w-xs flex items-center gap-1">
                            <span>🔗</span>
                            <span>{getDomain(item.url)}</span>
                          </span>
                          <div className="flex items-center gap-2.5 shrink-0">
                            {onDeleteItem && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteItem(item.id);
                                }}
                                title="Delete Memory"
                                className="text-ink-400 hover:text-rose-600 hover:bg-rose-50 p-1 rounded transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                            <span className="font-semibold text-moss-600 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                              View Details →
                            </span>
                          </div>
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-12 text-center space-y-2 shadow-card max-w-md mx-auto my-8">
          <p className="text-base font-serif font-bold text-ink-900">No matching timeline entries</p>
          <p className="text-xs text-ink-500">
            Try resetting your filter or search terms.
          </p>
        </div>
      )}
    </div>
  );
}
