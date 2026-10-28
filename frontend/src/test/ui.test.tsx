import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  Chip,
  IconButton,
  IconSettings,
  MemoryList,
  MemoryRow,
  Modal,
  SourceBadge,
  Tabs,
  Tag,
  TextField,
  ThemeToggle,
  ToastProvider,
  Toggle,
  useToast,
} from "@shared/ui";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
  vi.useRealTimers();
});

describe("Button", () => {
  it("defaults to type=button and disables while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("gives icon-only buttons an accessible name", () => {
    render(<IconButton label="Settings" icon={<IconSettings />} />);
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("TextField", () => {
  it("links the label and the error message", () => {
    render(<TextField label="Email" error="Enter a valid email." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email.");
  });
});

describe("Chip and Tag", () => {
  it("exposes chip selection with aria-pressed", () => {
    render(<Chip selected>All</Chip>);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("labels the tag remove button", () => {
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>docker</Tag>);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag docker" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe("SourceBadge", () => {
  it.each([
    ["webpage", "Web"],
    ["pdf", "PDF"],
    ["youtube", "Video"],
    ["note", "Note"],
  ])("maps %s to %s", (type, name) => {
    const { container } = render(<SourceBadge type={type} />);
    expect(container.querySelector(".sr-only")).toHaveTextContent(name);
  });
});

describe("MemoryRow", () => {
  it("is a button when selectable", () => {
    const onSelect = vi.fn();
    render(
      <MemoryList>
        <MemoryRow
          title="A saved page"
          sourceType="webpage"
          dateLabel="Today"
          onSelect={onSelect}
        />
      </MemoryList>,
    );
    fireEvent.click(screen.getByRole("button", { name: /A saved page/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe("Toggle", () => {
  it("is a labelled switch", () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <Toggle label="Auto-detect sensitive pages" checked={on} onChange={setOn} />
      );
    }
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Auto-detect sensitive pages" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

describe("Tabs", () => {
  it("moves selection with arrow keys", () => {
    render(
      <Tabs
        label="Detail"
        items={[
          { id: "a", label: "Content", panel: "Content panel" },
          { id: "b", label: "Notes", panel: "Notes panel" },
        ]}
      />,
    );
    const first = screen.getByRole("tab", { name: "Content" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("tab", { name: "Notes" });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Notes panel");
  });
});

describe("Modal", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Delete this memory?">
          <button type="button">Confirm</button>
        </Modal>
      </>
    );
  }

  it("moves focus in, closes on Escape and restores focus", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Delete this memory?" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const close = screen.getByRole("button", { name: "Close" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() => toast.show({ message: "Saved.", duration: 1000 })}
      >
        Show
      </button>
    );
  }

  it("announces and auto-dismisses", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("Saved.");
  });
});

describe("ThemeToggle", () => {
  it("applies and persists the chosen theme", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("sentiora-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
