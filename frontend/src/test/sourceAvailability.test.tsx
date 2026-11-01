import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConnectedSourcesView from "../components/views/ConnectedSourcesView";
import Onboarding from "../pages/Onboarding";
import type * as MemoryService from "../services/memoryService";
import {
  AVAILABLE_SOURCE_IDS,
  SOURCE_CATALOG,
  type SourcePreferencesMap,
} from "../types/sourcePreferences";

const completeOnboardingMock = vi.fn();
const updateSourcePreferenceMock = vi.fn();
let sourcePreferences: Partial<SourcePreferencesMap> = {};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    completeOnboarding: completeOnboardingMock,
    updateSourcePreference: updateSourcePreferenceMock,
    user: { source_preferences: sourcePreferences },
  }),
}));

vi.mock("../services/memoryService", async (importOriginal) => {
  const actual = await importOriginal<typeof MemoryService>();
  return { ...actual, createMemoryItem: vi.fn().mockResolvedValue({}) };
});

afterEach(() => {
  cleanup();
  completeOnboardingMock.mockReset();
  updateSourcePreferenceMock.mockReset();
  sourcePreferences = {};
});

describe("source catalog", () => {
  it("marks only web pages, YouTube and PDFs as available", () => {
    expect([...AVAILABLE_SOURCE_IDS].sort()).toEqual(["pdf", "webpages", "youtube"]);
    expect(SOURCE_CATALOG.filter((s) => !s.available).map((s) => s.id).sort()).toEqual(
      ["chatgpt", "github", "notion", "substack", "twitter"],
    );
  });
});

describe("Onboarding sources step", () => {
  function renderOnboarding() {
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
  }

  it("disables Coming soon cards so they can't be selected", async () => {
    renderOnboarding();
    const notion = await screen.findByRole("checkbox", { name: /Notion/ });
    expect(notion).toBeDisabled();
    expect(notion).not.toBeChecked();
    fireEvent.click(notion);
    fireEvent.click(screen.getByText("Notion"));
    expect(notion).not.toBeChecked();

    const pdf = screen.getByRole("checkbox", { name: /PDFs & Documents/ });
    expect(pdf).toBeEnabled();
    fireEvent.click(pdf);
    expect(pdf).toBeChecked();

    expect(screen.getAllByText("Coming soon")).toHaveLength(5);
  });

  it("submits only available sources", async () => {
    completeOnboardingMock.mockResolvedValue(undefined);
    renderOnboarding();
    fireEvent.click(await screen.findByRole("checkbox", { name: /GitHub/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /PDFs & Documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Go to Home/ }));

    await waitFor(() => expect(completeOnboardingMock).toHaveBeenCalledTimes(1));
    const submitted = completeOnboardingMock.mock.calls[0]?.[0] as string[];
    expect(submitted.sort()).toEqual(["pdf", "webpages", "youtube"]);
  });
});

describe("ConnectedSourcesView availability", () => {
  it("shows Coming soon instead of a connect control for unavailable sources", () => {
    render(<ConnectedSourcesView />);
    fireEvent.click(screen.getByRole("button", { name: "Add a source" }));
    const dialog = screen.getByRole("dialog");

    const notionRow = within(dialog).getByText("Notion Workspace Sync").closest("li");
    expect(notionRow).not.toBeNull();
    expect(within(notionRow as HTMLElement).getByText("Coming soon")).toBeInTheDocument();
    expect(within(notionRow as HTMLElement).queryByRole("button")).toBeNull();

    expect(within(dialog).getAllByText("Coming soon")).toHaveLength(5);
    expect(
      within(dialog).getByRole("button", { name: "Add YouTube Transcript Extractor" }),
    ).toBeInTheDocument();
  });

  it("ignores old active or paused preferences for unavailable sources", () => {
    sourcePreferences = {
      webpages: "active",
      notion: "active",
      github: "paused",
    };
    render(<ConnectedSourcesView />);

    const list = screen.getByRole("region", { name: "Your sources" });
    expect(within(list).getByText("Chrome Browser Extension")).toBeInTheDocument();
    expect(within(list).queryByText("Notion Workspace Sync")).toBeNull();
    expect(within(list).queryByText("GitHub Repositories & Gists")).toBeNull();
    expect(screen.getByText("Active sources").nextElementSibling).toHaveTextContent("1");
  });
});
