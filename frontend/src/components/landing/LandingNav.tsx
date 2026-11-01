import { Link } from "react-router-dom";

import { Logo, ThemeToggle, useThemePreference } from "@shared/ui";

import AddToChromeButton from "./AddToChromeButton";

const SECTIONS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#ask", label: "Ask" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
];

export default function LandingNav() {
  const { resolved } = useThemePreference();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" aria-label="Sentiora home" className="shrink-0 rounded-btn">
          <Logo size={21} />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="rounded-btn px-3 py-2 text-[15px] text-fg transition-colors hover:bg-raised"
            >
              {section.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle variant="icon" className="hidden sm:inline-flex" />
          <Link
            to="/login"
            className="inline-flex h-11 items-center rounded-btn px-3 text-[15px] text-fg transition-colors hover:bg-raised"
          >
            Log in
          </Link>
          {/* Graphite in light, coral in dark (DESIGN.md §5.1). */}
          <AddToChromeButton variant={resolved === "dark" ? "primary" : "inverse"} />
        </div>
      </div>
    </header>
  );
}
