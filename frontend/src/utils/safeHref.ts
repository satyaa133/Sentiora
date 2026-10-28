// Placeholder URLs Sentiora gives notes, text uploads and the welcome memory
// (the backend's _MANUAL_VAULT_PATHS); they are not real pages to open.
const SYNTHETIC_PATH_RE = /^\/(notes|manual|welcome)(\/|$)/;

/** Link to a memory's original page, or undefined when there is none to open. */
export function sourceHref(url: string | null | undefined): string | undefined {
  const href = safeHref(url);
  if (!href) return undefined;
  const { hostname, pathname } = new URL(href);
  const isSentiora = hostname === "sentiora.app" || hostname.endsWith(".sentiora.app");
  return isSentiora && SYNTHETIC_PATH_RE.test(pathname) ? undefined : href;
}

/** Only http(s) links are rendered; anything else (javascript:, data:, file:) gets no href. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
