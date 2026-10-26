import { useId, useState } from "react";

import { Button, Echo, IconChevronDown, Tag, cx } from "@shared/ui";

interface ProtectedViewProps {
  /** Hostname of the blocked page, if known. */
  host: string;
  /** True when the URL matches the extension's built-in blocklist. */
  builtInRule: boolean;
  onReviewBlockedSites: () => void;
}

export default function ProtectedView({
  host,
  builtInRule,
  onReviewBlockedSites,
}: ProtectedViewProps) {
  const [showWhy, setShowWhy] = useState(false);
  const whyId = useId();

  return (
    <section className="flex flex-col items-center px-5 pb-5 pt-7 text-center">
      <Echo state="guarding" size={84} />
      <h1 className="mt-4 font-display text-[22px] font-bold tracking-tight">
        Echo won&apos;t save this page
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {builtInRule
          ? "This site handles banking, health or tax details. Pages like this are always skipped."
          : "This page looks private, like a sign-in form or a page that asks not to be indexed. Echo skips pages like this."}
      </p>

      {host ? (
        <div className="mt-5 flex w-full items-center justify-between gap-3 rounded-btn bg-raised px-4 py-3">
          <span className="truncate font-mono text-sm text-fg">{host}</span>
          {builtInRule ? <Tag className="shrink-0">Built-in rule</Tag> : null}
        </div>
      ) : null}

      <Button
        variant="secondary"
        fullWidth
        onClick={onReviewBlockedSites}
        className="mt-3"
      >
        Review blocked sites
      </Button>

      <button
        type="button"
        aria-expanded={showWhy}
        aria-controls={whyId}
        onClick={() => setShowWhy((open) => !open)}
        className="mt-2 inline-flex min-h-touch items-center gap-1 text-[15px] font-medium text-link hover:underline"
      >
        Why was this blocked?
        <IconChevronDown
          size={16}
          className={cx("transition-transform", showWhy && "rotate-180")}
        />
      </button>
      <div
        id={whyId}
        hidden={!showWhy}
        className="text-left text-[15px] leading-relaxed text-muted"
      >
        Sentiora never saves banking, health, tax or browser pages, pages with a visible
        password field, or pages marked noindex. This check runs on your device before
        anything is sent.
      </div>
    </section>
  );
}
