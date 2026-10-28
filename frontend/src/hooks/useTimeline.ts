import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMemoryItems } from "../services/memoryService";
import type { MemoryItem, MemoryListFilters } from "../types/memory";

const PAGE_SIZE = 30;
const MAX_PER_PAGE = 100;

/**
 * Server-filtered, paginated memory list for the Timeline.
 * `refreshKey` reloads the first page (e.g. after a capture or delete).
 */
export function useTimeline(filters: MemoryListFilters, refreshKey: unknown = 0) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignore responses for filters the user has already changed.
  const requestId = useRef(0);
  const filterKey = JSON.stringify(filters);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const id = ++requestId.current;
      if (append) setIsLoadingMore(true);
      try {
        const data = await fetchMemoryItems(nextPage, PAGE_SIZE, JSON.parse(filterKey));
        if (id !== requestId.current) return;
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
        setHasMore(data.has_more);
        setPage(nextPage);
        setError(null);
      } catch {
        if (id !== requestId.current) return;
        setError("Could not load your timeline. Check that the Sentiora API is running.");
      } finally {
        if (id === requestId.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [filterKey],
  );

  useEffect(() => {
    setIsLoading(true);
    void load(1, false);
  }, [load]);

  // Quiet refresh of what is on screen; keeps the loaded pages. The first run
  // is skipped because the filter effect above already loads page 1.
  const skipFirstRefresh = useRef(true);
  useEffect(() => {
    if (skipFirstRefresh.current) {
      skipFirstRefresh.current = false;
      return;
    }
    const id = ++requestId.current;
    // The API caps per_page at 100; beyond that only the newest 100 refresh.
    fetchMemoryItems(1, Math.min(MAX_PER_PAGE, page * PAGE_SIZE), JSON.parse(filterKey))
      .then((data) => {
        if (id !== requestId.current) return;
        setItems(data.items);
        setTotal(data.total);
        // A refresh that returned fewer rows than were loaded resets paging to match.
        setPage(Math.ceil(data.items.length / PAGE_SIZE) || 1);
        setHasMore(data.has_more);
        setError(null);
      })
      .catch(() => undefined)
      .finally(() => {
        // This request may have superseded the first load, so it ends loading too.
        if (id === requestId.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      });
    // Only a new refreshKey should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) void load(page + 1, true);
  }, [hasMore, isLoadingMore, load, page]);

  const retry = useCallback(() => {
    setIsLoading(true);
    void load(1, false);
  }, [load]);

  return { items, total, hasMore, isLoading, isLoadingMore, error, loadMore, retry };
}
