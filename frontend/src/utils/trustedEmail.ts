import { isTrustedEmail as isTrustedEmailFor } from "@shared/ui";

export { TEST_EMAIL_DOMAINS, TRUSTED_EMAIL_DOMAINS } from "@shared/ui";

/** Reserved example.* domains count only in test builds (VITE_ALLOW_TEST_EMAIL_DOMAINS=true). */
export function isTrustedEmail(email: string): boolean {
  return isTrustedEmailFor(email, {
    allowTestDomains: import.meta.env.VITE_ALLOW_TEST_EMAIL_DOMAINS === "true",
  });
}
