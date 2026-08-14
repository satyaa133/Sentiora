import type { MemoryItem } from "../types/memory";
import { formatExtractedContent } from "../utils/contentFormatter";

interface MemoryCardProps {
  item: MemoryItem;
  onSelect: (item: MemoryItem) => void;
  onDelete?: (id: string) => void;
}

export default function MemoryCard({ item, onSelect, onDelete }: MemoryCardProps) {
  // Format relative time (e.g. Saved 2 hours ago)
  function getRelativeTimeString(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffSecs < 60) return "Saved just now";
      if (diffSecs < 3600) return `Saved ${Math.floor(diffSecs / 60)} mins ago`;
      if (diffSecs < 86400) return `Saved ${Math.floor(diffSecs / 3600)} hours ago`;
      if (diffSecs < 172800) return "Saved yesterday";
      return `Saved ${Math.floor(diffSecs / 86400)} days ago`;
    } catch {
      return "Saved recently";
    }
  }

  function renderSourceBadge() {
    switch (item.source_type) {
      case "youtube":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-youtubeBadge-100 text-youtubeBadge-600">
            YOUTUBE
          </span>
        );
      case "pdf":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amberBadge-100 text-amberBadge-600">
            PDF
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-moss-100 text-moss-600">
            WEBPAGE
          </span>
        );
    }
  }

  const formatted = formatExtractedContent(item);

  return (
    <article
      onClick={() => onSelect(item)}
      className="group bg-white/85 hover:bg-white/95 backdrop-blur-sm border border-parchment-200/80 hover:border-moss-600/40 rounded-xl p-5 transition-all duration-200 cursor-pointer shadow-card hover:shadow-lg hover:-translate-y-0.5 flex items-start justify-between gap-4 relative"
    >
      <div className="space-y-2 flex-1 min-w-0">
        {/* Source badge + timestamp */}
        <div className="flex items-center gap-2 text-xs">
          {renderSourceBadge()}
          {item.status && item.status !== "ready" && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase ${
                item.status === "failed"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-amberBadge-100 text-amberBadge-600"
              }`}
            >
              {item.status === "failed" ? "Failed" : "Processing..."}
            </span>
          )}
          <span className="text-[11px] text-ink-500 font-medium">
            {getRelativeTimeString(item.captured_at)}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-base font-bold text-ink-900 group-hover:text-moss-600 transition-colors line-clamp-1">
          {item.title}
        </h3>

        {/* Excerpt */}
        {formatted.cleanText && (
          <p className="text-xs text-ink-700 line-clamp-2 leading-relaxed">
            {formatted.cleanText}
          </p>
        )}
      </div>

      {/* Action Icons */}
      <div className="flex items-center gap-2 shrink-0 pt-1">
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            title="Delete Memory"
            className="p-1 rounded-lg text-ink-400 hover:text-rose-600 hover:bg-rose-50/80 opacity-0 group-hover:opacity-100 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
        <div className="text-ink-500 group-hover:text-moss-600 group-hover:translate-x-1 transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </div>
      </div>
    </article>
  );
}
