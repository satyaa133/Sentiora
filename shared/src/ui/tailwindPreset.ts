import type { Config } from "tailwindcss";

/**
 * Tailwind preset mapping utilities onto the CSS variables in tokens.css.
 * Used by frontend/ and extension/ so both apps share one design language.
 *
 *   bg-bg, bg-surface, bg-raised      page / card / highlight backgrounds
 *   text-fg, text-muted               body and secondary text
 *   border-line, border-line-soft     borders and list separators
 *   bg-accent, text-on-accent         coral fills and the text on them
 *   text-link                         coral-coloured text (contrast-safe)
 *   bg-accent-soft, text-accent-soft-fg  tags, selected nav item
 *   bg-inverse, text-on-inverse       graphite panels and user bubbles
 */
const sentioraPreset = {
  content: [],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        raised: "var(--surface-raised)",
        fg: "var(--text)",
        muted: "var(--text-muted)",
        line: {
          DEFAULT: "var(--border)",
          soft: "var(--border-soft)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
          "soft-fg": "var(--accent-soft-text)",
        },
        "on-accent": "var(--on-accent)",
        link: "var(--link)",
        inverse: "var(--inverse)",
        "on-inverse": {
          DEFAULT: "var(--on-inverse)",
          muted: "var(--on-inverse-muted)",
        },
        badge: {
          "web-bg": "var(--badge-web-bg)",
          "web-fg": "var(--badge-web-text)",
          "pdf-bg": "var(--badge-pdf-bg)",
          "pdf-fg": "var(--badge-pdf-text)",
          "video-bg": "var(--badge-video-bg)",
          "video-fg": "var(--badge-video-text)",
          "note-bg": "var(--badge-note-bg)",
          "note-fg": "var(--badge-note-text)",
        },
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      ringColor: {
        DEFAULT: "var(--accent)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "sans-serif",
        ],
        display: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Inter",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        hero: [
          "clamp(48px, 6vw, 84px)",
          { lineHeight: "0.98", letterSpacing: "-0.035em", fontWeight: "750" },
        ],
        section: [
          "clamp(36px, 4vw, 56px)",
          { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "700" },
        ],
        "page-title": [
          "36px",
          { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" },
        ],
        eyebrow: ["12px", { lineHeight: "1.4", letterSpacing: "0.06em" }],
      },
      borderRadius: {
        btn: "12px",
        card: "20px",
        panel: "24px",
      },
      boxShadow: {
        float: "var(--shadow-float)",
        pop: "var(--shadow-pop)",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.2, 0, 0, 1)",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
      minHeight: {
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },
    },
  },
} satisfies Config;

export default sentioraPreset;
