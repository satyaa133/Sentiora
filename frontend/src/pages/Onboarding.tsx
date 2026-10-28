import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  Echo,
  Eyebrow,
  IconArrowRight,
  IconCheck,
  IconDownload,
  IconGlobe,
  IconMessage,
  IconSearch,
  IconShield,
  Logo,
  SourceBadge,
  Tag,
  cx,
} from "@shared/ui";

import { SOURCE_BADGE, SOURCE_ICONS } from "../components/sourceIcons";
import { useAuth } from "../context/AuthContext";
import { createMemoryItem } from "../services/memoryService";
import {
  SOURCE_CATALOG,
  isSourceAvailable,
  type SourceId,
} from "../types/sourcePreferences";

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Meet Sentiora",
  2: "How saving works",
  3: "Choose what to remember",
  4: "Finish setup",
};

function PointList({
  points,
}: {
  points: Array<{ icon: ReactNode; title: string; body: string }>;
}) {
  return (
    <ul className="space-y-5">
      {points.map((point) => (
        <li key={point.title} className="flex gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent-soft-fg">
            {point.icon}
          </span>
          <div>
            <p className="text-[17px] font-semibold text-fg">{point.title}</p>
            <p className="mt-0.5 text-[16px] leading-relaxed text-muted">
              {point.body}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Onboarding() {
  const [step, setStep] = useState<Step>(1);
  const [selectedSources, setSelectedSources] = useState<SourceId[]>([
    "webpages",
    "youtube",
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { isAuthenticated, completeOnboarding } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      setStep((current) => (current < 3 ? 3 : current));
    }
  }, [isAuthenticated]);

  function toggleSource(sourceId: SourceId) {
    if (!isSourceAvailable(sourceId)) return;
    setSelectedSources((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : [...prev, sourceId],
    );
  }

  async function handleComplete() {
    if (!isAuthenticated) {
      navigate("/signup");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await completeOnboarding(selectedSources.filter(isSourceAvailable));

      try {
        await createMemoryItem({
          source_type: "webpage",
          title: "Getting Started with Your Sentiora Memory Vault",
          url: "https://sentiora.app/welcome",
          content:
            "Welcome to Sentiora. While you're signed in to the extension, the pages you read are saved here as clean text with their title and link. Banking, health and sign-in pages are skipped, and you can block any site in Privacy. Search for a page by what it said, or ask a question and get an answer with its sources. You can export or delete your memories anytime.",
        });
      } catch {
        // Ignore if welcome memory already exists
      }

      navigate("/dashboard");
    } catch {
      setError("Unable to save your source preferences. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function continueFromSources() {
    if (!isAuthenticated) {
      navigate("/signup");
      return;
    }
    setStep(4);
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-bg text-fg lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <aside className="bg-inverse text-on-inverse">
        <div className="flex flex-col px-6 py-5 lg:sticky lg:top-0 lg:h-screen lg:px-10 lg:py-10">
          <div className="flex items-center justify-between">
            <Logo tone="inverse" size={22} />
            <p className="text-[15px] text-on-inverse-muted lg:hidden">
              Step {step} of 4
            </p>
          </div>
          <div className="hidden flex-1 items-center justify-center lg:flex">
            <Echo state="happy" size={180} tone="inverse" />
          </div>
          <ol aria-label="Setup progress" className="hidden space-y-4 lg:block">
            {([1, 2, 3, 4] as Step[]).map((s) => {
              const done = s < step;
              const current = s === step;
              return (
                <li
                  key={s}
                  aria-current={current ? "step" : undefined}
                  className="flex items-center gap-3"
                >
                  <span
                    className={cx(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm",
                      current
                        ? "bg-accent font-semibold text-on-accent"
                        : "border border-on-inverse-muted text-on-inverse-muted",
                    )}
                  >
                    {done ? <IconCheck size={16} title="Done" /> : s}
                  </span>
                  <span
                    className={cx(
                      "text-[17px]",
                      current
                        ? "font-semibold text-on-inverse"
                        : "text-on-inverse-muted",
                    )}
                  >
                    {STEP_LABELS[s]}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>

      <main className="flex items-center px-4 py-10 sm:px-8 lg:px-16">
        <div className="mx-auto w-full max-w-2xl">
          <Eyebrow>
            Step {step} of 4 · {STEP_LABELS[step]}
          </Eyebrow>

          {step === 1 && (
            <>
              <h1 className="mt-3 font-display text-[34px] font-bold leading-tight tracking-tight sm:text-[44px]">
                A memory for everything you read.
              </h1>
              <p className="mt-3 text-[18px] text-muted">
                Sentiora keeps what you read and helps you find it again.
              </p>
              <div className="mt-8">
                <PointList
                  points={[
                    {
                      icon: <IconGlobe size={20} />,
                      title: "Save articles, PDFs and videos",
                      body: "Web pages, papers and YouTube transcripts, plus your own notes.",
                    },
                    {
                      icon: <IconSearch size={20} />,
                      title: "Search by meaning",
                      body: "Find a page by what it said, even if you forgot the title.",
                    },
                    {
                      icon: <IconMessage size={20} />,
                      title: "Ask, with sources",
                      body: "Answers come only from what you saved, each one linked back.",
                    },
                  ]}
                />
              </div>
              <div className="mt-10 flex justify-end">
                <Button
                  size="lg"
                  trailingIcon={<IconArrowRight size={18} />}
                  onClick={() => setStep(2)}
                >
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="mt-3 font-display text-[34px] font-bold leading-tight tracking-tight sm:text-[44px]">
                You can see everything it keeps.
              </h1>
              <p className="mt-3 text-[18px] text-muted">
                Here is what the extension does.
              </p>
              <div className="mt-8">
                <PointList
                  points={[
                    {
                      icon: <IconGlobe size={20} />,
                      title: "Saves pages as you read",
                      body: "While you're signed in, the extension saves the pages you open. You can also save one right away from the toolbar.",
                    },
                    {
                      icon: <IconShield size={20} />,
                      title: "Skips sensitive pages",
                      body: "Banking, health, tax and sign-in pages are never saved. The check runs in your browser.",
                    },
                    {
                      icon: <IconDownload size={20} />,
                      title: "Yours to review",
                      body: "Every save shows up in your timeline, where you can delete it, or export everything as JSON.",
                    },
                  ]}
                />
              </div>
              <div className="mt-10 flex items-center justify-between gap-3">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  size="lg"
                  trailingIcon={<IconArrowRight size={18} />}
                  onClick={() => setStep(3)}
                >
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="mt-3 font-display text-[34px] font-bold leading-tight tracking-tight sm:text-[44px]">
                What should Echo remember?
              </h1>
              <p className="mt-3 text-[18px] text-muted">
                Echo saves the pages you read while you&apos;re signed in. Pick what
                matters to you; you can change this in Sources and block any site in
                Privacy.
              </p>
              <fieldset className="mt-8">
                <legend className="sr-only">Sources</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {SOURCE_CATALOG.map((source) => {
                    const isAvailable = source.available;
                    const isSelected =
                      isAvailable && selectedSources.includes(source.id);
                    const badge = SOURCE_BADGE[source.id];
                    return (
                      <label
                        key={source.id}
                        className={cx(
                          "flex flex-col rounded-card border-2 bg-surface p-5 transition-colors",
                          !isAvailable
                            ? "cursor-not-allowed border-line-soft opacity-60"
                            : isSelected
                              ? "cursor-pointer border-accent"
                              : "cursor-pointer border-line hover:border-muted",
                        )}
                      >
                        <span className="flex items-start justify-between gap-3">
                          {badge ? (
                            <SourceBadge type={badge} />
                          ) : (
                            <span className="text-muted">
                              {SOURCE_ICONS[source.id]}
                            </span>
                          )}
                          <span className="flex items-center gap-3">
                            {!isAvailable && <Tag>Coming soon</Tag>}
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!isAvailable}
                              onChange={() => toggleSource(source.id)}
                              className={cx(
                                "h-5 w-5 shrink-0 accent-accent",
                                isAvailable ? "cursor-pointer" : "cursor-not-allowed",
                              )}
                            />
                          </span>
                        </span>
                        <span className="mt-3 text-[17px] font-semibold text-fg">
                          {source.name}
                        </span>
                        <span className="mt-1 text-[15px] leading-snug text-muted">
                          {source.description}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <p className="mt-6 flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[15px] text-fg">
                <IconShield size={20} className="shrink-0 text-accent-soft-fg" />
                Banking, health and login pages are always skipped.
              </p>
              <div className="mt-10 flex items-center justify-between gap-3">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  size="lg"
                  trailingIcon={<IconArrowRight size={18} />}
                  onClick={continueFromSources}
                  disabled={selectedSources.length === 0}
                >
                  {isAuthenticated ? "Continue" : "Create account to continue"}
                </Button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="mt-3 font-display text-[34px] font-bold leading-tight tracking-tight sm:text-[44px]">
                You&apos;re all set.
              </h1>
              <p className="mt-3 text-[18px] text-muted">
                These sources show as active in Sources. You can pause or add more
                anytime.
              </p>
              <div className="mt-8 rounded-card border border-line bg-surface p-5">
                <Eyebrow>Selected sources</Eyebrow>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedSources.map((sourceId) => {
                    const source = SOURCE_CATALOG.find((item) => item.id === sourceId);
                    return <Tag key={sourceId}>{source?.name ?? sourceId}</Tag>;
                  })}
                </div>
              </div>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-btn bg-accent-soft px-4 py-3 text-[15px] text-accent-soft-fg"
                >
                  {error}
                </p>
              )}
              <div className="mt-10 flex items-center justify-between gap-3">
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Back
                </Button>
                <Button
                  size="lg"
                  trailingIcon={<IconArrowRight size={18} />}
                  onClick={handleComplete}
                  loading={isSubmitting}
                >
                  {isSubmitting ? "Saving" : "Go to Home"}
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
