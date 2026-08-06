import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../shared/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: {
          0: "#FFFDF7",
          50: "#FAF8F1",
          100: "#F3EFE6",
          200: "#E5DFD0",
        },
        ink: {
          900: "#1F2421",
          700: "#3F4A45",
          500: "#60706A",
        },
        moss: {
          600: "#2C6F54",
          700: "#235943",
          100: "#DBE9DF",
        },
        amberBadge: {
          600: "#A86A1A",
          100: "#F2E5D4",
        },
        youtubeBadge: {
          600: "#8A443C",
          100: "#F4E2E0",
        },
      },
      fontFamily: {
        serif: ["Charter", "Source Serif 4", "Georgia", "serif"],
        sans: ["Public Sans", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["IBM Plex Mono", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 2px 12px rgba(31, 36, 33, 0.04)",
        modal: "0 16px 40px rgba(31, 36, 33, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
