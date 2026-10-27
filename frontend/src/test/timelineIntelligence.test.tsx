import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IntelligenceView from "../components/views/IntelligenceView";
import MemoryTimelineView from "../components/views/MemoryTimelineView";
import type { DashboardStatistics } from "../services/dashboardService";
import type { MemoryItem, MemoryItemListResponse } from "../types/memory";

vi.mock("../services/memoryService", async (importOriginal) => {
  const actual = await importOriginal<typeof MemoryService>();
  return { ...actual, fetchMemoryItems: vi.fn() };
});
vi.mock("../services/dashboardService", async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardService>();
  return { ...actual, fetchStatistics: vi.fn() };
});
import { fetchMemoryItems } from "../services/memoryService";
import { fetchStatistics } from "../services/dashboardService";
import type * as MemoryService from "../services/memoryService";
import type * as DashboardService from "../services/dashboardService";

function item(id: string, title: string, extra: Partial<MemoryItem> = {}): MemoryItem {
  const at = new Date().toISOString();
  return {
    id,
    user_id: "u1",
    source_type: "webpage",
    url: `https://example.dev/${id}`,
    title,
    content: `${title} body text.`,
    summary: null,
    author: null,
    favicon_url: null,
    thumbnail_url: null,
    domain: "example.dev",
    language: "en",
    content_length: 100,
    word_count: 120,
    reading_time_seconds: 60,
    status: "ready",
    captured_at: at,
    created_at: at,
    ...extra,
  } as MemoryItem;
}

function page(items: MemoryItem[], extra: Partial<MemoryItemListResponse> = {}) {
  return { items, total: items.length, page: 1, per_page: 30, has_more: false, ...extra };
}

