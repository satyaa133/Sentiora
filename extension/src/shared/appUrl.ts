/**
 * The Sentiora web app this build talks to (VITE_APP_URL in the repo-root .env).
 * Only this exact origin may hand the extension auth tokens or log it out.
 */
export const APP_URL = (import.meta.env.VITE_APP_URL ?? "http://localhost:5173").replace(/\/$/, "");

const APP_ORIGIN = safeOrigin(APP_URL);

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isTrustedAppUrl(url: string | undefined): boolean {
  const origin = safeOrigin(url);
  return origin !== null && origin === APP_ORIGIN;
}

export function appPageUrl(path: string): string {
  return `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
