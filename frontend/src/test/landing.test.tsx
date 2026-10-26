import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import LandingPage from "../pages/LandingPage";

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LandingPage", () => {
  it("renders the sections in order", () => {
    stubReducedMotion(false);
    renderLanding();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Remember everything you read.",
    );
    expect(headings).toEqual([
      "Save it once. Find it by what it meant.",
      "Ask your own library, not the whole internet.",
      "Your memory stays yours.",
      "Questions",
      "Give your reading a memory.",
    ]);
  });

  it("does not claim pages save only on click (the extension auto-saves)", () => {
    stubReducedMotion(false);
    const { container } = renderLanding();
    expect(container.textContent).not.toMatch(/only when you click|until you click/i);
  });

  it("links Add to Chrome to sign-up until a store URL exists", () => {
    stubReducedMotion(false);
    renderLanding();
    for (const link of screen.getAllByRole("link", { name: /Add to Chrome/ })) {
      expect(link).toHaveAttribute("href", "/onboarding");
    }
  });

  it("uses native details for the FAQ and leaves pricing as TODO", () => {
    stubReducedMotion(false);
    renderLanding();
    const faq = screen.getByRole("region", { name: "Questions" });
    expect(faq.querySelectorAll("details")).toHaveLength(4);
    expect(within(faq).getByText("[TODO]")).toBeInTheDocument();
  });

  it("stacks How it works when reduced motion is preferred", () => {
    stubReducedMotion(true);
    renderLanding();
    const section = screen.getByRole("region", {
      name: "Save it once. Find it by what it meant.",
    });
    expect(section.querySelectorAll("[aria-current]")).toHaveLength(0);
    expect(within(section).getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });
});
