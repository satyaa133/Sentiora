import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Logo, ThemeToggle, useThemePreference } from "@shared/ui";

import { onEcho } from "../echo/echoEvents";
import AddToChromeButton from "./AddToChromeButton";

const SECTIONS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#extension", label: "Extension" },
  { href: "#ask", label: "Ask" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
];

/** True once the element with `id` has scrolled out of view above the viewport. */
function useScrolledPast(id: string): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);
  return past;
}

/** How many memory scraps the roaming Echo has eaten on this visit (§9.6). */
function EchoSavedChip() {
  const [saved, setSaved] = useState(0);
  useEffect(
    () =>
      onEcho((event) => {
        if (event.type === "landing-saved") setSaved(event.total);
      }),
    [],
  );
  if (saved === 0) return null;
  return (
    <span className="hidden h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 font-mono text-xs text-muted lg:inline-flex">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
      Echo saved {saved}
    </span>
  );
}

export default function LandingNav({ heroId = "hero" }: { heroId?: string }) {
  const { resolved } = useThemePreference();
  const pastHero = useScrolledPast(heroId);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
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
          <EchoSavedChip />
          <ThemeToggle variant="icon" className="hidden sm:inline-flex" />
          <Link
            to="/login"
            className="inline-flex h-11 items-center rounded-btn px-3 text-[15px] text-fg transition-colors hover:bg-raised"
          >
            Log in
          </Link>
          {/* Graphite until the hero scrolls away, then coral; coral throughout in dark (§5.1, §9.6). */}
          <AddToChromeButton
            variant={pastHero || resolved === "dark" ? "primary" : "inverse"}
            className="transition-colors duration-200"
          />
        </div>
      </div>
    </header>
  );
}
