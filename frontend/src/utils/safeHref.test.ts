import { describe, expect, it } from "vitest";
import { safeHref } from "./safeHref";

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
