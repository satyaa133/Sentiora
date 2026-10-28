import type { ReactNode } from "react";

import { Echo, IconDownload, IconEye, IconShield } from "@shared/ui";

import PrivacyFlow from "./PrivacyFlow";

const POINTS: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <IconEye size={20} />,
    title: "You stay in control",
    body: "Saving runs only while you're signed in. Block any site, and delete anything you've saved.",
  },
  {
    icon: <IconShield size={20} />,
    title: "Sensitive pages are skipped",
    body: "Banking, health and sign-in pages it recognises are skipped, plus any site you block. The check runs in your browser before anything is sent.",
  },
  {
    icon: <IconDownload size={20} />,
    title: "Export or delete anytime",
    body: "Download your whole memory as JSON, or delete any memory you no longer want.",
  },
];

export default function PrivacySection() {
  return (
    <section
      id="privacy"
      aria-labelledby="privacy-heading"
      className="scroll-mt-16 py-20 sm:py-28"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <div className="flex aspect-[4/3] items-center justify-center rounded-panel border border-line bg-surface">
          <Echo state="guarding" size={160} still />
        </div>
        <div>
          <h2 id="privacy-heading" className="font-display text-section text-fg">
            Your memory stays yours.
          </h2>
          <ul className="mt-8 space-y-6">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent-soft-fg">
                  {point.icon}
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold text-fg">{point.title}</h3>
                  <p className="mt-1 text-[16px] leading-relaxed text-muted">
                    {point.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <PrivacyFlow />
      </div>
    </section>
  );
}
