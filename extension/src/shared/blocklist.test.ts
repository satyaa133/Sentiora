import { describe, expect, it } from "vitest";
import {
  getUrlBlockReason,
  isInternalUrl,
  isPdfUrl,
  isSentioraAppUrl,
  isUrlBlocked,
  normalizeBlockedDomain,
  sanitizeUserBlockedDomains,
} from "./blocklist";

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

  it.each([
    "https://retail.onlinesbi.sbi/retail/home",
    "https://netbanking.hdfcbank.com/",
    "https://www.phonepe.com/business",
    "https://pay.google.com/gp/w/home",
    "https://kite.zerodha.com/dashboard",
    "https://www.practo.com/consult",
    "https://www.licindia.in/policy",
    "https://www.digilocker.gov.in/",
    "https://myaadhaar.uidai.gov.in/",
    "https://eportal.incometax.gov.in/iec/foservices/",
    "https://www.hsbc.co.uk/",
  ])("blocks Indian and global financial, health and ID site %s", (url) => {
    expect(getUrlBlockReason(url)).toBe("built_in");
  });

  it("keeps public docs on finance domains capturable", () => {
    expect(isUrlBlocked("https://razorpay.com/docs/payments/")).toBe(false);
    expect(isUrlBlocked("https://zerodha.com/varsity/module/introduction-to-stock-markets/")).toBe(false);
  });

  it.each([
    "https://accounts.google.com/v3/signin/identifier",
    "https://login.microsoftonline.com/common/oauth2/authorize",
    "https://github.com/login",
    "https://example.com/users/sign_in",
    "https://shop.example.com/account/login.php",
    "https://example.com/forgot-password",
    "https://example.com/oauth/authorize",
    "https://login.example.org/",
  ])("treats %s as a sign-in page", (url) => {
    expect(getUrlBlockReason(url)).toBe("built_in");
  });

  it("does not treat docs about sign-in as sign-in pages", () => {
    expect(isUrlBlocked("https://docs.example.com/guides/sso")).toBe(false);
    expect(isUrlBlocked("https://blog.example.com/how-login-forms-work")).toBe(false);
  });

  it("reports user rules separately from built-in rules", () => {
    const userDomains = ["news.example.com"];
    expect(getUrlBlockReason("https://news.example.com/a", { userDomains })).toBe("user");
    expect(getUrlBlockReason("https://eu.news.example.com/a", { userDomains })).toBe("user");
    expect(getUrlBlockReason("https://example.com/a", { userDomains })).toBeNull();
    expect(getUrlBlockReason("https://www.chase.com/", { userDomains: ["chase.com"] })).toBe("built_in");
  });

  it("normalizes user-entered sites and drops junk", () => {
    expect(normalizeBlockedDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeBlockedDomain("example.com:8080")).toBe("example.com");
    expect(normalizeBlockedDomain("not a domain")).toBeNull();
    expect(sanitizeUserBlockedDomains(["a.com", "A.com", 42, "bad", "http://b.org/x"])).toEqual(["a.com", "b.org"]);
    expect(sanitizeUserBlockedDomains("a.com")).toEqual([]);
  });

  it("recognises browser, local and Sentiora pages as internal", () => {
    expect(isInternalUrl("chrome://newtab")).toBe(true);
    expect(isInternalUrl("file:///C:/notes.html")).toBe(true);
    expect(isInternalUrl("file:///C:/paper.pdf")).toBe(false);
    expect(isInternalUrl("https://www.chase.com/")).toBe(false);
  });
});
