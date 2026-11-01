import { Echo, Logo } from "@shared/ui";

import AddToChromeButton from "../components/landing/AddToChromeButton";
import AskBand from "../components/landing/AskBand";
import BeforeAfter from "../components/landing/BeforeAfter";
import ExtensionClip from "../components/landing/ExtensionClip";
import Faq from "../components/landing/Faq";
import Hero from "../components/landing/Hero";
import LandingNav from "../components/landing/LandingNav";
import { FOOTER_LINKS } from "../components/landing/links";
import PrivacySection from "../components/landing/PrivacySection";
import ScrollStory from "../components/landing/ScrollStory";

const SAVES_FROM = [
  "Web articles",
  "PDFs & papers",
  "YouTube transcripts",
  "Your own notes",
  "Uploaded files",
];

/** Landing page in the final order of DESIGN.md §9.7. */
export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-btn focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <LandingNav />

      <main id="main">
        <Hero />

        <section aria-label="Saves from" className="border-y border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 md:flex-row md:items-center md:gap-10">
            <p className="shrink-0 font-mono text-eyebrow uppercase text-muted">
              Saves from
            </p>
            <ul className="flex flex-wrap gap-x-8 gap-y-2 md:flex-1 md:justify-between">
              {SAVES_FROM.map((item) => (
                <li key={item} className="text-[17px] font-semibold text-fg">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <BeforeAfter />
        <ScrollStory />
        <ExtensionClip />
        <AskBand />
        <PrivacySection />
        <Faq />

        <section aria-labelledby="cta-heading" className="px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="mx-auto flex max-w-6xl flex-col items-center rounded-panel bg-inverse px-6 py-16 text-center sm:py-20">
            <Echo state="happy" size={88} tone="inverse" />
            <h2
              id="cta-heading"
              className="mt-6 font-display text-section text-on-inverse"
            >
              Give your reading a memory.
            </h2>
            <AddToChromeButton size="lg" className="mt-8" />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo size={18} />
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                {link.href ? (
                  <a
                    href={link.href}
                    className="inline-flex min-h-touch items-center text-muted hover:text-fg hover:underline"
                  >
                    {link.label}
                  </a>
                ) : (
                  <span className="inline-flex min-h-touch items-center text-muted">{link.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
