import { useState, type FormEvent } from "react";
import { Button, TextField } from "@shared/ui";
import { getApiErrorMessage } from "../services/apiClient";
import { renameMemoryItem } from "../services/memoryService";
import type { MemoryItem } from "../types/memory";

const MAX_TITLE = 300;

interface RenameMemoryFormProps {
  item: MemoryItem;
  onRenamed: (item: MemoryItem) => void;
  onCancel: () => void;
}

/** Edit a save's title (PATCH /memory-items/{id}, S7). */
export function RenameMemoryForm({ item, onRenamed, onCancel }: RenameMemoryFormProps) {
  const [title, setTitle] = useState(item.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const cleaned = title.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      setError("Give this save a title.");
      return;
    }
    if (cleaned === item.title) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onRenamed(await renameMemoryItem(item.id, cleaned));
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not rename this save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="Rename this save">
      <TextField
        label="Title"
        value={title}
        maxLength={MAX_TITLE}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        error={error ?? undefined}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={saving}>
          Save title
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
