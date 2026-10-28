import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import AddMemoryModal from "../components/AddMemoryModal";
import MemoryDetailDrawer from "../components/MemoryDetailDrawer";
import PrivacyCenterView from "../components/views/PrivacyCenterView";
import SearchView from "../components/views/SearchView";
import Login from "../pages/Login";
import { searchMemories } from "../services/askService";
import type * as AskService from "../services/askService";
import { fetchMemoryItems } from "../services/memoryService";
import type * as MemoryService from "../services/memoryService";
import type { MemoryItem } from "../types/memory";

vi.mock("../services/askService", async (importOriginal) => {
  const actual = await importOriginal<typeof AskService>();
  return { ...actual, searchMemories: vi.fn() };
});
vi.mock("../services/memoryService", async (importOriginal) => {
  const actual = await importOriginal<typeof MemoryService>();
  return { ...actual, fetchMemoryItems: vi.fn() };
});

const loginMock = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ login: loginMock, user: null }),
}));

function item(id: string, title: string, extra: Partial<MemoryItem> = {}): MemoryItem {
  const at = new Date().toISOString();
  return {
    id,
    user_id: "u1",
    source_type: "webpage",
    url: `https://example.dev/${id}`,
    title,
    content: `${title} body text.`,
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
    ...extra,
  } as MemoryItem;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  loginMock.mockReset();
});

describe("Login", () => {
  function renderLogin() {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
  }

  it("shows field errors linked to their inputs", () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Email address is required.",
    );
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("toggles password visibility with a labelled button", () => {
    renderLogin();
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("MemoryDetailDrawer", () => {
  it("asks for confirmation before deleting", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <MemoryDetailDrawer
        item={item("a", "Docker notes")}
        onClose={onClose}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Docker notes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog", { name: "Delete this memory?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("a"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the failure reason for failed memories", () => {
    render(
      <MemoryDetailDrawer
        item={item("f", "Broken page", {
          status: "failed",
          processing_error: "Too short.",
        })}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Too short.");
  });
});

describe("AddMemoryModal", () => {
  it("is a labelled dialog that disables saving until required fields are filled", () => {
    render(<AddMemoryModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Add a memory" });
    const save = within(dialog).getByRole("button", { name: "Save memory" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "Notes" },
    });
    fireEvent.change(within(dialog).getByLabelText("Content"), {
      target: { value: "Body" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
    expect(within(dialog).getByRole("button", { name: "PDF" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

// Timeline is server-driven now; its tests live in timelineIntelligence.test.tsx.
describe("Search", () => {
  const feed = { isLoading: false, loadError: null, onRetry: vi.fn() };

  it("finds memories and reports no results", async () => {
    vi.mocked(searchMemories).mockResolvedValue([]);
    const onSelect = vi.fn();
    render(<SearchView items={[item("a", "Docker notes")]} {...feed} onSelectItem={onSelect} />);
    const input = screen.getByLabelText("Search your memories");
    fireEvent.change(input, { target: { value: "docker" } });
    fireEvent.click(screen.getByRole("button", { name: /Docker notes/ }));
    expect(onSelect).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "kubernetes" } });
    // Shown once the semantic search has answered too, never before.
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  it("shows a load failure with a retry instead of an empty vault", () => {
    const onRetry = vi.fn();
    const failed = { isLoading: false, loadError: "API down", onRetry };
    render(<SearchView items={[]} {...failed} onSelectItem={vi.fn()} />);
    expect(screen.getByText("Could not load your memories")).toBeInTheDocument();
  });
});

describe("PrivacyCenterView", () => {
  it("adds and removes a blocked site", () => {
    render(<PrivacyCenterView />);
    fireEvent.change(screen.getByLabelText("Site to block"), {
      target: { value: "https://Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add site" }));
    expect(screen.getByText("example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove example.com" }));
    expect(screen.getByText("No sites added yet.")).toBeInTheDocument();
  });

  it("refuses an entry that is not a site instead of listing a rule that blocks nothing", () => {
    render(<PrivacyCenterView />);
    fireEvent.change(screen.getByLabelText("Site to block"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Add site" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a site like example.com.");
    expect(screen.getByText("No sites added yet.")).toBeInTheDocument();
  });

  it("exports every page of memories, not just the loaded feed", async () => {
    const page = (n: number, hasMore: boolean) => ({
      items: [{ id: `m${n}` } as MemoryItem],
      total: 2,
      page: n,
      per_page: 100,
      has_more: hasMore,
    });
    vi.mocked(fetchMemoryItems)
      .mockResolvedValueOnce(page(1, true))
      .mockResolvedValueOnce(page(2, false));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let exported: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      exported = blob;
      return "blob:export";
    });
    URL.revokeObjectURL = vi.fn();
    render(<PrivacyCenterView />);
    fireEvent.click(screen.getByRole("button", { name: /Download JSON/ }));
    expect(await screen.findByText("Your export has downloaded.")).toBeInTheDocument();
    expect(fetchMemoryItems).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(exported!);
    });
    expect(JSON.parse(text).total_items).toBe(2);
    click.mockRestore();
  });
});
