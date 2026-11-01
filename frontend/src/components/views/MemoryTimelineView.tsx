import { useState, useMemo } from "react";
import {
  Chip,
  IconButton,
  IconSearch,
  IconTrash,
  Input,
  MemoryList,
  MemoryRow,
  Tag,
} from "@shared/ui";
import EmptyState from "../EmptyState";
import MemoryFeedSkeleton from "../MemoryFeedSkeleton";
import type { MemoryItem, SourceType } from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";

interface MemoryTimelineViewProps {
  items: MemoryItem[];
  isLoading: boolean;
  onSelectItem: (item: MemoryItem) => void;
  onDeleteItem?: (id: string) => void;
}

const FILTERS: Array<{ id: "all" | SourceType; label: string }> = [
  { id: "all", label: "All" },
  { id: "webpage", label: "Web" },
  { id: "pdf", label: "PDF" },
  { id: "youtube", label: "Video" },
];

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
        (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
      );
    } else {
      result = [...result].sort(
        (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
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
        label =
          "Today · " +
          date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      } else if (date.toDateString() === yesterday.toDateString()) {
        label =
          "Yesterday · " +
          date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <Chip
              key={filter.id}
              selected={selectedFilter === filter.id}
              onClick={() => setSelectedFilter(filter.id)}
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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter timeline"
            leadingIcon={<IconSearch size={18} />}
            className="sm:w-64"
          />
          <label htmlFor="timeline-sort" className="sr-only">
            Sort order
          </label>
          <select
            id="timeline-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "newest" | "oldest")}
            className="h-11 rounded-btn border border-line bg-surface px-3 text-[15px] text-fg focus:border-accent focus:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <MemoryFeedSkeleton />
      ) : groupedItems.length > 0 ? (
        <div className="space-y-8">
          {groupedItems.map((group) => (
            <section key={group.dateLabel} aria-label={group.dateLabel}>
              <h2 className="mb-3 flex items-baseline gap-2 text-[17px] font-semibold text-fg">
                {group.dateLabel}
                <span className="text-[15px] font-normal text-muted">
                  {group.items.length}{" "}
                  {group.items.length === 1 ? "memory" : "memories"}
                </span>
              </h2>
              <MemoryList>
                {group.items.map((item) => {
                  const formatted = formatExtractedContent(item);
                  return (
                    <MemoryRow
                      key={item.id}
                      title={item.title}
                      snippet={formatted.cleanText.slice(0, 240)}
                      sourceType={item.source_type}
                      dateLabel={getTimeString(item.captured_at)}
                      dateTime={item.captured_at}
                      onSelect={() => onSelectItem(item)}
                      actions={
                        item.status !== "ready" || onDeleteItem ? (
                          <span className="flex items-center gap-1">
                            {item.status === "failed" ? (
                              <Tag>Failed</Tag>
                            ) : item.status !== "ready" ? (
                              <Tag>Processing</Tag>
                            ) : null}
                            {onDeleteItem ? (
                              <IconButton
                                label={`Delete ${item.title}`}
                                icon={<IconTrash size={18} />}
                                size="sm"
                                onClick={() => onDeleteItem(item.id)}
                              />
                            ) : null}
                          </span>
                        ) : undefined
                      }
                    />
                  );
                })}
              </MemoryList>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title={items.length === 0 ? "Nothing saved yet" : "No memories match"}
          body={
            items.length === 0
              ? "Pages you save with the extension show up here, newest first."
              : "Try another filter or clear the search."
          }
        />
      )}
    </div>
  );
}
