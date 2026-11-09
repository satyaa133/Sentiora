/**
 * Popular trusted consumer email providers and educational institutions.
 */
export const TRUSTED_EMAIL_DOMAINS = new Set([
  // Google
  "gmail.com",
  "googlemail.com",
  // Microsoft
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  // Yahoo
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // Privacy-focused & other reputable providers
  "proton.me",
  "protonmail.com",
  "fastmail.com",
  "zoho.com",
  "zohomail.com",
  "aol.com",
  "gmx.com",
  "mail.com",
  // Local development / testing domains
  "example.com",
  "example.dev",
]);

/**
 * Validates whether an email is from a popular trusted provider or educational institution.
 */
export function isTrustedEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];
  if (!domain) return false;

  if (TRUSTED_EMAIL_DOMAINS.has(domain)) {
    return true;
  }

  // Allow educational and recognized institutional domains
  if (
    domain.endsWith(".edu") ||
    domain.endsWith(".ac.uk") ||
    domain.endsWith(".edu.in") ||
    domain.endsWith(".edu.au")
  ) {
    return true;
  }

  return false;
}

