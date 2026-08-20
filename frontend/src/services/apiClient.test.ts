import { describe, expect, it } from "vitest";
import { getApiErrorMessage } from "./apiClient";

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
});
