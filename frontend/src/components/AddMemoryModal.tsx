import { useState, type FormEvent } from "react";
import { createMemoryItem, type CreateMemoryItemPayload } from "../services/memoryService";

interface AddMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddMemoryModal({ isOpen, onClose, onSuccess }: AddMemoryModalProps) {
  const [sourceType, setSourceType] = useState<"webpage" | "pdf" | "youtube">("webpage");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setErrorMsg("Please provide both a title and content.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const payload: CreateMemoryItemPayload = {
        source_type: sourceType,
        title: title.trim(),
        url: url.trim() || `https://sentiora.app/manual/${Date.now()}`,
        content: content.trim(),
        author: author.trim() || undefined,
      };

      await createMemoryItem(payload);
      onSuccess();
      onClose();
      // Reset form
      setTitle("");
      setUrl("");
      setContent("");
      setAuthor("");
    } catch (err: unknown) {
      console.error("Error creating memory item:", err);
      setErrorMsg("Failed to save memory item. Please check your inputs.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-ink-900/50 backdrop-blur-md transition-opacity"
      />

      {/* Modal Box */}
      <div className="relative bg-white/95 backdrop-blur-xl border border-parchment-200/90 rounded-2xl shadow-2xl max-w-lg w-full p-6 z-10 space-y-5 text-ink-900 font-sans">
        <div className="flex items-center justify-between border-b border-parchment-200/80 pb-3">
          <div className="space-y-0.5">
            <h2 className="font-serif font-bold text-lg text-ink-900">Manually Add Memory</h2>
            <p className="text-xs text-ink-500">Ingest custom notes, articles, or video transcripts into your vault.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-400 hover:text-ink-900 hover:bg-parchment-100 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Source Type Selector */}
          <div>
            <label className="block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1.5">
              Source Category
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["webpage", "pdf", "youtube"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSourceType(type)}
                  className={`py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    sourceType === type
                      ? "bg-moss-600 text-white border-moss-600 shadow-sm"
                      : "bg-parchment-50 hover:bg-parchment-100 text-ink-700 border-parchment-200"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Clean Architecture & System Design Notes"
              className="w-full bg-parchment-50/80 border border-parchment-200 rounded-xl px-3.5 py-2.5 text-xs text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium"
              required
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1">
              Source URL (Optional)
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full bg-parchment-50/80 border border-parchment-200 rounded-xl px-3.5 py-2.5 text-xs text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium"
            />
          </div>

          {/* Author */}
          <div>
            <label className="block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1">
              Author / Publisher (Optional)
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="e.g. Martin Fowler"
              className="w-full bg-parchment-50/80 border border-parchment-200 rounded-xl px-3.5 py-2.5 text-xs text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1">
              Memory Content / Notes *
            </label>
            <textarea
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste article text, notes, key takeaways, or transcript details..."
              className="w-full bg-parchment-50/80 border border-parchment-200 rounded-xl p-3 text-xs text-ink-900 focus:outline-none focus:border-moss-600 focus:bg-white font-medium leading-relaxed"
              required
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-parchment-200/80 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-parchment-200 text-ink-700 hover:bg-parchment-100 font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !content.trim()}
              className="px-5 py-2.5 rounded-xl bg-moss-600 hover:bg-moss-700 text-white font-bold transition-all disabled:opacity-50 shadow-sm"
            >
              {isSubmitting ? "Ingesting..." : "Save to Vault"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
