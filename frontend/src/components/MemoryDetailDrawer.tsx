import { useState } from "react";
import type { MemoryItem } from "../types/memory";
import { formatExtractedContent } from "../utils/contentFormatter";

interface MemoryDetailDrawerProps {
  item: MemoryItem | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
}

export default function MemoryDetailDrawer({ item, onClose, onDelete }: MemoryDetailDrawerProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  async function handleDelete() {
    if (!item) return;
    if (!window.confirm("Are you sure you want to delete this memory item?")) return;

    setIsDeleting(true);
    try {
      await onDelete(item.id);
      onClose();
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

  let domain = "";
  try {
    domain = new URL(item.url).hostname;
  } catch {
    domain = item.url;
  }

  const readingTimeMin = Math.max(1, Math.ceil(item.reading_time_seconds / 60));
  const formatted = formatExtractedContent(item);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-ink-900/40 backdrop-blur-md transition-all duration-300"
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-2xl bg-parchment-0/95 backdrop-blur-xl border-l border-parchment-200/80 h-full flex flex-col justify-between shadow-2xl z-10 text-ink-900 font-sans">
        {/* Header */}
        <div className="p-6 border-b border-parchment-200/80 flex items-start justify-between gap-4 bg-parchment-50/90 backdrop-blur-md">
          <div className="space-y-1.5">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-moss-100 text-moss-600">
              {item.source_type.toUpperCase()}
            </span>
            <h2 className="text-xl font-bold font-serif text-ink-900 leading-snug">{item.title}</h2>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-moss-600 hover:underline font-medium truncate max-w-md"
            >
              <span>{domain}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-ink-500 hover:text-ink-900 hover:bg-parchment-200 rounded-xl transition-colors shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Metadata bar */}
          <div className="grid grid-cols-3 gap-3 p-4 bg-white border border-parchment-200 rounded-xl text-center shadow-card">
            <div>
              <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wider">Word Count</p>
              <p className="text-sm font-semibold text-ink-900 mt-0.5">{item.word_count}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wider">Reading Time</p>
              <p className="text-sm font-semibold text-ink-900 mt-0.5">{readingTimeMin} min</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wider">Captured</p>
              <p className="text-sm font-semibold text-ink-900 mt-0.5">
                {new Date(item.captured_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Thumbnail preview if present */}
          {item.thumbnail_url && (
            <div className="rounded-xl overflow-hidden border border-parchment-200">
              <img src={item.thumbnail_url} alt="" className="w-full h-auto object-cover max-h-64" />
            </div>
          )}

          {/* Full Extracted Text */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">
                  Extracted Content
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-parchment-200/90 text-ink-700">
                  {formatted.sourceLabel}
                </span>
              </div>
              <button
                onClick={handleCopyText}
                className="text-xs text-moss-600 hover:underline font-semibold flex items-center gap-1"
              >
                {copied ? "Copied!" : "Copy Text"}
              </button>
            </div>

            <div className="p-5 bg-white border border-parchment-200 rounded-xl text-ink-900 text-sm leading-relaxed space-y-4 font-sans shadow-card">
              {formatted.paragraphs.map((para, idx) => (
                <p key={idx} className="text-xs md:text-sm text-ink-800 leading-relaxed font-sans">
                  {para}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-parchment-200/80 bg-parchment-50/90 backdrop-blur-md flex items-center justify-between gap-3">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 rounded-xl bg-white border border-parchment-200 hover:bg-parchment-100 text-ink-900 text-xs font-semibold transition-colors flex items-center gap-2 shadow-card"
          >
            Open Source Page
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>

          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {isDeleting ? "Deleting..." : "Delete Memory"}
          </button>
        </div>
      </div>
    </div>
  );
}
