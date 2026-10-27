import { afterEach, describe, expect, it } from "vitest";
import { getPageSensitivityReason, isCurrentPageSensitive } from "./sensitiveGuard";

function visitUrl(url: string): void {
  window.history.replaceState(null, "", url);
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  visitUrl("/");
});

describe("sensitive page guard", () => {
  it("flags visible password fields", () => {
    document.body.innerHTML = `<input type="password" style="width:120px;height:32px" />`;
    const input = document.querySelector("input") as HTMLInputElement;
    Object.defineProperty(input, "getBoundingClientRect", {
      value: () => ({ width: 120, height: 32, top: 0, left: 0, bottom: 32, right: 120 }),
    });
    expect(getPageSensitivityReason()).toBe("password_field");
    expect(isCurrentPageSensitive()).toBe(true);
  });

  it("flags noindex pages", () => {
    document.head.innerHTML = `<meta name="robots" content="noindex, nofollow" />`;
    document.body.innerHTML = `<p>Private article</p>`;
    expect(getPageSensitivityReason()).toBe("noindex");
  });

  it("flags sign-in URLs before looking at the page", () => {
    visitUrl("/account/login");
    document.body.innerHTML = `<p>Welcome back</p>`;
    expect(getPageSensitivityReason()).toBe("blocked_url");
  });

  it("flags sites the user blocked, including subdomains", () => {
    visitUrl("/articles/1");
    const host = window.location.hostname;
    document.body.innerHTML = `<p>An article</p>`;
    expect(getPageSensitivityReason()).toBeNull();
    expect(getPageSensitivityReason([host])).toBe("user_blocked");
    expect(isCurrentPageSensitive([host])).toBe(true);
  });
});
