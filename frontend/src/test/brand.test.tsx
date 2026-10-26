import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
  it("renders the lowercase wordmark", () => {
    render(<Logo />);
    expect(screen.getByText("sentiora")).toBeInTheDocument();
  });

  it("names the mark when shown alone", () => {
    render(<Logo markOnly />);
    expect(screen.getByRole("img", { name: "Sentiora" })).toBeInTheDocument();
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
