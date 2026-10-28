import { isTrustedAppUrl } from "./appUrl";

/**
 * Built-in blocklist for sensitive sites: banking, payments, investing,
 * insurance, health, government ID and tax, and password managers. A domain
 * also blocks its subdomains. Where a service hosts public docs or articles on
 * its main domain, only the signed-in subdomain is listed.
 *
 * file:// is allowed only for PDF capture; local HTML is still blocked.
 */
const BANKING_DOMAINS = [
  // Global
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "citibank.com",
  "capitalone.com",
  "americanexpress.com",
  "usbank.com",
  "pnc.com",
  "td.com",
  "tdbank.com",
  "rbcroyalbank.com",
  "scotiabank.com",
  "ally.com",
  "discover.com",
  "sofi.com",
  "chime.com",
  "hsbc.com",
  "hsbc.co.uk",
  "hsbc.co.in",
  "barclays.com",
  "barclays.co.uk",
  "santander.co.uk",
  "lloydsbank.com",
  "natwest.com",
  "halifax.co.uk",
  "monzo.com",
  "revolut.com",
  "n26.com",
  "sc.com",
  "dbs.com",
  "ocbc.com",
  "uob.com.sg",
  "commbank.com.au",
  "westpac.com.au",
  "anz.com",
  "nab.com.au",
  // India
  "onlinesbi.sbi",
  "sbi.co.in",
  "hdfcbank.com",
  "icicibank.com",
  "axisbank.com",
  "kotak.com",
  "pnbindia.in",
  "netpnb.com",
  "bankofbaroda.in",
  "bobibanking.com",
  "canarabank.com",
  "unionbankofindia.co.in",
  "bankofindia.co.in",
  "indianbank.in",
  "idbibank.in",
  "indusind.com",
  "yesbank.in",
  "idfcfirstbank.com",
  "federalbank.co.in",
  "rblbank.com",
  "aubank.in",
  "bandhanbank.com",
  "iob.in",
  "centralbankofindia.co.in",
  "ucobank.com",
];

const PAYMENT_DOMAINS = [
  "paypal.com",
  "stripe.com",
  "venmo.com",
  "cash.app",
  "zelle.com",
  "wise.com",
  "klarna.com",
  "afterpay.com",
  // India: UPI apps and wallets
  "paytm.com",
  "phonepe.com",
  "pay.google.com",
  "bhimupi.org.in",
  "mobikwik.com",
  "cred.club",
  "amazonpay.in",
  "freecharge.in",
  "dashboard.razorpay.com",
];

const INVESTING_DOMAINS = [
  "fidelity.com",
  "vanguard.com",
  "schwab.com",
  "robinhood.com",
  "etrade.com",
  "interactivebrokers.com",
  "coinbase.com",
  "binance.com",
  "kraken.com",
  "crypto.com",
  // India
  "kite.zerodha.com",
  "console.zerodha.com",
  "coin.zerodha.com",
  "groww.in",
  "upstox.com",
  "angelone.in",
  "wazirx.com",
  "coindcx.com",
  "cdslindia.com",
  "camsonline.com",
  "mfcentral.com",
];

const INSURANCE_DOMAINS = [
  "geico.com",
  "progressive.com",
  "statefarm.com",
  "allstate.com",
  "aetna.com",
  "cigna.com",
  "uhc.com",
  "myuhc.com",
  "anthem.com",
  "humana.com",
  // India
  "licindia.in",
  "policybazaar.com",
  "starhealth.in",
  "hdfcergo.com",
  "icicilombard.com",
  "careinsurance.com",
  "nivabupa.com",
  "acko.com",
  "godigit.com",
  "sbilife.co.in",
  "iciciprulife.com",
  "maxlifeinsurance.com",
];

const HEALTH_DOMAINS = [
  // Patient portals, telehealth, labs, pharmacies
  "mychart.org",
  "epic.com",
  "kp.org",
  "kaiserpermanente.org",
  "followmyhealth.com",
  "myhealth.va.gov",
  "healthcare.gov",
  "zocdoc.com",
  "onemedical.com",
  "teladoc.com",
  "labcorp.com",
  "questdiagnostics.com",
  "23andme.com",
  "nhsapp.service.nhs.uk",
  // India: hospitals, health records, pharmacies
  "abdm.gov.in",
  "cowin.gov.in",
  "practo.com",
  "apollo247.com",
  "apollohospitals.com",
  "maxhealthcare.in",
  "fortishealthcare.com",
  "manipalhospitals.com",
  "narayanahealth.org",
  "medanta.org",
  "ors.gov.in",
  "eka.care",
  "1mg.com",
  "pharmeasy.in",
  "netmeds.com",
];

const GOVERNMENT_ID_DOMAINS = [
  // Tax and identity
  "irs.gov",
  "ssa.gov",
  "login.gov",
  "id.me",
  "studentaid.gov",
  "turbotax.com",
  "intuit.com",
  "tax.service.gov.uk",
  "account.gov.uk",
  "access.service.gov.uk",
  "my.gov.au",
  // India
  "digilocker.gov.in",
  "uidai.gov.in",
  "incometax.gov.in",
  "incometaxindia.gov.in",
  "gst.gov.in",
  "epfindia.gov.in",
  "passportindia.gov.in",
  "umang.gov.in",
  "parivahan.gov.in",
  "nsdl.co.in",
  "protean-tinpan.com",
  "utiitsl.com",
];

