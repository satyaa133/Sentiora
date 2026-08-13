/**
 * Default domain and pattern blocklist for excluding sensitive sites
 * (banking, medical, adult, private portals, internal browser URLs).
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
];

/** Sentiora app URLs should never be captured as memories. */
export function isSentioraAppUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port;

    if (host.includes("sentiora")) {
      return true;
    }

    if (
      (host === "localhost" || host === "127.0.0.1") &&
      (port === "5173" || port === "8000" || port === "5050")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function isUrlBlocked(urlStr: string): boolean {
  if (!urlStr) return true;

  const lowerUrl = urlStr.toLowerCase();

  if (isSentioraAppUrl(urlStr)) {
    return true;
  }

  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lowerUrl.startsWith(prefix)) {
      return true;
    }
  }

  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    for (const domain of DEFAULT_BLOCKED_DOMAINS) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return true;
      }
    }
  } catch {
    return true;
  }

  return false;
}
