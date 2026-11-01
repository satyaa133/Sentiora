import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SearchView from "../components/views/SearchView";
import type { SearchHit } from "../services/askService";
import type { MemoryItem } from "../types/memory";

const searchMemoriesMock = vi.fn<(q: string, signal?: AbortSignal) => Promise<SearchHit[]>>();
vi.mock("../services/askService", () => ({
  searchMemories: (q: string, signal?: AbortSignal) => searchMemoriesMock(q, signal),
}));

function item(id: string, title: string, content: string): MemoryItem {
  const at = new Date().toISOString();
  return {
    id,
    user_id: "u1",
    source_type: "webpage",
    url: `https://example.dev/${id}`,
    title,
    content,
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
  } as MemoryItem;
}

const feed = { isLoading: false, loadError: null, onRetry: vi.fn() };

afterEach(() => {
  cleanup();
  searchMemoriesMock.mockReset();
});

describe("SearchView semantic search", () => {
  it("shows a semantic hit that the text filter alone would miss", async () => {
    const containers = item("c1", "Container basics", "Namespaces isolate processes from each other.");
    searchMemoriesMock.mockResolvedValue([
      {
        memory_id: "c1",
        chunk_id: "k1",
        title: containers.title,
        url: containers.url,
        source_type: "webpage",
        content: "Namespaces isolate processes from each other.",
        heading: null,
        page_number: null,
        captured_at: containers.captured_at,
        distance: 0.2,
      },
    ]);
    render(<SearchView items={[containers]} {...feed} onSelectItem={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search your memories"), {
      target: { value: "isolating processes" },
    });
    // No false "No results" while the semantic matches are on their way.
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    expect(await screen.findByRole("button", { name: /Container basics/ })).toBeInTheDocument();
    expect(searchMemoriesMock).toHaveBeenCalledTimes(1);
    expect(searchMemoriesMock).toHaveBeenCalledWith("isolating processes", expect.any(AbortSignal));
    expect(screen.getByRole("status")).toHaveTextContent("1 result");
  });

  it("keeps the local matches when the search request fails", async () => {
    searchMemoriesMock.mockRejectedValue(new Error("API down"));
    render(
      <SearchView
        items={[item("d1", "Docker notes", "Images and layers.")]}
        {...feed}
        onSelectItem={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search your memories"), {
      target: { value: "docker" },
    });

    await waitFor(() => expect(searchMemoriesMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Searching/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Docker notes/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 result");
  });

  it("settles on No results when the request fails and nothing matches locally", async () => {
    searchMemoriesMock.mockRejectedValue(new Error("API down"));
    render(<SearchView items={[]} {...feed} onSelectItem={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search your memories"), {
      target: { value: "anything" },
    });
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });
});
