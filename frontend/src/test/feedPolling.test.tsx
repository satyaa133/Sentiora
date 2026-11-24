import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/memoryService", () => ({
  fetchMemoryItems: vi.fn(),
  deleteMemoryItem: vi.fn(),
}));

import { FEED_POLL_MS, isInProgress, useMemoryFeed } from "../hooks/useMemoryFeed";
import { fetchMemoryItems } from "../services/memoryService";
import type { MemoryItem } from "../types/memory";

function item(): MemoryItem {
  return { id: "m1", status: "ready", enrichment_status: "ready", title: "Bees" } as MemoryItem;
}

const feed = (items: MemoryItem[]) => ({ items, total: items.length, page: 1, per_page: 100 });
const calls = () => vi.mocked(fetchMemoryItems).mock.calls.length;

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("feed polling (S9)", () => {
  it("does not poll when every save is ready", async () => {
    vi.mocked(fetchMemoryItems).mockResolvedValue(feed([item()]) as never);
    renderHook(() => useMemoryFeed());
    await flush();
    expect(calls()).toBe(1);
    await tick(FEED_POLL_MS * 6);
    expect(calls()).toBe(1);
  });

  it("polls while a save is processing and stops once it is ready", async () => {
    const processing = { ...item(), status: "processing" } as MemoryItem;
    vi.mocked(fetchMemoryItems)
      .mockResolvedValueOnce(feed([processing]) as never)
      .mockResolvedValueOnce(feed([processing]) as never)
      .mockResolvedValue(feed([item()]) as never);
    renderHook(() => useMemoryFeed());
    await flush();
    expect(calls()).toBe(1);
    await tick(FEED_POLL_MS);
    expect(calls()).toBe(2);
    await tick(FEED_POLL_MS);
    expect(calls()).toBe(3); // now ready: polling stops
    await tick(FEED_POLL_MS * 4);
    expect(calls()).toBe(3);
  });

  it("reloads when the tab is focused again", async () => {
    vi.mocked(fetchMemoryItems).mockResolvedValue(feed([item()]) as never);
    renderHook(() => useMemoryFeed());
    await flush();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(calls()).toBe(2);
  });

  it("counts captures and queued summaries as work in progress", () => {
    expect(isInProgress({ ...item(), status: "pending" } as MemoryItem)).toBe(true);
    expect(isInProgress({ ...item(), enrichment_status: "queued" } as MemoryItem)).toBe(true);
    expect(isInProgress({ ...item(), status: "failed" } as MemoryItem)).toBe(false);
    expect(isInProgress(item())).toBe(false);
  });
});
