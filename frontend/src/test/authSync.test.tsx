import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClient>();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
vi.mock("../services/sourcePreferencesService", () => ({
  fetchSourcePreferences: vi.fn().mockResolvedValue({ onboarding_completed: true, sources: {} }),
  completeOnboarding: vi.fn(),
  updateSourcePreference: vi.fn(),
}));

import { AuthProvider, useAuth } from "../context/AuthContext";
import apiClient from "../services/apiClient";
import type * as ApiClient from "../services/apiClient";
import { setAuthTokens } from "../services/authStorage";

function Who() {
  const { user } = useAuth();
  return <p>{user ? `signed in as ${user.email}` : "signed out"}</p>;
}

const meCalls = () =>
  vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === "/users/me").length;

beforeEach(() => {
  vi.mocked(apiClient.get).mockResolvedValue({
    data: { success: true, data: { id: "u1", email: "ada@gmail.com", is_email_verified: true } },
  });
  setAuthTokens("access-1", "refresh-1", { id: "u1", email: "ada@gmail.com" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("auth sync between tabs and the extension", () => {
  it("does not answer its own sync announcement (no request loop)", async () => {
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    );
    expect(await screen.findByText("signed in as ada@gmail.com")).toBeInTheDocument();
    // Let any echoed announcements (custom event, window message) play out.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const settled = meCalls();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(meCalls()).toBe(settled); // nothing keeps refetching
    expect(settled).toBeLessThanOrEqual(2);
  });

  it("still picks up new tokens from another tab", async () => {
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    );
    await screen.findByText("signed in as ada@gmail.com");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = meCalls();
    window.dispatchEvent(
      new CustomEvent("sentiora_auth_sync", {
        detail: { accessToken: "access-2", refreshToken: "refresh-2" },
      }),
    );
    await waitFor(() => expect(sessionStorage.getItem("access_token")).toBe("access-2"));
    await waitFor(() => expect(meCalls()).toBe(before + 1));
  });
});
