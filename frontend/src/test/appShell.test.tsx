import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CommandPalette from "../components/CommandPalette";
import HomeView from "../components/views/HomeView";
import type { MemoryItem } from "../types/memory";
import { dayLabel, savedAgo } from "../utils/dates";
import { pickResurfaced } from "../utils/resurface";


const NOW = new Date("2026-10-25T18:00:00Z");

function item(
  id: string,
  title: string,
  daysAgo: number,
  extra: Partial<MemoryItem> = {},
): MemoryItem {
  const at = new Date(NOW.getTime() - daysAgo * 864e5).toISOString();
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
    word_count: 100,
    reading_time_seconds: 60,
    status: "ready",
    captured_at: at,
    created_at: at,
    ...extra,
  } as MemoryItem;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("dates", () => {
  it("labels days relative to now", () => {
    expect(dayLabel(NOW.toISOString(), NOW)).toBe("Today");
    expect(dayLabel(new Date(NOW.getTime() - 864e5).toISOString(), NOW)).toBe(
      "Yesterday",
    );
    expect(savedAgo(new Date(NOW.getTime() - 42 * 864e5).toISOString(), NOW)).toBe(
      "saved 6 weeks ago",
    );
  });
});

describe("pickResurfaced", () => {
  it("only picks ready memories at least two weeks old", () => {
    const items = [
      item("new", "New", 3),
      item("old", "Old", 20),
      item("wip", "Wip", 30, { status: "pending" }),
    ];
    expect(pickResurfaced(items, new Set(), NOW)?.id).toBe("old");
  });

  it("returns null when nothing qualifies or everything is dismissed", () => {
    expect(pickResurfaced([item("new", "New", 3)], new Set(), NOW)).toBeNull();
    expect(pickResurfaced([item("old", "Old", 20)], new Set(["old"]), NOW)).toBeNull();
  });
});

function renderHome(
  items: MemoryItem[],
  overrides: Partial<Parameters<typeof HomeView>[0]> = {},
) {
  const props = {
    name: "Vansh",
    items,
    isLoading: false,
    loadError: null,
    isSyncing: false,
    status: null,
    searchQuery: "",
    onSearchQueryChange: vi.fn(),
    onRetry: vi.fn(),
    onSync: vi.fn(),
    onAddMemory: vi.fn(),
    onSelectItem: vi.fn(),
    onAsk: vi.fn(),
    onOpenPalette: vi.fn(),
    onViewTimeline: vi.fn(),
    ...overrides,
  };
  render(<HomeView {...props} />);
  return props;
}

describe("HomeView", () => {
  it("shows a resurfaced card for an old memory and hides it on Not now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    renderHome([
      item("a", "Fresh page", 0),
      item("b", "CAP theorem, plainly explained", 42),
    ]);

    const card = screen.getByRole("region", { name: "CAP theorem, plainly explained" });
    expect(within(card).getByText(/saved 6 weeks ago/i)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Not now" }));
    expect(
      screen.queryByRole("region", { name: "CAP theorem, plainly explained" }),
    ).toBeNull();
  });

  it("has no resurfaced card when every memory is recent", () => {
    renderHome([item("a", "Fresh page", 0)]);
    expect(screen.queryByText(/Resurfaced/)).toBeNull();
  });

  it("filters recent memories by type", () => {
    renderHome([
      item("a", "A web page", 0),
      item("p", "A paper", 0, { source_type: "pdf" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    const recent = screen.getByRole("region", { name: "Recent memories" });
    expect(within(recent).getByRole("button", { name: /A paper/ })).toBeInTheDocument();
    expect(within(recent).queryByRole("button", { name: /A web page/ })).toBeNull();
  });

  it("shows the faded empty state with no memories", () => {
    renderHome([]);
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("sends a suggestion to Ask", () => {
    const props = renderHome([item("a", "A web page", 0)]);
    fireEvent.click(screen.getByRole("button", { name: "What did I save this week?" }));
    expect(props.onAsk).toHaveBeenCalledWith("What did I save this week?");
  });
});

describe("CommandPalette", () => {
  it("finds memories by title and asks Sentiora on Enter", () => {
    const onAsk = vi.fn();
    const onOpenMemory = vi.fn();
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        items={[item("d", "Understanding Docker containers", 0)]}
        onNavigate={vi.fn()}
        onAsk={onAsk}
        onOpenMemory={onOpenMemory}
      />,
    );
    const input = screen.getByRole("combobox", {
      name: "Search memories or ask a question",
    });
    fireEvent.change(input, { target: { value: "dock" } });
    expect(
      screen.getByRole("option", { name: /Understanding Docker containers/ }),
    ).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenMemory).toHaveBeenCalledOnce();
  });
});
