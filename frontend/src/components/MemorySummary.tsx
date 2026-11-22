import { useState } from "react";
import { Button, IconSparkles, Skeleton } from "@shared/ui";
import { usePrivacyConsent } from "../hooks/usePrivacyConsent";
import { getApiErrorCode, getApiErrorMessage } from "../services/apiClient";
import { enrichMemoryItem } from "../services/memoryService";
import type { MemoryItem } from "../types/memory";

interface MemorySummaryProps {
  item: MemoryItem;
  /** The save after Summarise (enrichment queued). */
  onChanged: (item: MemoryItem) => void;
}

/**
 * Summary and key points of an enriched save (S5), or Summarise to write them
 * now. Summaries are written by an AI provider, so the privacy notice applies.
 */
export function MemorySummary({ item, onChanged }: MemorySummaryProps) {
  const { requireConsent, consentMissing, consentModal } = usePrivacyConsent();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = item.enrichment_status ?? "none";
  const points = (item.key_points ?? []).filter((point) => point.trim());
  const hasSummary = Boolean(item.summary?.trim());

  async function summarise() {
    setRequesting(true);
    setError(null);
    try {
      onChanged(await enrichMemoryItem(item.id));
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === "ENRICHMENT_ALREADY_QUEUED") {
        onChanged({ ...item, enrichment_status: "queued" });
      } else if (code === "PRIVACY_CONSENT_REQUIRED") {
        consentMissing(() => void summarise());
      } else if (code === "RATE_LIMITED") {
        setError("You've reached today's summary limit. Try again tomorrow.");
      } else {
        setError(getApiErrorMessage(err, "Could not start the summary. Try again."));
      }
    } finally {
      setRequesting(false);
    }
  }

  if (item.status !== "ready") return null;

  return (
    <section aria-labelledby="memory-summary-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="memory-summary-heading" className="text-[17px] font-semibold">
          Summary
        </h3>
        {status !== "queued" ? (
          <Button
            variant={hasSummary ? "ghost" : "secondary"}
            size="sm"
            leadingIcon={<IconSparkles size={16} />}
            loading={requesting}
            onClick={() => void requireConsent(() => void summarise())}
          >
            {hasSummary ? "Summarise again" : "Summarise"}
          </Button>
        ) : null}
      </div>

      {status === "queued" ? (
        <div role="status" className="space-y-2">
          <p className="text-[15px] text-muted">Echo is writing a summary of this save…</p>
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : hasSummary ? (
        <div className="space-y-3 rounded-card bg-raised p-4">
          <p className="text-[17px] leading-relaxed text-fg">{item.summary}</p>
          {points.length ? (
            <>
              <h4 className="font-mono text-eyebrow uppercase text-muted">Key points</h4>
              <ul className="list-disc space-y-1.5 pl-5 text-[16px] text-fg">
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : status === "failed" ? (
        <p className="text-[15px] text-muted">Echo couldn't summarise this save. Try again.</p>
      ) : (
        <p className="text-[15px] text-muted">
          No summary yet. Summarise writes one with its key points.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-[15px] text-link">
          {error}
        </p>
      ) : null}
      {consentModal}
    </section>
  );
}
