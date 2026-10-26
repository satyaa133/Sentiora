import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  IconArrowRight,
  IconClock,
  IconHome,
  IconLink,
  IconMessage,
  IconSearch,
  IconSettings,
  IconShield,
  Kbd,
  SourceBadge,
  cx,
  useDialogBehavior,
  usePortalContainer,
} from "@shared/ui";

import type { MemoryItem } from "../types/memory";
import type { NavTab } from "./Sidebar";

interface PaletteOption {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: MemoryItem[];
  onNavigate: (tab: NavTab) => void;
  onAsk: (question: string) => void;
  onOpenMemory: (item: MemoryItem) => void;
}

const PAGES: Array<{ tab: NavTab; label: string; icon: ReactNode }> = [
  { tab: "dashboard", label: "Home", icon: <IconHome size={18} /> },
  { tab: "timeline", label: "Timeline", icon: <IconClock size={18} /> },
  { tab: "ask", label: "Ask Sentiora", icon: <IconMessage size={18} /> },
  { tab: "search", label: "Search", icon: <IconSearch size={18} /> },
  { tab: "sources", label: "Sources", icon: <IconLink size={18} /> },
  { tab: "privacy", label: "Privacy", icon: <IconShield size={18} /> },
  { tab: "settings", label: "Settings", icon: <IconSettings size={18} /> },
];

/** Ctrl/Cmd+K: jump to a page, open a memory by title, or ask a question. */
export default function CommandPalette({
  open,
  onClose,
  items,
  onNavigate,
  onAsk,
  onOpenMemory,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const container = usePortalContainer();
  const listId = useId();

  function close() {
    setQuery("");
    setActiveIndex(0);
    onClose();
  }

  useDialogBehavior(open, close, dialogRef, inputRef);

  const options = useMemo<PaletteOption[]>(() => {
    const q = query.trim().toLowerCase();
    const result: PaletteOption[] = [];
    if (q) {
      result.push({
        id: "ask",
        label: `Ask Sentiora: “${query.trim()}”`,
        icon: <IconMessage size={18} />,
        run: () => onAsk(query.trim()),
      });
      for (const item of items) {
        if (result.length >= 7) break;
        if (item.title.toLowerCase().includes(q)) {
          result.push({
            id: `memory-${item.id}`,
            label: item.title,
            hint: "Memory",
            icon: <SourceBadge type={item.source_type} />,
            run: () => onOpenMemory(item),
          });
        }
      }
    }
    for (const page of PAGES) {
      if (!q || page.label.toLowerCase().includes(q)) {
        result.push({
          id: `page-${page.tab}`,
          label: page.label,
          hint: "Page",
          icon: page.icon,
          run: () => onNavigate(page.tab),
        });
      }
    }
    return result;
  }, [query, items, onAsk, onNavigate, onOpenMemory]);

  if (!open || !container) return null;

  const safeIndex = Math.min(activeIndex, Math.max(0, options.length - 1));

  function choose(option: PaletteOption | undefined) {
    if (!option) return;
    close();
    option.run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (options.length ? (i + 1) % options.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) =>
        options.length ? (i - 1 + options.length) % options.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[safeIndex]);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div aria-hidden="true" className="absolute inset-0 bg-overlay" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="echo-float relative w-full max-w-xl overflow-hidden rounded-panel border border-line bg-surface text-fg shadow-float"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <IconSearch size={20} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              options[safeIndex] ? `${listId}-${safeIndex}` : undefined
            }
            aria-label="Search memories or ask a question"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search memories, pages, or ask a question"
            className="h-14 min-w-0 flex-1 bg-transparent text-[17px] text-fg placeholder:text-muted focus:outline-none"
          />
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        </div>
        <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === safeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              className={cx(
                "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-btn px-3 py-2",
                index === safeIndex ? "bg-raised" : "",
              )}
            >
              <span className="flex w-10 shrink-0 justify-center text-muted">
                {option.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-[16px]">
                {option.label}
              </span>
              {index === safeIndex ? (
                <IconArrowRight size={16} className="shrink-0 text-muted" />
              ) : option.hint ? (
                <span className="shrink-0 text-sm text-muted">{option.hint}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>,
    container,
  );
}
