import { describe, expect, it, beforeEach } from "vitest";
import { clearAuthStorage, getAccessToken, getRefreshToken, setAuthTokens } from "./authStorage";

describe("authStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stores access tokens in sessionStorage and refresh tokens in localStorage", () => {
    setAuthTokens("access-1", "refresh-1", { id: "u1", email: "a@example.com" });
    expect(getAccessToken()).toBe("access-1");
    expect(getRefreshToken()).toBe("refresh-1");
    expect(localStorage.getItem("access_token")).toBeNull();
    const bridge = JSON.parse(localStorage.getItem("sentiora_auth_session") ?? "{}");
    expect(bridge.accessToken).toBe("access-1");
    clearAuthStorage();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(localStorage.getItem("sentiora_auth_session")).toBeNull();
  });
});
