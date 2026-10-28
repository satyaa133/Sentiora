import axios, { AxiosError } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getApiErrorMessage, refreshAccessToken } from "./apiClient";
import { clearAuthStorage, getAccessToken, getRefreshToken, setAuthTokens } from "./authStorage";

const user = { id: "u1", email: "vansh@example.com" };

describe("getApiErrorMessage", () => {
  it("maps throttled login responses to a retry message", () => {
    const err = {
      response: {
        status: 429,
        data: { error: { code: "AUTH_LOGIN_THROTTLED", message: "Try again in 8 seconds." } },
      },
    };
    expect(getApiErrorMessage(err, "fallback")).toContain("Try again");
  });

  it("explains a network failure instead of showing axios's raw message", () => {
    const err = new AxiosError("Network Error", "ERR_NETWORK");
    expect(getApiErrorMessage(err, "fallback")).toBe(
      "Could not reach the Sentiora server. Check your connection and try again.",
    );
  });

  it("does not describe every server error as a sign-in failure", () => {
    const err = { response: { status: 502, data: {} } };
    expect(getApiErrorMessage(err, "fallback")).toBe(
      "The Sentiora server ran into a problem. Please try again in a moment.",
    );
  });
});


afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("refreshAccessToken", () => {
  it("shares one refresh request between concurrent callers", async () => {
    setAuthTokens("old-access", "old-refresh", user);
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { success: true, data: { access_token: "new-access", refresh_token: "new-refresh" } },
    });
    const synced = vi.fn();
    window.addEventListener("sentiora_auth_sync", synced);

    // StrictMode runs the auth init effect twice; a 401 can race it too.
    const tokens = await Promise.all([refreshAccessToken(), refreshAccessToken()]);

    window.removeEventListener("sentiora_auth_sync", synced);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(expect.stringContaining("/auth/refresh-token"), {
      refresh_token: "old-refresh",
    });
    expect(tokens).toEqual(["new-access", "new-access"]);
    expect(getAccessToken()).toBe("new-access");
    expect(getRefreshToken()).toBe("new-refresh");
    // The extension mirror keeps the user and receives the rotated token.
    const mirror = JSON.parse(localStorage.getItem("sentiora_auth_session") ?? "{}");
    expect(mirror).toMatchObject({ refreshToken: "new-refresh", user });
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("allows a new refresh once the previous one settled", async () => {
    setAuthTokens("a", "r1", user);
    const post = vi
      .spyOn(axios, "post")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        data: { success: true, data: { access_token: "a2", refresh_token: "r2" } },
      });

    await expect(refreshAccessToken()).rejects.toThrow("network down");
    await expect(refreshAccessToken()).resolves.toBe("a2");
    expect(post).toHaveBeenCalledTimes(2);
  });
});

/** Minimal Web Locks stand-in: runs tasks for the same name one at a time, like the browser. */
function installFakeLocks() {
  const queues = new Map<string, Promise<unknown>>();
  const locks = {
    request: <T>(name: string, task: () => Promise<T>): Promise<T> => {
      const previous = queues.get(name) ?? Promise.resolve();
      const next = previous.then(task, task);
      queues.set(name, next.catch(() => undefined));
      return next;
    },
  };
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  return () => Reflect.deleteProperty(navigator, "locks");
}

/** A second browser tab: same localStorage, its own copy of the module state. */
async function openTab() {
  vi.resetModules();
  return import("./apiClient");
}

describe("refreshAccessToken across tabs", () => {
  it("rotates once when two tabs refresh at the same time", async () => {
    const removeLocks = installFakeLocks();
    setAuthTokens("a1", "r1", user);
    // The backend revokes every session if a refresh token is spent twice.
    const spent = new Set<string>();
    const post = vi.spyOn(axios, "post").mockImplementation(async (_url, body) => {
      const token = (body as { refresh_token: string }).refresh_token;
      if (spent.has(token)) throw new AxiosError("reused", "ERR_BAD_REQUEST");
      spent.add(token);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: { success: true, data: { access_token: "a2", refresh_token: "r2" } } };
    });

    const tabA = await openTab();
    const tabB = await openTab();
    const tokens = await Promise.all([tabA.refreshAccessToken(), tabB.refreshAccessToken()]);

    removeLocks();
    expect(post).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(["a2", "a2"]);
    expect(getRefreshToken()).toBe("r2");
    expect(getAccessToken()).toBe("a2");
  });

  it("still rotates normally when another tab refreshed earlier", async () => {
    const removeLocks = installFakeLocks();
    setAuthTokens("a2", "r2", user);
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { success: true, data: { access_token: "a3", refresh_token: "r3" } },
    });

    const tab = await openTab();
    await expect(tab.refreshAccessToken()).resolves.toBe("a3");

    removeLocks();
    expect(post).toHaveBeenCalledWith(expect.stringContaining("/auth/refresh-token"), {
      refresh_token: "r2",
    });
    expect(getRefreshToken()).toBe("r3");
  });

  it("does not refresh after logout in another tab", async () => {
    const removeLocks = installFakeLocks();
    setAuthTokens("a1", "r1", user);
    clearAuthStorage();
    const post = vi.spyOn(axios, "post");

    const tab = await openTab();
    await expect(tab.refreshAccessToken()).rejects.toThrow("No refresh token");

    removeLocks();
    expect(post).not.toHaveBeenCalled();
  });

  it("signs the tab out when the session was invalidated on the server", async () => {
    setAuthTokens("expired", "revoked", user);
    vi.spyOn(axios, "post").mockRejectedValue(new AxiosError("revoked", "ERR_BAD_REQUEST"));
    const loggedOut = vi.fn();
    window.addEventListener("auth:logout", loggedOut);

    const tab = await openTab();
    // Every request answers 401, as it would once the access token has expired.
    tab.default.defaults.adapter = async (config) => {
      throw new AxiosError("unauthorized", "ERR_BAD_REQUEST", config, null, {
        status: 401,
        statusText: "Unauthorized",
        headers: {},
        config,
        data: {},
      });
    };
    await expect(tab.default.get("/users/me")).rejects.toThrow("revoked");

    window.removeEventListener("auth:logout", loggedOut);
    expect(loggedOut).toHaveBeenCalledTimes(1);
    expect(getRefreshToken()).toBeNull();
    expect(localStorage.getItem("sentiora_auth_session")).toBeNull();
  });
});
