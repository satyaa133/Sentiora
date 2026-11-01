import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  getCachedUser: vi.fn(),
  setCachedUser: vi.fn(),
  setAccessToken: vi.fn(),
  setRefreshToken: vi.fn(),
  clearAllAuthData: vi.fn(),
  getUserBlockedDomains: vi.fn(),
}));
vi.mock("../services/storage", () => storage);

const api = vi.hoisted(() => ({
  extApiFetch: vi.fn(),
  attemptTokenRefresh: vi.fn(),
}));
vi.mock("../services/extApiClient", () => ({
  ...api,
  API_DISPLAY_URL: "http://localhost:8000",
  ExtApiError: class ExtApiError extends Error {},
}));

import App from "./App";

type ForceCaptureReply = Record<string, unknown>;

function installChrome(options: {
  url: string;
  title: string;
  forceCapture?: ForceCaptureReply;
  captureResult?: Record<string, unknown>;
  /** Background record for the page; defaults to not saved. */
  pageStatus?: string;
  /** Content-script page check (password field, noindex). */
  sensitivity?: string | null;
}) {
  const tab = { id: 7, url: options.url, title: options.title };
  const chromeMock = {
    runtime: {
      lastError: undefined as unknown,
      id: "ext",
      sendMessage: vi.fn(
        (message: { type: string }, callback?: (r: unknown) => void) => {
          if (message.type.startsWith("CAPTURE_")) callback?.(options.captureResult);
          if (message.type === "GET_PAGE_STATUS") {
            callback?.({ status: options.pageStatus ?? "not_saved" });
          }
        },
      ),
    },
    tabs: {
      query: vi.fn((_query: unknown, callback?: (tabs: unknown[]) => void) => {
        if (callback) {
          callback([tab]);
          return undefined;
        }
        return Promise.resolve([tab]);
      }),
      sendMessage: vi.fn(
        (
          _id: number,
          message: { type: string },
          _opts: unknown,
          callback: (r: unknown) => void,
        ) => {
          if (message.type === "PING") callback({ ok: true });
          else if (message.type === "GET_SENSITIVITY") {
            callback({ reason: options.sensitivity ?? null });
          } else callback(options.forceCapture);
        },
      ),
      create: vi.fn(),
    },
    scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
  };
  vi.stubGlobal("chrome", chromeMock);
  return chromeMock;
}

function signedIn() {
  storage.getAccessToken.mockResolvedValue("token");
  storage.getRefreshToken.mockResolvedValue("refresh");
  storage.getCachedUser.mockResolvedValue({ id: "u1", email: "me@example.com" });
}

