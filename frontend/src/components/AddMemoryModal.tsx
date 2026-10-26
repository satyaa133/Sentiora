import { useState, type FormEvent } from "react";
import { Button, Chip, IconAlert, Modal, TextAreaField, TextField } from "@shared/ui";
import {
  createMemoryItem,
  type CreateMemoryItemPayload,
} from "../services/memoryService";

interface AddMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const SOURCE_OPTIONS = [
  { id: "webpage", label: "Web" },
  { id: "pdf", label: "PDF" },
  { id: "youtube", label: "Video" },
] as const;

export default function AddMemoryModal({
  isOpen,
  onClose,
  onSuccess,
}: AddMemoryModalProps) {
  const [sourceType, setSourceType] = useState<"webpage" | "pdf" | "youtube">(
    "webpage",
  );
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
    <Modal
      open
      onClose={onClose}
      title="Add a memory"
      description="Paste notes, an article or a transcript you want Sentiora to remember."
      size="lg"
    >
      <form id="add-memory-form" onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-btn bg-accent-soft px-4 py-3 text-[15px] text-accent-soft-fg"
          >
            <IconAlert size={18} className="mt-0.5 shrink-0" />
            {errorMsg}
          </p>
        )}

        <div role="group" aria-labelledby="add-memory-type" className="space-y-2">
          <p id="add-memory-type" className="text-[15px] font-semibold text-fg">
            Type
          </p>
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((option) => (
              <Chip
                key={option.id}
                selected={sourceType === option.id}
                onClick={() => setSourceType(option.id)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>

        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <TextField
          label="Source address (optional)"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
        />
        <TextField
          label="Author or publisher (optional)"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <TextAreaField
          label="Content"
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste the text, your notes or key takeaways"
          required
        />

        <div className="flex flex-col-reverse gap-2 border-t border-line-soft pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={!title.trim() || !content.trim()}
          >
            Save memory
          </Button>
        </div>
      </form>
    </Modal>
  );
}
