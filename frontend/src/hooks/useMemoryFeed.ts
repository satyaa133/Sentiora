import { useCallback, useEffect, useState } from "react";
import { deleteMemoryItem, fetchMemoryItems } from "../services/memoryService";
import type { MemoryItem } from "../types/memory";

export function useMemoryFeed() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const loadMemoryFeed = useCallback(async (silent = false): Promise<boolean> => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchMemoryItems(1, 100);
      setItems(data.items);
      setLoadError(null);
      return true;
    } catch (err) {
      console.error("Error loading memory feed:", err);
      setLoadError("Could not load your memories. Check that the Sentiora API is running.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleManualSync = useCallback(async () => {
    setIsSyncing(true);
    const synced = await loadMemoryFeed(true);
    setIsSyncing(false);
    showToast(synced ? "Memories are up to date." : "Could not sync. Please try again.");
  }, [loadMemoryFeed, showToast]);

  const handleDeleteItem = useCallback(async (id: string) => {
    try {
      await deleteMemoryItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
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
    // Poll so new captures appear, but not while the tab is in the background.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMemoryFeed(true);
    }, 5000);

    const handleFocus = () => {
      if (document.visibilityState === "visible") void loadMemoryFeed(true);
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    const handleRefreshEvent = () => {
      void loadMemoryFeed(true);
    };

    window.addEventListener("sentiora_memory_refresh", handleRefreshEvent);

    const handleMessage = (e: MessageEvent) => {
      if (
        e.origin === window.location.origin &&
        (e.data?.type === "SENTIORA_MEMORY_REFRESH" || e.data?.type === "REFRESH_MEMORY_FEED")
      ) {
        handleRefreshEvent();
      }
    };
    window.addEventListener("message", handleMessage);

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
    const listener = (msg: { type?: string }) => {
      if (msg?.type === "REFRESH_MEMORY_FEED") {
        void loadMemoryFeed(true);
      }
    };
    winChrome?.runtime?.onMessage?.addListener(listener);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("sentiora_memory_refresh", handleRefreshEvent);
      window.removeEventListener("message", handleMessage);
      winChrome?.runtime?.onMessage?.removeListener(listener);
    };
  }, [loadMemoryFeed]);

  return {
    items,
    isLoading,
    isSyncing,
    loadError,
    toast,
    loadMemoryFeed,
    handleManualSync,
    handleDeleteItem,
  };
}
