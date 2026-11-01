import { useCallback, useEffect, useState } from "react";

import {
  THEME_STORAGE_KEY,
  readThemePreference,
  resolveTheme,
  setThemePreference,
} from "./theme.js";
import type { ResolvedTheme, ThemePreference } from "./theme.js";

/** Current theme preference plus the theme it resolves to, kept in sync with the OS and other tabs. */
export function useThemePreference(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(preference),
  );

  useEffect(() => {
    setResolved(resolveTheme(preference));
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia?.("(prefers-color-scheme: dark)");
    } catch {
      media = undefined;
    }
    const onSystemChange = () => setResolved(resolveTheme(preference));
    media?.addEventListener?.("change", onSystemChange);
    return () => media?.removeEventListener?.("change", onSystemChange);
  }, [preference]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY) {
        const next = readThemePreference();
        setThemePreference(next);
        setPreferenceState(next);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
