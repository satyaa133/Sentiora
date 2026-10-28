import type { ReactNode } from "react";

import { IconCheck, IconClose, IconGlobe, IconLock, IconShield } from "@shared/ui";

function Node({
  number,
  icon,
  title,
  body,
}: {
  number: string;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full items-start gap-3 rounded-card border border-line bg-surface p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent-soft-fg">
        {icon}
      </span>
      <div>
        <p className="font-mono text-xs text-muted">{number}</p>
        <p className="text-[17px] font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-[15px] leading-snug text-muted">{body}</p>
      </div>
    </div>
  );
}

const Arrow = () => (
  <span
    aria-hidden="true"
    className="mx-auto h-6 w-px bg-line lg:mx-0 lg:my-auto lg:h-px lg:w-8 lg:shrink-0"
  />
);

const STEPS: ReactNode[] = [
  <Node
    key="open"
    number="1"
    icon={<IconGlobe size={20} />}
    title="You open a page"
    body="while signed in to the extension"
  />,
  <Node
    key="check"
    number="2"
    icon={<IconShield size={20} />}
    title="Privacy check, in your browser"
    body="banking, health and sign-in pages, plus your blocklist"
  />,
  <div key="outcome" className="flex h-full flex-col gap-2">
    <div className="flex flex-1 items-start gap-3 rounded-card border-2 border-dashed border-line p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
        <IconClose size={16} />
      </span>
      <div>
        <p className="text-[16px] font-semibold text-fg">Skipped</p>
        <p className="text-[15px] leading-snug text-muted">nothing is sent anywhere</p>
      </div>
    </div>
    <div className="flex flex-1 items-start gap-3 rounded-card border border-accent bg-surface p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
        <IconCheck size={16} />
      </span>
      <div>
        <p className="text-[16px] font-semibold text-fg">Saved</p>
        <p className="text-[15px] leading-snug text-muted">clean text, title, link and basic page details</p>
      </div>
    </div>
  </div>,
  <Node
    key="vault"
    number="3"
    icon={<IconLock size={20} />}
    title="Your private vault"
    body="only you can search it · export as JSON · delete anytime"
  />,
];

/**
 * "What happens to a page you visit" (DESIGN.md §9.5). The copy matches the
 * extension: the privacy check runs in the content script before any message
 * or network request, and signed-out sessions send nothing (see Phase 8 tests).
 */
export default function PrivacyFlow() {
  return (
    <figure className="mt-16" aria-labelledby="privacy-flow-title">
      <figcaption id="privacy-flow-title" className="font-display text-[24px] font-bold tracking-tight text-fg">
        What happens to a page you visit
      </figcaption>
      <ol className="mt-6 flex flex-col lg:flex-row lg:items-stretch">
        {STEPS.map((step, i) => (
          <li key={i} className="flex flex-1 flex-col lg:flex-row">
            {i > 0 ? <Arrow /> : null}
            <div className="flex-1">{step}</div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
