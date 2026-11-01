import type { FormEvent } from "react";

import { Button, TextAreaField, TextField } from "@shared/ui";

interface NoteViewProps {
  title: string;
  content: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export default function NoteView({
  title,
  content,
  onTitleChange,
  onContentChange,
  saving,
  onCancel,
  onSave,
}: NoteViewProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSave();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 px-5 pb-5 pt-5">
      <h1 className="font-display text-[22px] font-bold tracking-tight">Quick note</h1>
      <TextField
        label="Title"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="What is this about?"
        required
        autoFocus
      />
      <TextAreaField
        label="Note"
        value={content}
        onChange={(event) => onContentChange(event.target.value)}
        placeholder="Write your thoughts or paste a passage"
        rows={4}
      />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!title.trim()}
          loading={saving}
          className="flex-[1.6]"
        >
          Save note
        </Button>
      </div>
    </form>
  );
}
