import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cx } from "./cx.js";

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  /** Controlled selection. Omit to let Tabs manage it. */
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}

/** Segmented tabs with roving focus (Arrow keys, Home, End), WAI-ARIA tabs pattern. */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  label,
  className,
}: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? internal;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(id: string) {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    select(item.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-raised p-1"
      >
        {items.map((item, index) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                "h-9 shrink-0 rounded-full px-4 text-[15px] font-medium transition-colors",
                isSelected
                  ? "bg-surface text-fg shadow-pop"
                  : "text-muted hover:text-fg",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== selected}
          tabIndex={0}
          className="mt-4"
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
