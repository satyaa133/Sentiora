import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AskSentioraView from "../components/views/AskSentioraView";
import ThisWeekChart from "../components/views/ThisWeekChart";
import { videoJumpUrl, videoStart } from "../utils/videoJump";

vi.mock("../services/askService", async (importOriginal) => {
  const actual = await importOriginal<typeof AskService>();
  return { ...actual, askSentiora: vi.fn() };
});
vi.mock("../services/memoryService", async (importOriginal) => {
  const actual = await importOriginal<typeof MemoryService>();
  return { ...actual, createMemoryItem: vi.fn() };
});
import { askSentiora } from "../services/askService";
import type * as AskService from "../services/askService";
import { createMemoryItem } from "../services/memoryService";
import type * as MemoryService from "../services/memoryService";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function days(counts: number[]) {
  return counts.map((count, i) => ({ date: `2026-10-${String(14 + i).padStart(2, "0")}`, count }));
}

describe("This week chart (DESIGN.md §5.4)", () => {
  it("plots the last 7 days of real counts with an accessible list", () => {
    render(<ThisWeekChart daily={days([9, 9, 9, 9, 9, 9, 9, 0, 2, 0, 5, 1, 0, 3])} />);
    const list = screen.getByRole("list", { name: "Saves per day, last 7 days" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("11 saves")).toBeInTheDocument();
    expect(list).toHaveTextContent(/5 saves/);
  });

  it("says so plainly when nothing was saved, and when stats are unavailable", () => {
    const { rerender } = render(<ThisWeekChart daily={days([0, 0, 0, 0, 0, 0, 0])} />);
    expect(screen.getByText("Nothing saved in the last 7 days.")).toBeInTheDocument();
    rerender(<ThisWeekChart daily={null} />);
    expect(screen.getByText("Statistics are unavailable right now.")).toBeInTheDocument();
  });
});

describe("video jump links (DESIGN.md §5.5)", () => {
  it("reads the start of the transcript range from the chunk heading", () => {
    expect(videoStart("Docker talk [14:20–16:05]")).toEqual({ seconds: 860, label: "14:20" });
    expect(videoStart("Long lecture [1:02:15–1:05:00]")).toEqual({ seconds: 3735, label: "1:02:15" });
    expect(videoStart("Multi-stage builds")).toBeNull();
    expect(videoStart(null)).toBeNull();
  });

  it("only builds jump links for YouTube", () => {
    expect(videoJumpUrl("https://www.youtube.com/watch?v=abc", 860)).toBe(
      "https://www.youtube.com/watch?v=abc&t=860s",
    );
    expect(videoJumpUrl("https://example.dev/talk", 860)).toBeNull();
  });
});

describe("Ask answer actions (DESIGN.md §5.5)", () => {
  async function askOnce() {
    vi.mocked(askSentiora).mockResolvedValue({
      answer: "Use multi-stage builds [1].",
      citations: [
        {
          memory_id: "v",
          chunk_id: "c1",
          title: "Production Dockerfiles, a talk",
          url: "https://www.youtube.com/watch?v=abc",
          source_type: "youtube",
          domain: "youtube.com",
          heading: "Production Dockerfiles [14:20–16:05]",
          page_number: null,
          source_available: true,
        },
      ],
      insufficient_context: false,
    });
    render(<AskSentioraView items={[]} />);
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "How do I keep images small?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findByRole("button", { name: "Save as note" });
  }

  it("offers Jump to the cited moment of a video", async () => {
    await askOnce();
    const jump = screen.getAllByRole("link", { name: /Jump to 14:20/ })[0];
    expect(jump).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc&t=860s");
  });

  it("saves the question, answer and sources as a note memory", async () => {
    vi.mocked(createMemoryItem).mockResolvedValue({} as Awaited<ReturnType<typeof createMemoryItem>>);
    await askOnce();
    fireEvent.click(screen.getByRole("button", { name: "Save as note" }));
    expect(await screen.findByRole("button", { name: "Saved as note" })).toBeDisabled();
    const payload = vi.mocked(createMemoryItem).mock.calls[0]?.[0];
    expect(payload?.url).toMatch(/^https:\/\/sentiora\.app\/notes\/\d+$/);
    expect(payload?.title).toBe("Note: How do I keep images small?");
    expect(payload?.content).toContain("Use multi-stage builds [1].");
    expect(payload?.content).toContain("[1] Production Dockerfiles, a talk");
  });

  it("renders '*' bullets as list items without stray asterisks", async () => {
    vi.mocked(askSentiora).mockResolvedValue({
      answer: "Revalidation works like this:\n\n*   **304 Response**: reuse the stored copy.",
      citations: [],
      insufficient_context: false,
    });
    render(<AskSentioraView items={[]} />);
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "How does revalidation work?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent("304 Response: reuse the stored copy.");
    expect(item.textContent).not.toContain("*");
    expect(within(item).getByText("304 Response").tagName).toBe("STRONG");
  });

  it("keeps fenced code as one block, with comments not turned into headings", async () => {
    vi.mocked(askSentiora).mockResolvedValue({
      answer: "Here it is:\n\n```python\ndef f(n):\n    # Base case\n    return 1\n```\nDone.",
      citations: [],
      insufficient_context: false,
    });
    const { container } = render(<AskSentioraView items={[]} />);
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "Show code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findByText("Done.");
    const code = container.querySelector("pre code");
    expect(code?.textContent).toBe("def f(n):\n    # Base case\n    return 1");
    expect(screen.queryByRole("heading", { name: "Base case" })).toBeNull();
  });

  it("says so when the note could not be saved", async () => {
    vi.mocked(createMemoryItem).mockRejectedValue(new Error("offline"));
    await askOnce();
    fireEvent.click(screen.getByRole("button", { name: "Save as note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save this note.");
  });
});
