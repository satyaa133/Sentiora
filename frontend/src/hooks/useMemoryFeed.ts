import { useCallback, useEffect, useState } from "react";
import { deleteMemoryItem, fetchMemoryItems } from "../services/memoryService";
import type { MemoryItem } from "../types/memory";

export function useMemoryFeed() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const loadMemoryFeed = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchMemoryItems(1, 100);
      setItems(data.items);
      setTotalCount(data.total);
      setLoadError(null);
    } catch (err) {
      console.error("Error loading memory feed:", err);
      setLoadError("Could not load your memories. Check that the Sentiora API is running.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleManualSync = useCallback(async () => {
    setIsSyncing(true);
    await loadMemoryFeed(true);
    setIsSyncing(false);
    showToast("Vault synced successfully!");
  }, [loadMemoryFeed, showToast]);

  const handleDeleteItem = useCallback(async (id: string) => {
    try {
      await deleteMemoryItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setTotalCount((prev) => Math.max(0, prev - 1));
      showToast("Memory deleted.");
      return true;
    } catch (err) {
      console.error("Error deleting memory item:", err);
      showToast("Could not delete memory. Please try again.");
      return false;
    }
  }, [showToast]);

  useEffect(() => {
    void loadMemoryFeed();
    const interval = window.setInterval(() => {
      void loadMemoryFeed(true);
    }, 5000);

    const handleFocus = () => {
      void loadMemoryFeed(true);
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    const winChrome = (
      window as unknown as {
        chrome?: {
          runtime?: {
            onMessage?: {
              addListener: (fn: (msg: { type?: string }) => void) => void;
              removeListener: (fn: (msg: { type?: string }) => void) => void;
            };
          };
        };
      }
    ).chrome;
    if (winChrome?.runtime?.onMessage) {
      const listener = (msg: { type?: string }) => {
        if (msg?.type === "REFRESH_MEMORY_FEED") {
          void loadMemoryFeed(true);
        }
      };
      winChrome.runtime.onMessage.addListener(listener);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleFocus);
        winChrome.runtime?.onMessage?.removeListener(listener);
      };
    }

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadMemoryFeed]);

  return {
    items,
    setItems,
    totalCount,
    isLoading,
    isSyncing,
    loadError,
    toast,
    loadMemoryFeed,
    handleManualSync,
    handleDeleteItem,
  };
}
