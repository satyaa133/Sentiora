import { useEffect, useId, useRef, useState } from "react";
import { IconCheck, IconChevronDown, SourceBadge, cx } from "@shared/ui";
import type { AskScope } from "../../../services/askService";
import type { MemoryItem, SourceType } from "../../../types/memory";

const TYPES: Array<{ sourceType: SourceType; label: string }> = [
  { sourceType: "webpage", label: "Web pages" },
  { sourceType: "pdf", label: "PDFs" },
  { sourceType: "youtube", label: "Videos" },
];

interface ScopePickerProps {
  scope: AskScope | null;
  items: MemoryItem[];
  onChange: (scope: AskScope | null) => void;
}

/** "Search in": all memories, one source type, or one specific memory. */
export function ScopePicker({ scope, items, onChange }: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: AskScope | null) {
    onChange(next);
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  }

  const needle = query.trim().toLowerCase();
  const memories = items
    .filter((item) => item.status === "ready")
    .filter((item) => !needle || item.title.toLowerCase().includes(needle))
    .slice(0, 8);

  const option = (selected: boolean) =>
    cx(
      "flex min-h-touch w-full items-center gap-2 rounded-btn px-3 text-left text-[15px] text-fg hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
      selected && "font-semibold",
    );

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-touch items-center gap-1 rounded-full px-2 text-[15px] text-muted hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Search in: <span className="max-w-[12rem] truncate font-medium text-fg">{scope?.label ?? "All memories"}</span>
        <IconChevronDown size={14} />
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose what Echo searches"
          className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 shadow-pop"
        >
          <button type="button" className={option(!scope)} onClick={() => choose(null)}>
            {!scope ? <IconCheck size={16} /> : <span className="w-4" />}
            All memories
          </button>
          <p className="px-3 pt-2 font-mono text-eyebrow uppercase text-muted">By type</p>
          {TYPES.map(({ sourceType, label }) => {
            const selected = scope?.sourceType === sourceType && !scope.memoryId;
            return (
              <button
                key={sourceType}
                type="button"
                className={option(selected)}
                onClick={() => choose({ sourceType, label })}
              >
                {selected ? <IconCheck size={16} /> : <span className="w-4" />}
                {label}
              </button>
            );
          })}
          <p className="px-3 pt-2 font-mono text-eyebrow uppercase text-muted">One memory</p>
          <label className="sr-only" htmlFor={`${panelId}-filter`}>
            Find a memory
          </label>
          <input
            id={`${panelId}-filter`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a memory…"
            className="mx-1 my-1 h-10 w-[calc(100%-0.5rem)] rounded-btn border border-line bg-bg px-3 text-[15px] text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <ul className="max-h-56 overflow-y-auto">
            {memories.map((item) => {
              const selected = scope?.memoryId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={option(selected)}
                    onClick={() => choose({ memoryId: item.id, label: item.title })}
                  >
                    {selected ? <IconCheck size={16} /> : <SourceBadge type={item.source_type} />}
                    <span className="truncate">{item.title}</span>
                  </button>
                </li>
              );
            })}
            {memories.length === 0 ? (
              <li className="px-3 py-2 text-[15px] text-muted">No matching memories.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
