/**
 * Default domain and pattern blocklist for excluding sensitive sites
 * (banking, medical, tax, private portals, internal browser URLs).
 *
 * Keep this list small and explicit so it stays easy to extend for MVP.
 * file:// is allowed only for PDF capture — local HTML is still blocked.
 */
export const DEFAULT_BLOCKED_DOMAINS = [
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "americanexpress.com",
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
  "intuit.com",
  "irs.gov",
];

export const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "moz-extension://",
  "edge://",
  "about:",
  "view-source:",
  "devtools://",
];

const MANUAL_VAULT_PATHS = ["/manual/", "/notes", "/notes/", "/welcome"];

export function isPdfUrl(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  return lower.endsWith(".pdf") || lower.includes(".pdf?");
}

/** Sentiora app URLs should never be captured as page memories. */
export function isSentioraAppUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port;
    const path = parsed.pathname.toLowerCase();

    const isSyntheticManualNote = MANUAL_VAULT_PATHS.some(
      (prefix) => path === prefix || path.startsWith(prefix),
    );
    if (isSyntheticManualNote) {
      return false;
    }

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

export function isUrlBlocked(urlStr: string, options?: { allowLocalPdf?: boolean }): boolean {
  if (!urlStr) return true;

  const lowerUrl = urlStr.toLowerCase();

  if (isSentioraAppUrl(urlStr)) {
    return true;
  }

  if (lowerUrl.startsWith("file://")) {
    return !(options?.allowLocalPdf && isPdfUrl(urlStr));
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
