import { useEffect, useState, type RefObject } from "react";

/**
 * True while the element is on screen and the tab is visible, so landing
 * animations can pause off screen (DESIGN.md §11). Assumes visible when
 * IntersectionObserver is unavailable.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = "0px"): boolean {
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? true),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  useEffect(() => {
    const onChange = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return onScreen && tabVisible;
}