const RECENT = {
  total: 12,
  items: [
    {
      id: "m1",
      title: "Attention is all you need",
      source_type: "pdf",
      captured_at: new Date().toISOString(),
    },
    {
      id: "m2",
      title: "System design: rate limiters",
      source_type: "youtube",
      captured_at: new Date().toISOString(),
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.getUserBlockedDomains.mockResolvedValue([]);
  api.extApiFetch.mockImplementation(async (path: string) =>
    path.startsWith("/memory-items?") ? { data: RECENT } : { data: {} },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("popup", () => {
  it("shows the sign-in form when logged out", async () => {
    storage.getAccessToken.mockResolvedValue(null);
    storage.getRefreshToken.mockResolvedValue(null);
    storage.getCachedUser.mockResolvedValue(null);
    installChrome({ url: "https://blog.example.dev/post", title: "A post" });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Sign in to Sentiora" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("shows the ready state with the page and recent saves", async () => {
    signedIn();
    installChrome({
      url: "https://blog.example.dev/post",
      title: "Understanding containers",
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Understanding containers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" && el.textContent === "Article · blog.example.dev",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save now" })).toBeEnabled();
    expect(await screen.findByText("Attention is all you need")).toBeInTheDocument();
    expect(screen.getByText("System design: rate limiters")).toBeInTheDocument();
    expect(api.extApiFetch).toHaveBeenCalledWith("/memory-items?per_page=2");
  });

  it("saves, then undoes with the existing DELETE endpoint", async () => {
    signedIn();
    installChrome({
      url: "https://blog.example.dev/post",
      title: "Understanding containers",
      forceCapture: {
        success: true,
        payload: {
          source_type: "webpage",
          url: "https://blog.example.dev/post",
          title: "Understanding containers",
          content: "Body",
        },
      },
      captureResult: { success: true, status: "pending", memoryId: "new-1" },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Save now" }));

    expect(await screen.findByText("Saved. Echo's got it.")).toBeInTheDocument();
    expect(screen.getByText("Searchable in a few seconds.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });

    expect(api.extApiFetch).toHaveBeenCalledWith("/memory-items/new-1", {
      method: "DELETE",
    });
    expect(await screen.findByText("Removed from your memory.")).toBeInTheDocument();
  });

  it("hides Undo when the save was deduplicated", async () => {
    signedIn();
    installChrome({
      url: "https://blog.example.dev/post",
      title: "Understanding containers",
      forceCapture: {
        success: true,
        payload: {
          source_type: "webpage",
          url: "https://blog.example.dev/post",
          title: "x",
          content: "y",
        },
      },
      captureResult: { success: true, deduplicated: true },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Save now" }));

    expect(await screen.findByText("Saved. Echo's got it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("opens on the protected state for a built-in rule, without reading the page", async () => {
    signedIn();
    const chromeMock = installChrome({
      url: "https://www.chase.com/accounts",
      title: "Accounts",
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Echo won't save this page" }),
    ).toBeInTheDocument();
    expect(screen.getByText("www.chase.com")).toBeInTheDocument();
    expect(screen.getByText("Built-in rule")).toBeInTheDocument();
    expect(
      chromeMock.tabs.sendMessage.mock.calls.some(([, m]) => m.type === "FORCE_CAPTURE"),
    ).toBe(false);

    const why = screen.getByRole("button", { name: "Why was this blocked?" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
  });

  it("labels sites the user blocked in Privacy as their rule", async () => {
    signedIn();
    storage.getUserBlockedDomains.mockResolvedValue(["blog.example.dev"]);
    installChrome({ url: "https://blog.example.dev/post", title: "A post" });

    render(<App />);

    expect(await screen.findByText("Your rule")).toBeInTheDocument();
    expect(
      screen.getByText("You blocked this site in Privacy, so Echo skips it."),
    ).toBeInTheDocument();
  });

  it("shows a page-level block (password field) without a rule chip", async () => {
    signedIn();
    installChrome({
      url: "https://forum.example.dev/members",
      title: "Members",
      sensitivity: "password_field",
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Echo won't save this page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Built-in rule")).not.toBeInTheDocument();
    expect(screen.queryByText("Your rule")).not.toBeInTheDocument();
  });

  it("shows an automatically saved page as saved, with no save button", async () => {
    signedIn();
    installChrome({
      url: "https://blog.example.dev/post",
      title: "Understanding containers",
      pageStatus: "saved",
    });

    render(<App />);

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save now" })).not.toBeInTheDocument();
  });

  it("shows the protected state when the content script skips a manual save", async () => {
    signedIn();
    installChrome({
      url: "https://blog.example.dev/post",
      title: "A post",
      forceCapture: { skipped: true, reason: "sensitive" },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Save now" }));

    expect(
      await screen.findByRole("heading", { name: "Echo won't save this page" }),
    ).toBeInTheDocument();
  });

  it("shows the error state with a retry", async () => {
    signedIn();
    const chromeMock = installChrome({
      url: "https://blog.example.dev/post",
      title: "Understanding containers",
      forceCapture: { skipped: true, reason: "insufficient_content" },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Save now" }));

    expect(
      await screen.findByRole("heading", { name: "Echo couldn't save this page" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not extract readable content from this page.",
    );

    const forceCalls = () =>
      chromeMock.tabs.sendMessage.mock.calls.filter(
        ([, m]) => m.type === "FORCE_CAPTURE",
      ).length;
    expect(forceCalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(forceCalls()).toBe(2));
  });
});
