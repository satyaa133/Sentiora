import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CornerEcho from "../components/echo/CornerEcho";
import { emitEcho, onEcho, type EchoEvent } from "../components/echo/echoEvents";
import { echoModeFor } from "../components/echo/echoMode";
import { useEchoFeedEvents } from "../hooks/useEchoFeedEvents";
import type { MemoryItem } from "../types/memory";

vi.mock("../services/dashboardService", async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardService>();
  return { ...actual, fetchStatistics: vi.fn() };
});
import { fetchStatistics } from "../services/dashboardService";
import type * as DashboardService from "../services/dashboardService";

function memory(id: string, title: string, createdAt: string): MemoryItem {
  return { id, title, created_at: createdAt, captured_at: createdAt } as MemoryItem;
}

/** Events emitted during each test of the calling describe block. */
function collect(): EchoEvent[] {
  const events: EchoEvent[] = [];
  let stop = () => {};
  beforeEach(() => {
    events.length = 0;
    stop = onEcho((event) => events.push(event));
  });
  afterEach(() => stop());
  return events;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(fetchStatistics).mockResolvedValue({ total: 5 } as DashboardService.DashboardStatistics);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("echo events", () => {
  it("delivers to subscribers until they unsubscribe, and survives a broken listener", () => {
    const seen: string[] = [];
    const stopBroken = onEcho(() => {
      throw new Error("boom");
    });
    const stop = onEcho((event) => seen.push(event.type));
    emitEcho({ type: "ask" });
    stop();
    stopBroken();
    emitEcho({ type: "ask" });
    expect(seen).toEqual(["ask"]);
  });
});

describe("echo mode by route", () => {
  it("puts Echo in the corner on logged-in app pages only", () => {
    expect(echoModeFor("/dashboard", true)).toBe("corner");
    expect(echoModeFor("/timeline/", true)).toBe("corner");
    expect(echoModeFor("/dashboard", false)).toBeNull();
    expect(echoModeFor("/login", true)).toBeNull();
    expect(echoModeFor("/onboarding", true)).toBeNull();
    expect(echoModeFor("/dev/components", false)).toBeNull();
  });

  it("lets Echo roam on the landing page and on 404s, signed in or not", () => {
    expect(echoModeFor("/", false)).toBe("roam");
    expect(echoModeFor("/", true)).toBe("roam");
    expect(echoModeFor("/some/old-link", false)).toBe("roam");
    expect(echoModeFor("/dashboards", true)).toBe("roam");
  });
});

describe("feed events for Echo", () => {
  const events = collect();
  const older = memory("a", "Older", "2026-10-20T10:00:00Z");
  const newest = memory("b", "Newest", "2026-10-25T10:00:00Z");

  it("stays quiet on the first load, then announces genuinely new memories", () => {
    const { rerender } = renderHook(
      ({ items, ready, key }) => useEchoFeedEvents(items, ready, key),
      { initialProps: { items: [] as MemoryItem[], ready: false, key: "" } },
    );
    rerender({ items: [newest, older], ready: true, key: "b,a" });
    expect(events).toEqual([]);

    const added = memory("c", "Docker containers", "2026-10-25T12:00:00Z");
    rerender({ items: [added, newest, older], ready: true, key: "c,b,a" });
    expect(events).toEqual([
      { type: "saved", title: "Docker containers", count: 1 },
      { type: "feed-changed" },
    ]);
  });

  it("does not call an older memory new when it slides into the window after a delete", () => {
    const { rerender } = renderHook(
      ({ items, key }) => useEchoFeedEvents(items, true, key),
      { initialProps: { items: [newest], key: "b" } },
    );
    rerender({ items: [older], key: "a" });
    expect(events.filter((event) => event.type === "saved")).toEqual([]);
    expect(events).toContainEqual({ type: "feed-changed" });
  });
});

describe("corner Echo", () => {
  it("shows the real memory total with a text label", async () => {
    render(<CornerEcho />);
    expect(await screen.findByText("5 memories")).toBeInTheDocument();
  });

  it("chomps, then smiles, with the new memory's title on a real save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<CornerEcho />);
    act(() =>
      emitEcho({ type: "saved", title: "Understanding Docker containers, from namespaces up", count: 1 }),
    );
    expect(container.querySelector("[data-echo-state]")).toHaveAttribute("data-echo-state", "chomp");
    expect(screen.getByText("+1 Understanding Docker containers…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(700));
    expect(container.querySelector("[data-echo-state]")).toHaveAttribute("data-echo-state", "happy");
  });

  it("refetches the total when the feed changes", async () => {
    render(<CornerEcho />);
    await screen.findByText("5 memories");
    vi.mocked(fetchStatistics).mockResolvedValue({ total: 6 } as DashboardService.DashboardStatistics);
    act(() => emitEcho({ type: "feed-changed" }));
    // The counter re-mounts to replay its coral flash; wait for the flashing one.
    await waitFor(() => expect(screen.getByText("6 memories")).toHaveClass("echo-count-flash"));
  });

  it("reacts to answers and navigation with short lines", () => {
    render(<CornerEcho />);
    act(() => emitEcho({ type: "answer", status: "ready", cited: true }));
    expect(screen.getByText("Answer ready, with sources")).toBeInTheDocument();
    act(() => emitEcho({ type: "navigate", tab: "privacy" }));
    expect(screen.getByText("Keeping watch")).toBeInTheDocument();
  });

  it("falls asleep after 20 seconds without input and wakes on input", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { container } = render(<CornerEcho />);
    act(() => vi.advanceTimersByTime(21_000));
    expect(container.querySelector("[data-echo-state]")).toHaveAttribute("data-echo-state", "sleeping");
    act(() => {
      fireEvent.keyDown(window, { key: "a" });
    });
    expect(container.querySelector("[data-echo-state]")).toHaveAttribute("data-echo-state", "idle");
  });

  it("pauses: remembers the choice and ignores events", () => {
    const { container } = render(<CornerEcho />);
    fireEvent.click(screen.getByRole("button", { name: "Pause Echo" }));
    expect(screen.getByRole("button", { name: "Wake Echo" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sentiora-echo-paused")).toBe("1");
    act(() => emitEcho({ type: "saved", title: "Ignored", count: 1 }));
    expect(screen.queryByText("+1 Ignored")).not.toBeInTheDocument();
    expect(container.querySelector("[data-echo-state]")).toHaveAttribute("data-echo-state", "idle");
  });

  it("makes no sound, and creates no audio context, until sound is turned on", async () => {
    const audio = vi.fn(function FakeAudioContext(this: Record<string, unknown>) {
      const node = () => ({
        connect: vi.fn().mockReturnThis(),
        gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        frequency: { setValueAtTime: vi.fn() },
        start: vi.fn(),
        stop: vi.fn(),
        type: "sine",
      });
      Object.assign(this, {
        currentTime: 0,
        state: "running",
        destination: {},
        createGain: node,
        createOscillator: node,
        resume: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      });
    });
    vi.stubGlobal("AudioContext", audio);

    const { container } = render(<CornerEcho />);
    act(() => emitEcho({ type: "saved", title: "Quiet", count: 1 }));
    fireEvent.click(container.querySelector("[data-echo-state]")!.parentElement!);
    expect(audio).not.toHaveBeenCalled();

    const toggle = screen.getByRole("button", { name: "Sound off" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Sound on" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("sentiora-echo-sound")).toBe("1");
    await waitFor(() => expect(audio).toHaveBeenCalledTimes(1));
  });
});
