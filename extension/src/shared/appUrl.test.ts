import { describe, expect, it, vi } from "vitest";
import { APP_URL, appPageUrl, isTrustedAppUrl } from "./appUrl";

describe("configured app URL", () => {
  it("defaults to the local dev frontend", () => {
    expect(APP_URL).toBe("http://localhost:5173");
    expect(appPageUrl("/dashboard")).toBe("http://localhost:5173/dashboard");
    expect(appPageUrl("onboarding")).toBe("http://localhost:5173/onboarding");
  });

  it("trusts only the exact configured origin", () => {
    expect(isTrustedAppUrl("http://localhost:5173/dashboard?x=1")).toBe(true);
    for (const url of [
      "http://localhost:5174/",
      "https://localhost:5173/",
      "http://127.0.0.1:5173/",
      "https://sentiora.attacker.example/",
      "http://localhost:5173.attacker.example/",
      "javascript:alert(1)",
      "not a url",
      undefined,
    ]) {
      expect(isTrustedAppUrl(url)).toBe(false);
    }
  });
});

describe("origin trust edge cases", () => {
  it("rejects userinfo, lookalike, subdomain and scheme tricks", () => {
    for (const url of [
      "http://localhost:5173@evil.example/",
      "http://evil.example/@localhost:5173",
      "http://evil.example/#http://localhost:5173",
      "http://evil.example/?u=http://localhost:5173",
      "http://app.localhost:5173/",
      "http://localhost.:5173/",
      "ws://localhost:5173/",
    ]) {
      expect(isTrustedAppUrl(url), url).toBe(false);
    }
  });

  it("matches a configured https origin exactly, not its lookalikes or subdomains", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_APP_URL", "https://sentiora.example/");
    try {
      const mod = await import("./appUrl");
      expect(mod.APP_URL).toBe("https://sentiora.example");
      expect(mod.isTrustedAppUrl("https://sentiora.example/dashboard")).toBe(true);
      expect(mod.isTrustedAppUrl("https://SENTIORA.example:443/x")).toBe(true);
      for (const url of [
        "http://sentiora.example/",
        "https://sentiora.example.attacker.com/",
        "https://app.sentiora.example/",
        "https://sentiora.example:8443/",
        "https://evilsentiora.example/",
        "http://localhost:5173/",
      ]) {
        expect(mod.isTrustedAppUrl(url), url).toBe(false);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("trusts nothing when VITE_APP_URL is malformed (fails closed)", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_APP_URL", "not a url");
    try {
      const mod = await import("./appUrl");
      expect(mod.isTrustedAppUrl("http://localhost:5173/")).toBe(false);
      expect(mod.isTrustedAppUrl("not a url")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