function stats(extra: Partial<DashboardStatistics> = {}): DashboardStatistics {
  const daily = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-10-${String(14 + i).padStart(2, "0")}`,
    count: i === 13 ? 2 : i === 10 ? 1 : 0,
  }));
  return {
    total: 3,
    today: 2,
    this_week: 3,
    by_source_type: { webpage: 2, pdf: 0, youtube: 1 },
    by_status: { pending: 0, processing: 0, ready: 2, failed: 1 },
    ready_for_ai: 2,
    daily,
    last_captured_at: new Date().toISOString(),
    timezone: "UTC",
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(fetchStatistics).mockResolvedValue(stats());
});

afterEach(() => {
  cleanup();
  vi.mocked(fetchMemoryItems).mockReset();
  vi.mocked(fetchStatistics).mockReset();
});

describe("MemoryTimelineView", () => {
  it("groups real captures by day with status, totals and a trend", async () => {
    vi.mocked(fetchMemoryItems).mockResolvedValue(
      page([item("a", "Docker notes"), item("b", "Broken page", { status: "failed" })]),
    );
    render(<MemoryTimelineView onSelectItem={vi.fn()} onAskAbout={vi.fn()} />);

    expect(await screen.findByRole("heading", { level: 2, name: /Today/ })).toBeInTheDocument();
    const today = screen.getByRole("region", { name: /Today/ });
    expect(within(today).getByText("Ready for Ask")).toBeInTheDocument();
    expect(within(today).getByText("Failed")).toBeInTheDocument();
    expect(await screen.findByText("3 memories · 2 today · 3 this week")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Captures per day/ })).toBeInTheDocument();
    expect(vi.mocked(fetchMemoryItems)).toHaveBeenCalledWith(1, 30, {});
  });

  it("hides the trend when fewer than two days have captures", async () => {
    vi.mocked(fetchStatistics).mockResolvedValue(
      stats({ daily: Array.from({ length: 14 }, (_, i) => ({ date: `d${i}`, count: i === 13 ? 3 : 0 })) }),
    );
    vi.mocked(fetchMemoryItems).mockResolvedValue(page([item("a", "Docker notes")]));
    render(<MemoryTimelineView onSelectItem={vi.fn()} onAskAbout={vi.fn()} />);
    await screen.findByText("3 memories · 2 today · 3 this week");
    expect(screen.queryByRole("img", { name: /Captures per day/ })).not.toBeInTheDocument();
  });

  it("sends filters to the server and pages with Load more", async () => {
    vi.mocked(fetchMemoryItems)
      .mockResolvedValueOnce(page([item("a", "Docker notes")], { total: 2, has_more: true }))
      .mockResolvedValueOnce(page([item("b", "Kubernetes notes")], { total: 2, page: 2 }))
      .mockResolvedValue(page([item("v", "A video", { source_type: "youtube" })]));
    render(<MemoryTimelineView onSelectItem={vi.fn()} onAskAbout={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Kubernetes notes")).toBeInTheDocument();
    expect(vi.mocked(fetchMemoryItems)).toHaveBeenLastCalledWith(2, 30, {});

    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    await waitFor(() =>
      expect(vi.mocked(fetchMemoryItems)).toHaveBeenLastCalledWith(1, 30, {
        source_type: "youtube",
      }),
    );
    expect(await screen.findByText("A video")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 memory matches");
  });

  it("opens with a preset and asks Echo about a ready capture", async () => {
    vi.mocked(fetchMemoryItems).mockResolvedValue(page([item("a", "Docker notes")]));
    const onAskAbout = vi.fn();
    render(
      <MemoryTimelineView
        preset={{ status: "failed" }}
        onSelectItem={vi.fn()}
        onAskAbout={onAskAbout}
      />,
    );
    await waitFor(() =>
      expect(vi.mocked(fetchMemoryItems)).toHaveBeenCalledWith(1, 30, { status: "failed" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ask Echo about Docker notes" }));
    expect(onAskAbout).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(
      screen.getByRole("link", { name: /Open source of Docker notes/ }),
    ).toHaveAttribute("href", "https://example.dev/a");
  });

  it("shows empty and error states with a working retry", async () => {
    vi.mocked(fetchMemoryItems).mockResolvedValueOnce(page([]));
    const { unmount } = render(
      <MemoryTimelineView onSelectItem={vi.fn()} onAskAbout={vi.fn()} />,
    );
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    unmount();

    vi.mocked(fetchMemoryItems)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(page([item("a", "Docker notes")]));
    render(<MemoryTimelineView onSelectItem={vi.fn()} onAskAbout={vi.fn()} />);
    expect(await screen.findByText("Could not load your memories")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Docker notes")).toBeInTheDocument();
  });
});

describe("IntelligenceView", () => {
  const base = {
    isLoading: false,
    loadError: null,
    onRetry: vi.fn(),
    onSelectItem: vi.fn(),
  };

  it("shows a real overview, attention list and contextual questions", async () => {
    const onAsk = vi.fn();
    const onOpenTimeline = vi.fn();
    render(
      <IntelligenceView
        {...base}
        items={[
          item("a", "Docker notes"),
          item("v", "Sliding window lecture", { source_type: "youtube" }),
          item("f", "Broken page", { status: "failed", processing_error: "No readable text" }),
        ]}
        onAsk={onAsk}
        onOpenTimeline={onOpenTimeline}
      />,
    );

    expect(await screen.findByText(/3 memories · 2 ready for Ask/)).toBeInTheDocument();
    const attention = screen.getByRole("heading", { name: "Needs attention" }).parentElement!;
    expect(within(attention).getByText("No readable text")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Summarize “Docker notes”" }));
    expect(onAsk).toHaveBeenCalledWith("Summarize “Docker notes”", { scope: undefined, send: true });

    fireEvent.click(screen.getByRole("button", { name: "See all failed captures" }));
    expect(onOpenTimeline).toHaveBeenCalledWith({ status: "failed" });

    fireEvent.click(screen.getByRole("button", { name: "1 video" }));
    expect(onOpenTimeline).toHaveBeenCalledWith({ source: "youtube" });
  });

  it("sends a typed question straight to Ask", async () => {
    const onAsk = vi.fn();
    render(
      <IntelligenceView {...base} items={[]} onAsk={onAsk} onOpenTimeline={vi.fn()} />,
    );
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ask Echo a question"), {
      target: { value: "What is a heap?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Echo" }));
    expect(onAsk).toHaveBeenCalledWith("What is a heap?", { send: true });
  });
});
