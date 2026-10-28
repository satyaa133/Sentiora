import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { onEcho, type EchoEvent } from "../components/echo/echoEvents";
import {
  KONAMI,
  createClickCounter,
  createSequenceMatcher,
  createWordMatcher,
  isTypingTarget,
} from "../components/echo/roam/easterEggs";
import RoamingEcho from "../components/echo/roam/RoamingEcho";
import { insideAny, nearestIndex, randomPoint, steer } from "../components/echo/roam/steering";
import NotFound from "../pages/NotFound";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("steering", () => {
  const options = { maxSpeed: 4, maxForce: 0.5, arriveRadius: 100 };

  it("accelerates toward the target without exceeding top speed", () => {
    let pos = { x: 0, y: 0 };
    let vel = { x: 0, y: 0 };
    for (let i = 0; i < 40; i += 1) ({ pos, vel } = steer(pos, vel, { x: 1000, y: 0 }, options));
    expect(pos.x).toBeGreaterThan(50);
    expect(Math.hypot(vel.x, vel.y)).toBeLessThanOrEqual(4.0001);
    expect(Math.abs(pos.y)).toBeLessThan(0.001);
  });

  it("eases in and settles on the target", () => {
    let pos = { x: 0, y: 0 };
    let vel = { x: 0, y: 0 };
    for (let i = 0; i < 600; i += 1) ({ pos, vel } = steer(pos, vel, { x: 150, y: 80 }, options));
    expect(Math.hypot(pos.x - 150, pos.y - 80)).toBeLessThan(2);
  });

  it("picks wander points outside padded no-go boxes", () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 400 };
    const avoid = [{ left: 0, top: 0, right: 300, bottom: 400 }];
    let seed = 0;
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 20; i += 1) {
      expect(insideAny(randomPoint(bounds, avoid, 20, random), avoid, 20)).toBe(false);
    }
  });

  it("finds the nearest point", () => {
    expect(nearestIndex({ x: 0, y: 0 }, [{ x: 9, y: 9 }, { x: 1, y: 2 }, { x: -5, y: 0 }])).toBe(1);
    expect(nearestIndex({ x: 0, y: 0 }, [])).toBe(-1);
  });
});

describe("easter egg detectors", () => {
  it("matches the Konami code, recovering from a wrong key", () => {
    const match = createSequenceMatcher(KONAMI);
    expect(["ArrowUp", "x", ...KONAMI.slice(0, -1)].map(match).some(Boolean)).toBe(false);
    expect(match("A")).toBe(true);
  });

  it("matches a typed word", () => {
    const boo = createWordMatcher("boo");
    expect(["b", "o", "Shift", "o"].map(boo)).toEqual([false, false, false, true]);
  });

  it("counts seven quick clicks, not seven slow ones", () => {
    const fast = createClickCounter(7, 3000);
    expect([0, 100, 200, 300, 400, 500].map(fast).some(Boolean)).toBe(false);
    expect(fast(600)).toBe(true);
    const slow = createClickCounter(7, 3000);
    expect([0, 1000, 2000, 3000, 4000, 5000, 6000].map(slow).some(Boolean)).toBe(false);
  });

  it("ignores keys typed into fields", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });
});

describe("roaming Echo", () => {
  it("is decorative, with the pause and sound controls left reachable", () => {
    const { container } = render(<RoamingEcho easterEggs />);
    const layer = container.querySelector('[data-echo-mode="roam"]');
    expect(layer).toHaveAttribute("aria-hidden", "true");
    const pause = screen.getByRole("button", { name: "Pause Echo" });
    expect(layer?.contains(pause)).toBe(false);
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: "Wake Echo" })).toBeInTheDocument();
  });

  it("answers 'boo' on the landing page, but not while typing in a field", () => {
    const { container } = render(
      <>
        <input aria-label="field" />
        <RoamingEcho easterEggs />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "field" });
    for (const key of "boo") fireEvent.keyDown(field, { key });
    expect(container.querySelector(".echo-bubble")).toBeNull();
    act(() => {
      for (const key of "boo") fireEvent.keyDown(window, { key });
    });
    expect(container.querySelector(".echo-bubble")).toHaveTextContent("hey, that's MY line!");
  });

  it("has no easter eggs off the landing page", () => {
    const { container } = render(<RoamingEcho easterEggs={false} />);
    act(() => {
      for (const key of "boo") fireEvent.keyDown(window, { key });
    });
    expect(container.querySelector(".echo-bubble")).toBeNull();
  });

  it("giggles when tickled and reports nothing it did not eat", () => {
    const events: EchoEvent[] = [];
    const stop = onEcho((event) => events.push(event));
    const { container } = render(<RoamingEcho easterEggs />);
    const body = container.querySelector(".cursor-grab") as HTMLElement;
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(body, { clientX: 10, clientY: 10 });
    expect(container.querySelector(".echo-bubble")).toHaveTextContent("hehe!");
    expect(events.filter((event) => event.type === "landing-saved")).toEqual([]);
    stop();
  });
});

describe("404 page", () => {
  it("says Echo couldn't find the page and links home and to the dashboard", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Echo couldn't find this page." })).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Open your dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});
