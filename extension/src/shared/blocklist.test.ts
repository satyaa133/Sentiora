import { describe, expect, it } from "vitest";
import { isPdfUrl, isSentioraAppUrl, isUrlBlocked } from "./blocklist";

describe("capture URL blocklist", () => {
  it("blocks banking and tax domains", () => {
    expect(isUrlBlocked("https://www.chase.com/login")).toBe(true);
    expect(isUrlBlocked("https://paypal.com/signin")).toBe(true);
    expect(isUrlBlocked("https://turbotax.intuit.com/")).toBe(true);
  });

  it("allows ordinary article URLs", () => {
    expect(isUrlBlocked("https://docs.example.com/binary-search")).toBe(false);
  });

  it("blocks browser internals but allows local PDF files", () => {
    expect(isUrlBlocked("chrome://extensions")).toBe(true);
    expect(isUrlBlocked("file:///C:/notes/secret.html")).toBe(true);
    expect(isUrlBlocked("file:///C:/docs/TCS%20NQT.pdf", { allowLocalPdf: true })).toBe(false);
    expect(isPdfUrl("file:///C:/docs/TCS%20NQT.pdf")).toBe(true);
  });

  it("blocks the live app but allows synthetic manual vault URLs", () => {
    expect(isSentioraAppUrl("http://localhost:5173/dashboard")).toBe(true);
    expect(isSentioraAppUrl("https://sentiora.app/notes/123")).toBe(false);
    expect(isUrlBlocked("https://sentiora.app/manual/123")).toBe(false);
  });
});
