import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function matches(): boolean {
  try {
    return window.matchMedia?.(QUERY).matches ?? false;
  } catch {
    return false;
  }
}

/** True when the user asked the OS for reduced motion; updates live. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches);

  useEffect(() => {
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia?.(QUERY);
    } catch {
      media = undefined;
    }
    const onChange = () => setReduced(matches());
    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}
