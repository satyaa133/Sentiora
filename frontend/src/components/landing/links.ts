/**
 * Outbound links for the landing page. Unknown destinations are left as TODO and
 * fall back to safe in-app targets until real URLs exist.
 */

// TODO: Chrome Web Store listing URL. Until it exists, "Add to Chrome" opens sign-up
// (the previous "Get started" destination).
export const CHROME_STORE_URL: string | null = null;
export const ADD_TO_CHROME_FALLBACK_PATH = "/onboarding";

// TODO: real destinations for the footer. Null entries render as plain text.
export const FOOTER_LINKS: Array<{ label: string; href: string | null }> = [
  { label: "Privacy", href: "#privacy" },
  { label: "Terms", href: null },
  { label: "GitHub", href: null },
  { label: "Contact", href: null },
];

// TODO: a real 10-15s screen recording of the extension (DESIGN.md §9.4). While null,
// the landing page shows the animated stand-in.
export const EXTENSION_CLIP_VIDEO: { src: string; poster: string } | null = null;
