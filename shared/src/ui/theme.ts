/**
 * Light/dark theme preference, shared by the web app and the extension popup.
 *
 * "system" follows prefers-color-scheme; "light" and "dark" set data-theme on <html>
 * so tokens.css can override the OS. Storage access is wrapped because it can throw
 * (private windows, blocked site data).
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sentiora-theme";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function systemTheme(): ResolvedTheme {
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement | undefined = globalThis.document?.documentElement,
): void {
  if (!root) return;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage unavailable: the choice still applies for this page view.
  }
  applyThemePreference(preference);
}

/** Apply the stored preference. Call once before the first render. */
export function initTheme(): ThemePreference {
  const preference = readThemePreference();
  applyThemePreference(preference);
  return preference;
}
