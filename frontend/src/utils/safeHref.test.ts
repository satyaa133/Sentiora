import { describe, expect, it } from "vitest";
import { safeHref, sourceHref } from "./safeHref";

describe("sourceHref", () => {
  it("links real pages", () => {
    expect(sourceHref("https://developer.mozilla.org/x")).toBe("https://developer.mozilla.org/x");
    expect(sourceHref("https://sentiora.app/pricing")).toBe("https://sentiora.app/pricing");
  });

  it("gives no link for notes, uploads, the welcome memory and files", () => {
    for (const url of [
      "https://sentiora.app/notes/1793169915225",
      "https://sentiora.app/manual/uploads/cn-notes.txt",
      "https://sentiora.app/welcome",
      "file://uploads/a.pdf",
    ]) {
      expect(sourceHref(url)).toBeUndefined();
    }
  });
});

describe("safeHref", () => {
  it("allows http and https", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://localhost:5173/x")).toBe("http://localhost:5173/x");
  });

  it("drops script, data, file and malformed URLs", () => {
    for (const url of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<b>x</b>", "file:///C:/doc.pdf", "not a url", "", null]) {
      expect(safeHref(url)).toBeUndefined();
    }
  });
});
