import { useState } from "react";
import {
  Button,
  Drawer,
  IconAlert,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconMessage,
  IconTrash,
  SourceBadge,
  Tag,
  buttonClasses,
} from "@shared/ui";
import type { MemoryItem } from "../types/memory";
import { formatExtractedContent } from "../utils/contentFormatter";
import { sourceHref } from "../utils/safeHref";

interface MemoryDetailDrawerProps {
  item: MemoryItem | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onAskAnything?: (item: MemoryItem) => void;
}

export default function MemoryDetailDrawer({
  item,
  onClose,
  onDelete,
  onAskAnything,
}: MemoryDetailDrawerProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  function close() {
    setConfirmingDelete(false);
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

  const originalHref = sourceHref(item.url);
  let domain = "";
  try {
    domain = new URL(item.url).hostname;
  } catch {
    domain = item.url;
  }

  const readingTimeMin = Math.max(1, Math.ceil(item.reading_time_seconds / 60));
  const formatted = formatExtractedContent(item);
  const capturedOn = new Date(item.captured_at).toLocaleDateString(undefined, {
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
        {onAskAnything && item.status === "ready" && (
          <Button
            variant="inverse"
            leadingIcon={<IconMessage size={18} />}
            onClick={() => onAskAnything(item)}
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
      title={item.title}
      eyebrow={
        <span className="flex flex-wrap items-center gap-2 normal-case">
          <SourceBadge type={item.source_type} />
          {item.status === "failed" ? (
            <Tag>Failed</Tag>
          ) : item.status !== "ready" ? (
            <Tag>Processing</Tag>
          ) : null}
        </span>
      }
      footer={footer}
    >
      <div className="space-y-6">
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

        {item.status === "failed" && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-btn bg-accent-soft px-4 py-3 text-[15px] text-accent-soft-fg"
          >
            <IconAlert size={18} className="mt-0.5 shrink-0" />
            <span>
              {item.processing_error || "This memory could not be indexed."} It is not
              searchable; capture it again to retry.
            </span>
          </p>
        )}

        <dl className="grid grid-cols-3 gap-3 rounded-card bg-raised p-4 text-center">
          <div>
            <dt className="font-mono text-eyebrow uppercase text-muted">Words</dt>
            <dd className="mt-1 font-semibold text-fg">{item.word_count}</dd>
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

        {item.thumbnail_url && (
          <img
            src={item.thumbnail_url}
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
            {item.content ? (
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
