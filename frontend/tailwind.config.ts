import type { Config } from "tailwindcss";

import sentioraPreset from "../shared/src/ui/tailwindPreset";

// All design tokens come from the shared preset (shared/src/ui/tailwindPreset.ts).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../shared/src/**/*.{ts,tsx}"],
  presets: [sentioraPreset],
  plugins: [],
} satisfies Config;
