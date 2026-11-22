import { useEffect, useState } from "react";
import {
  Button,
  Drawer,
  IconAlert,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconMessage,
  IconPencil,
  IconTrash,
  SourceBadge,
  Tag,
  buttonClasses,
} from "@shared/ui";
import { fetchMemoryItem } from "../services/memoryService";
import type { MemoryItem } from "../types/memory";
import { MemorySummary } from "./MemorySummary";
import { RenameMemoryForm } from "./RenameMemoryForm";
import { formatExtractedContent } from "../utils/contentFormatter";
import { sourceHref } from "../utils/safeHref";

interface MemoryDetailDrawerProps {
  item: MemoryItem | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onAskAnything?: (item: MemoryItem) => void;
  /** A newer copy of the save (renamed, summary requested or written). */
  onItemChanged?: (item: MemoryItem) => void;
}

// While a summary is being written, check for it this often, this many times.
const SUMMARY_POLL_MS = 4000;
const SUMMARY_POLLS = 30;

export default function MemoryDetailDrawer({
  item,
  onClose,
  onDelete,
  onAskAnything,
  onItemChanged,
}: MemoryDetailDrawerProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // The save as the API returns it now (summary, key points, new title).
  const [detail, setDetail] = useState<MemoryItem | null>(null);
  const itemId = item?.id ?? null;
  const current = detail && detail.id === itemId ? detail : item;
  const summarising = current?.enrichment_status === "queued";

  // Opening a save fetches it, which also queues its summary (S5).
  useEffect(() => {
    setRenaming(false);
    setDetail(null);
    if (!itemId) return;
    let cancelled = false;
    fetchMemoryItem(itemId)
      .then((fresh) => {
        if (!cancelled) setDetail(fresh);
      })
      .catch(() => {
        // The list copy is still shown.
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Show the summary as soon as it's written.
  useEffect(() => {
    if (!itemId || !summarising) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > SUMMARY_POLLS) {
        window.clearInterval(timer);
        return;
      }
      fetchMemoryItem(itemId)
        .then((fresh) => {
          setDetail(fresh);
          if (fresh.enrichment_status !== "queued") onItemChanged?.(fresh);
        })
        .catch(() => undefined);
    }, SUMMARY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [itemId, summarising, onItemChanged]);

  if (!item || !current) return null;

  function changed(next: MemoryItem) {
    setDetail(next);
    onItemChanged?.(next);
  }

  function close() {
    setConfirmingDelete(false);
    setRenaming(false);
    onClose();
  }

  async function handleDelete() {
    if (!item) return;
    setIsDeleting(true);
    try {
      await onDelete(item.id);
      close();
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCopyText() {
    if (!item?.content) return;
    navigator.clipboard.writeText(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const shown = current;
  const originalHref = sourceHref(shown.url);
  let domain = "";
  try {
    domain = new URL(shown.url).hostname;
  } catch {
    domain = shown.url;
  }

  const readingTimeMin = Math.max(1, Math.ceil(shown.reading_time_seconds / 60));
  const formatted = formatExtractedContent(shown);
  const capturedOn = new Date(shown.captured_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const footer = confirmingDelete ? (
    <div
      role="alertdialog"
      aria-label="Delete this memory?"
      className="flex w-full flex-wrap items-center justify-between gap-3"
    >
      <p className="text-[15px] font-semibold text-fg">Delete this memory?</p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => setConfirmingDelete(false)}
          autoFocus
        >
          Cancel
        </Button>
        <Button
          onClick={handleDelete}
          loading={isDeleting}
          leadingIcon={<IconTrash size={18} />}
        >
          Delete
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {onAskAnything && shown.status === "ready" && (
          <Button
            variant="inverse"
            leadingIcon={<IconMessage size={18} />}
            onClick={() => onAskAnything(shown)}
          >
            Ask about this
          </Button>
        )}
        {originalHref && (
          <a
            href={originalHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("secondary", "md")}
          >
            Open original
            <IconExternalLink size={16} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
      <Button
        variant="ghost"
        leadingIcon={<IconTrash size={18} />}
        onClick={() => setConfirmingDelete(true)}
        className="text-muted hover:text-fg"
      >
        Delete
      </Button>
    </div>
  );

  return (
    <Drawer
      open
      size="lg"
      onClose={close}
      title={shown.title}
      eyebrow={
        <span className="flex flex-wrap items-center gap-2 normal-case">
          <SourceBadge type={shown.source_type} />
          {shown.status === "failed" ? (
            <Tag>Failed</Tag>
          ) : shown.status !== "ready" ? (
            <Tag>Processing</Tag>
          ) : null}
        </span>
      }
      footer={footer}
    >
      <div className="space-y-6">
        {renaming ? (
          <RenameMemoryForm
            item={shown}
            onCancel={() => setRenaming(false)}
            onRenamed={(next) => {
              setRenaming(false);
              changed(next);
            }}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<IconPencil size={16} />}
            onClick={() => setRenaming(true)}
          >
            Rename
          </Button>
        )}

        {originalHref ? (
          <a
            href={originalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-[15px] text-link hover:underline"
          >
            <span className="truncate">{domain}</span>
            <IconExternalLink size={14} className="shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <p className="truncate text-[15px] text-muted">{domain}</p>
        )}

        {shown.status === "failed" && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-btn bg-accent-soft px-4 py-3 text-[15px] text-accent-soft-fg"
          >
            <IconAlert size={18} className="mt-0.5 shrink-0" />
            <span>
              {shown.processing_error || "This memory could not be indexed."} It is not
              searchable; capture it again to retry.
            </span>
          </p>
        )}

        <dl className="grid grid-cols-3 gap-3 rounded-card bg-raised p-4 text-center">
          <div>
            <dt className="font-mono text-eyebrow uppercase text-muted">Words</dt>
            <dd className="mt-1 font-semibold text-fg">{shown.word_count}</dd>
          </div>
          <div>
            <dt className="font-mono text-eyebrow uppercase text-muted">Reading</dt>
            <dd className="mt-1 font-semibold text-fg">{readingTimeMin} min</dd>
          </div>
          <div>
            <dt className="font-mono text-eyebrow uppercase text-muted">Saved</dt>
            <dd className="mt-1 font-semibold text-fg">{capturedOn}</dd>
          </div>
        </dl>

        <MemorySummary item={shown} onChanged={changed} />

        {shown.thumbnail_url && (
          <img
            src={shown.thumbnail_url}
            alt=""
            className="max-h-64 w-full rounded-card border border-line object-cover"
          />
        )}

        <section aria-labelledby="memory-content-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3
              id="memory-content-heading"
              className="flex items-center gap-2 text-[17px] font-semibold"
            >
              Saved text
              <span className="font-mono text-eyebrow font-normal uppercase text-muted">
                {formatted.sourceLabel}
              </span>
            </h3>
            {shown.content ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                onClick={handleCopyText}
              >
                {copied ? "Copied" : "Copy text"}
              </Button>
            ) : null}
          </div>
          <div className="space-y-4 text-[17px] leading-relaxed text-fg">
            {formatted.paragraphs.map((para, idx) => (
              <p key={idx}>{para}</p>
            ))}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
