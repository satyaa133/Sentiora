/**
 * Reduce a user-entered site ("https://www.Example.com/path") to the bare
 * domain the extension enforces ("example.com"), or null when it is not a
 * domain. Keep in step with normalizeBlockedDomain in
 * extension/src/shared/blocklist.ts, which re-normalizes every synced entry.
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
