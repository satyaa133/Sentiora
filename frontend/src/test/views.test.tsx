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
import MemoryTimelineView from "../components/views/MemoryTimelineView";
import PrivacyCenterView from "../components/views/PrivacyCenterView";
import SearchView from "../components/views/SearchView";
import Login from "../pages/Login";
import type { MemoryItem } from "../types/memory";

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

describe("Timeline and Search", () => {
  it("groups the timeline by day and shows an empty state", () => {
    const { unmount } = render(
      <MemoryTimelineView
        items={[item("a", "Docker notes")]}
        isLoading={false}
        onSelectItem={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/Today/);
    unmount();
    render(<MemoryTimelineView items={[]} isLoading={false} onSelectItem={vi.fn()} />);
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("finds memories and reports no results", () => {
    const onSelect = vi.fn();
    render(<SearchView items={[item("a", "Docker notes")]} onSelectItem={onSelect} />);
    const input = screen.getByLabelText("Search your memories");
    fireEvent.change(input, { target: { value: "docker" } });
    fireEvent.click(screen.getByRole("button", { name: /Docker notes/ }));
    expect(onSelect).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "kubernetes" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});

describe("PrivacyCenterView", () => {
  it("adds and removes a blocked site", () => {
    render(<PrivacyCenterView items={[]} />);
    fireEvent.change(screen.getByLabelText("Site to block"), {
      target: { value: "https://Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add site" }));
    expect(screen.getByText("example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove example.com" }));
    expect(screen.getByText("No sites added yet.")).toBeInTheDocument();
  });
});
