/**
 * Default domain and pattern blocklist for excluding sensitive sites
 * (banking, medical, adult, private portals, internal local URLs).
 */
export const DEFAULT_BLOCKED_DOMAINS = [
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "paypal.com",
  "stripe.com",
  "fidelity.com",
  "vanguard.com",
  "schwab.com",
  "robinhood.com",
  "coinbase.com",
  "mychart.org",
  "epic.com",
  "kp.org",
  "turbotax.com",
];

export const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "file://",
  "http://localhost",
  "http://127.0.0.1",
  "https://localhost",
];

export function isUrlBlocked(urlStr: string): boolean {
  if (!urlStr) return true;

  const lowerUrl = urlStr.toLowerCase();

  // 1. Check protocol / prefix blocklist
  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lowerUrl.startsWith(prefix)) {
      return true;
    }
  }

  // 2. Check hostname blocklist
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    for (const domain of DEFAULT_BLOCKED_DOMAINS) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return true;
      }
    }
  } catch {
    return true; // Invalid URL
  }

  return false;
}
