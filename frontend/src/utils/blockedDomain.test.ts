import { describe, expect, it } from "vitest";
import { normalizeBlockedDomain } from "./blockedDomain";

describe("normalizeBlockedDomain", () => {
  it("keeps only the domain the extension enforces", () => {
    expect(normalizeBlockedDomain("https://www.Reddit.com/r/all")).toBe("reddit.com");
    expect(normalizeBlockedDomain("news.example.co.uk:8080/x?y=1")).toBe("news.example.co.uk");
  });

  it("rejects input that is not a domain", () => {
    for (const input of ["hello", "", "   ", "http://", "not a site.com"]) {
      expect(normalizeBlockedDomain(input)).toBeNull();
    }
  });
});
