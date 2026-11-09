import { describe, expect, it } from "vitest";
import { isTrustedEmail } from "./trustedEmail";

describe("isTrustedEmail", () => {
  it("approves popular email providers", () => {
    expect(isTrustedEmail("user@gmail.com")).toBe(true);
    expect(isTrustedEmail("user@googlemail.com")).toBe(true);
    expect(isTrustedEmail("user@outlook.com")).toBe(true);
    expect(isTrustedEmail("user@hotmail.com")).toBe(true);
    expect(isTrustedEmail("user@yahoo.com")).toBe(true);
    expect(isTrustedEmail("user@icloud.com")).toBe(true);
    expect(isTrustedEmail("user@proton.me")).toBe(true);
    expect(isTrustedEmail("user@protonmail.com")).toBe(true);
    expect(isTrustedEmail("user@zoho.com")).toBe(true);
    expect(isTrustedEmail("user@example.com")).toBe(true);
  });

  it("approves educational email domains", () => {
    expect(isTrustedEmail("student@stanford.edu")).toBe(true);
    expect(isTrustedEmail("scholar@oxford.ac.uk")).toBe(true);
    expect(isTrustedEmail("alumni@iitb.edu.in")).toBe(true);
  });

  it("rejects unknown or disposable providers", () => {
    expect(isTrustedEmail("spam@10minutemail.com")).toBe(false);
    expect(isTrustedEmail("anon@tempmail.xyz")).toBe(false);
    expect(isTrustedEmail("bad@fakeinbox99.net")).toBe(false);
    expect(isTrustedEmail("")).toBe(false);
    expect(isTrustedEmail("notanemail")).toBe(false);
  });
});

