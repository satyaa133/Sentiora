import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import LiveDemo from "../components/landing/demo/LiveDemo";
import LandingNav from "../components/landing/LandingNav";
import {
  DEMO_FALLBACK,
  DEMO_LIBRARIES,
  findDemoAnswer,
  splitCitations,
} from "../components/landing/demo/demoLibrary";
import { emitEcho } from "../components/echo/echoEvents";
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
    // The swapping word is aria-hidden; the heading's name stays "read.".
    expect(
      screen.getByRole("heading", { level: 1, name: "Remember everything you read." }),
    ).toBeInTheDocument();
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

describe("hero", () => {
  it("lists the three trust points", () => {
    stubReducedMotion(false);
    renderLanding();
    const hero = screen.getByRole("region", { name: "Remember everything you read." });
    for (const point of [
      "Saves automatically while signed in",
      "Skips banking, health and login pages",
      "Export or delete anytime",
    ]) {
      expect(within(hero).getByText(point)).toBeInTheDocument();
    }
  });

  it("keeps the hero word still under reduced motion", () => {
    vi.useFakeTimers();
    stubReducedMotion(true);
    const { container } = renderLanding();
    act(() => vi.advanceTimersByTime(6000));
    expect(container.querySelector(".hero-swap")).toHaveAttribute("data-word", "read");
    vi.useRealTimers();
  });
});

describe("landing header", () => {
  it("links every section and shows Echo's count once it has eaten", () => {
    stubReducedMotion(false);
    render(
      <MemoryRouter>
        <LandingNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "How it works",
      "Extension",
      "Ask",
      "Privacy",
      "FAQ",
    ]);
    expect(screen.queryByText(/Echo saved/)).not.toBeInTheDocument();
    act(() => emitEcho({ type: "landing-saved", total: 3 }));
    expect(screen.getByText("Echo saved 3")).toBeInTheDocument();
  });
});

describe("live demo data", () => {
  it("matches prepared questions exactly and by keyword", () => {
    const students = DEMO_LIBRARIES.students;
    expect(findDemoAnswer(students, "What causes a deadlock?")?.sources).toEqual([2]);
    expect(findDemoAnswer(students, "explain BCNF to me")?.question).toBe("What are the normal forms?");
    expect(findDemoAnswer(students, "best pizza in town")).toBeNull();
  });

  it("every library has 10 items and 4 answers whose citations point at real items", () => {
    for (const library of Object.values(DEMO_LIBRARIES)) {
      expect(library.items).toHaveLength(10);
      expect(library.qas).toHaveLength(4);
      for (const qa of library.qas) {
        const cites = splitCitations(qa.answer).flatMap((part) => ("cite" in part ? [part.cite] : []));
        expect(cites.length).toBeGreaterThan(0);
        for (const cite of cites) expect(qa.sources[cite - 1]).toBeDefined();
        for (const index of qa.sources) expect(library.items[index]).toBeDefined();
      }
    }
  });

  it("splits answers into text and citation markers", () => {
    expect(splitCitations("A [1]. B [2].")).toEqual([
      { text: "A" },
      { cite: 1 },
      { text: "." + " B" },
      { cite: 2 },
      { text: "." },
    ]);
  });
});

describe("live demo", () => {
  it("answers a suggestion with citations and lights up the cited items", () => {
    stubReducedMotion(true);
    const { container } = render(<LiveDemo />);
    fireEvent.click(screen.getByRole("button", { name: "What causes a deadlock?" }));
    expect(screen.getByText(/Four conditions must hold together/)).toBeInTheDocument();
    const sources = screen.getByRole("list", { name: "Sources" });
    expect(within(sources).getByText("OS: deadlocks explained")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-cited]")).toHaveLength(1);
  });

  it("says plainly when the sample library has no answer", () => {
    stubReducedMotion(true);
    render(<LiveDemo />);
    fireEvent.change(screen.getByLabelText("Ask the sample library"), {
      target: { value: "best pizza in town" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText(DEMO_FALLBACK)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("switches audience with its own library", () => {
    stubReducedMotion(true);
    render(<LiveDemo />);
    fireEvent.click(screen.getByRole("tab", { name: "Developers" }));
    expect(screen.getByRole("button", { name: "How do containers differ from VMs?" })).toBeInTheDocument();
    expect(screen.getByText("Postgres indexing guide")).toBeInTheDocument();
  });

  it("autoplays its own questions and never touches the network", () => {
    vi.useFakeTimers();
    stubReducedMotion(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const open = vi.spyOn(XMLHttpRequest.prototype, "open");
    render(<LiveDemo />);
    act(() => vi.advanceTimersByTime(2_500));
    expect(screen.getByText(/1NF removes repeating groups/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(30_000));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
