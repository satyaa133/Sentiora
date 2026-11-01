import { Echo, IconArrowRight, Logo, buttonClasses } from "@shared/ui";

import AddToChromeButton from "../components/landing/AddToChromeButton";
import AskBand from "../components/landing/AskBand";
import Faq from "../components/landing/Faq";
import HeroMockup from "../components/landing/HeroMockup";
import HowItWorks from "../components/landing/HowItWorks";
import LandingNav from "../components/landing/LandingNav";
import { FOOTER_LINKS } from "../components/landing/links";
import PrivacySection from "../components/landing/PrivacySection";

const SAVES_FROM = [
  "Web articles",
  "PDFs & papers",
  "YouTube transcripts",
  "Your own notes",
  "Uploaded files",
];

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
        <section
          aria-labelledby="hero-heading"
          className="pb-16 pt-12 sm:pt-20 lg:pb-24"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full bg-accent"
                />
                A private memory for everything you read
              </p>
              <h1 id="hero-heading" className="mt-6 font-display text-hero text-fg">
                Remember everything you read.
              </h1>
              <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-muted">
                Sentiora saves the articles, PDFs and videos you read, then answers your
                questions from them, with the sources linked.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <AddToChromeButton size="lg" className="w-full sm:w-auto">
                  Add to Chrome
                  <IconArrowRight size={18} />
                </AddToChromeButton>
                <a
                  href="#how-it-works"
                  className={buttonClasses("secondary", "lg") + " w-full sm:w-auto"}
                >
                  See how it works
                </a>
              </div>
              <p className="mt-5 text-[15px] text-muted">
                Saves pages as you read. Skips banking and health pages on its own.
              </p>
            </div>
            <HeroMockup />
          </div>
        </section>

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

        <HowItWorks />
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
                    className="text-muted hover:text-fg hover:underline"
                  >
                    {link.label}
                  </a>
                ) : (
                  <span className="text-muted">{link.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
