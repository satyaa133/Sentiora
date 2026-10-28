import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ThisWeekChart from "../components/views/ThisWeekChart";
import { citationStart, videoJumpUrl, videoStart } from "../utils/videoJump";


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
    expect(citationStart({ start_sec: 75.6, heading: "[00:00–01:30]" })).toEqual({ seconds: 75, label: "01:15" });
    expect(citationStart({ start_sec: 3735, heading: null })).toEqual({ seconds: 3735, label: "1:02:15" });
    expect(citationStart({ start_sec: null, heading: "[14:20–16:05]" })).toEqual({ seconds: 860, label: "14:20" });
  });

  it("only builds jump links for YouTube", () => {
    expect(videoJumpUrl("https://www.youtube.com/watch?v=abc", 860)).toBe(
      "https://www.youtube.com/watch?v=abc&t=860s",
    );
    expect(videoJumpUrl("https://example.dev/talk", 860)).toBeNull();
  });
});
