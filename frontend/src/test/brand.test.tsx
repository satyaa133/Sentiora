import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Echo, { type EchoState } from "@shared/ui/Echo";
import Logo from "@shared/ui/Logo";
import { IconSearch } from "@shared/ui/icons";

afterEach(cleanup);

const STATES: EchoState[] = ["idle", "saving", "happy", "faded", "guarding"];

describe("Echo", () => {
  it.each(STATES)("renders the %s state", (state) => {
    const { container } = render(<Echo state={state} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("data-echo-state", state);
    expect(svg).toHaveAttribute("viewBox", "0 0 120 120");
  });

  it("is hidden from assistive tech without a title", () => {
    const { container } = render(<Echo />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes its title as an accessible name", () => {
    render(<Echo state="guarding" title="Echo is guarding this page" />);
    expect(
      screen.getByRole("img", { name: "Echo is guarding this page" }),
    ).toBeInTheDocument();
  });

  it("bobs when idle unless told to stay still", () => {
    const { container, rerender } = render(<Echo state="idle" />);
    expect(container.querySelector("svg")).toHaveClass("echo-bob");
    rerender(<Echo state="idle" still />);
    expect(container.querySelector("svg")).not.toHaveClass("echo-bob");
  });

  it("uses tokens, not raw colours", () => {
    const { container } = render(
      <>
        {STATES.map((state) => (
          <Echo key={state} state={state} />
        ))}
      </>,
    );
    for (const el of container.querySelectorAll("[fill], [stroke]")) {
      for (const attr of ["fill", "stroke"]) {
        const value = el.getAttribute(attr);
        if (value && value !== "none" && value !== "currentColor") {
          expect(value).toMatch(/^var\(--[\w-]+\)$/);
        }
      }
    }
  });
});

describe("Logo", () => {
  function mockReducedMotion(reduce: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: reduce && query.includes("reduce"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is one image named sentiora, built from per-letter spans", () => {
    mockReducedMotion(false);
    const { container } = render(<Logo />);
    const mark = screen.getByRole("img", { name: "sentiora" });
    const letters = mark.querySelectorAll(".logo-letter");
    expect([...letters].map((l) => l.textContent).join("")).toBe("sentıora");
    for (const letter of letters) expect(letter).toHaveAttribute("aria-hidden", "true");
    // The coral dot sits on the dotless ı; the ghost is gone from the logo.
    expect(mark.querySelector(".logo-i [data-logo-dot]")).not.toBeNull();
    expect(container.querySelector("path")).toBeNull();
  });

  it("waves after load and on hover", () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    render(<Logo />);
    const mark = screen.getByRole("img", { name: "sentiora" });
    expect(mark).not.toHaveClass("logo-waving");
    act(() => vi.advanceTimersByTime(1200));
    expect(mark).toHaveClass("logo-waving");
    act(() => vi.advanceTimersByTime(1300));
    expect(mark).not.toHaveClass("logo-waving");
    fireEvent.mouseEnter(mark);
    expect(mark).toHaveClass("logo-waving");
  });

  it("never waves under reduced motion", () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    render(<Logo />);
    const mark = screen.getByRole("img", { name: "sentiora" });
    act(() => vi.advanceTimersByTime(12_000));
    fireEvent.mouseEnter(mark);
    expect(mark).not.toHaveClass("logo-waving");
  });

  it("shows the compact ı-and-dot mark, named, when shown alone", () => {
    mockReducedMotion(false);
    const { container } = render(<Logo markOnly />);
    expect(screen.getByRole("img", { name: "sentiora" })).toBeInTheDocument();
    expect(container.querySelector("circle")).toHaveAttribute("fill", "var(--accent)");
  });
});

describe("icons", () => {
  it("are decorative by default and labelled when titled", () => {
    const { container, rerender } = render(<IconSearch />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    rerender(<IconSearch title="Search" />);
    expect(screen.getByRole("img", { name: "Search" })).toBeInTheDocument();
  });
});