const PASSWORD_MANAGER_DOMAINS = [
  "my.1password.com",
  "vault.bitwarden.com",
  "lastpass.com",
];

export const DEFAULT_BLOCKED_DOMAINS = [
  ...BANKING_DOMAINS,
  ...PAYMENT_DOMAINS,
  ...INVESTING_DOMAINS,
  ...INSURANCE_DOMAINS,
  ...HEALTH_DOMAINS,
  ...GOVERNMENT_ID_DOMAINS,
  ...PASSWORD_MANAGER_DOMAINS,
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

/** Identity providers whose pages are all sign-in or account pages. */
const SIGN_IN_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "signin.aws.amazon.com",
  "login.yahoo.com",
  "id.atlassian.com",
];

/** Hostnames that start with these are sign-in services (login.example.com). */
const SIGN_IN_HOST_PREFIXES = ["login.", "signin.", "sso.", "auth.", "accounts."];

/** A path segment equal to one of these marks a sign-in or account-recovery page. */
const SIGN_IN_PATH_SEGMENTS = new Set([
  "login",
  "log-in",
  "log_in",
  "signin",
  "sign-in",
  "sign_in",
  "logon",
  "signon",
  "forgot-password",
  "reset-password",
  "password-reset",
  "2fa",
  "mfa",
]);

/**
 * Only checked as the first path segment: as a later segment they are common in
 * developer docs (/docs/sso), which should stay capturable.
 */
const SIGN_IN_ROOT_SEGMENTS = new Set(["oauth", "oauth2", "sso", "saml", "idp"]);

const PAGE_EXTENSION = /\.(php|html?|aspx?|jsp|do|cgi)$/;

const MANUAL_VAULT_PATHS = ["/manual/", "/notes", "/notes/", "/welcome"];

/** Upper bound on synced user rules, so a corrupt list cannot bloat storage. */
const MAX_USER_BLOCKED_DOMAINS = 500;

export type UrlBlockReason = "built_in" | "user";

export interface UrlBlockOptions {
  allowLocalPdf?: boolean;
  /** Domains the user blocked in the Privacy Center. */
  userDomains?: readonly string[];
}

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

    if (isTrustedAppUrl(urlStr) || host.includes("sentiora")) {
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

function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith("." + domain);
}

/** True for identity-provider hosts and URLs whose path is a sign-in page. */
export function isSignInUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (SIGN_IN_HOSTS.some((host) => hostMatchesDomain(hostname, host))) {
    return true;
  }
  if (SIGN_IN_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
    return true;
  }

  const segments = parsed.pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(PAGE_EXTENSION, ""));
  const first = segments[0];
  if (first !== undefined && SIGN_IN_ROOT_SEGMENTS.has(first)) {
    return true;
  }
  return segments.some((segment) => SIGN_IN_PATH_SEGMENTS.has(segment));
}

/**
 * Reduce a user-entered site ("https://www.Example.com/path") to a bare domain
 * ("example.com"). Returns null for anything that is not a plausible domain.
 */
export function normalizeBlockedDomain(input: string): string | null {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** Normalize, dedupe and cap a list of user-blocked domains from untyped input. */
export function sanitizeUserBlockedDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const domains = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const domain = normalizeBlockedDomain(value);
    if (domain) domains.add(domain);
    if (domains.size >= MAX_USER_BLOCKED_DOMAINS) break;
  }
  return [...domains];
}

/** Browser pages, local non-PDF files and Sentiora's own pages: never content. */
export function isInternalUrl(urlStr: string): boolean {
  const lowerUrl = urlStr.toLowerCase();
  if (lowerUrl.startsWith("file://")) return !isPdfUrl(urlStr);
  return (
    BLOCKED_URL_PREFIXES.some((prefix) => lowerUrl.startsWith(prefix)) ||
    isSentioraAppUrl(urlStr)
  );
}

/** Why a URL must not be captured, or null when it may be. */
export function getUrlBlockReason(
  urlStr: string,
  options?: UrlBlockOptions,
): UrlBlockReason | null {
  if (!urlStr) return "built_in";

  const lowerUrl = urlStr.toLowerCase();

  if (isSentioraAppUrl(urlStr)) {
    return "built_in";
  }

  if (lowerUrl.startsWith("file://")) {
    return options?.allowLocalPdf && isPdfUrl(urlStr) ? null : "built_in";
  }

  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lowerUrl.startsWith(prefix)) {
      return "built_in";
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return "built_in";
  }
  const hostname = parsed.hostname.toLowerCase();

  if (DEFAULT_BLOCKED_DOMAINS.some((domain) => hostMatchesDomain(hostname, domain))) {
    return "built_in";
  }
  if (isSignInUrl(parsed)) {
    return "built_in";
  }
  if (options?.userDomains?.some((domain) => hostMatchesDomain(hostname, domain))) {
    return "user";
  }

  return null;
}

export function isUrlBlocked(urlStr: string, options?: UrlBlockOptions): boolean {
  return getUrlBlockReason(urlStr, options) !== null;
}
