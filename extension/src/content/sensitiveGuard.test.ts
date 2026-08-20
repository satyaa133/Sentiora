import { describe, expect, it } from "vitest";
import { getPageSensitivityReason, isCurrentPageSensitive } from "./sensitiveGuard";

describe("sensitive page guard", () => {
  it("flags visible password fields for both auto and manual capture", () => {
    document.head.innerHTML = "";
    document.body.innerHTML = `<input type="password" style="width:120px;height:32px" />`;
    const input = document.querySelector("input") as HTMLInputElement;
    Object.defineProperty(input, "getBoundingClientRect", {
      value: () => ({ width: 120, height: 32, top: 0, left: 0, bottom: 32, right: 120 }),
    });
    expect(getPageSensitivityReason()).toBe("password_field");
    expect(isCurrentPageSensitive(true)).toBe(true);
    expect(isCurrentPageSensitive(false)).toBe(true);
  });

  it("flags noindex pages", () => {
    document.head.innerHTML = `<meta name="robots" content="noindex, nofollow" />`;
    document.body.innerHTML = `<p>Private article</p>`;
    expect(getPageSensitivityReason()).toBe("noindex");
  });
});
