import { Button, IconArrowRight, IconNote } from "@shared/ui";

import { shortAge, sourceLabel } from "../format";

export interface RecentMemory {
  id: string;
  title: string;
  source_type: string;
  captured_at?: string | null;
  created_at?: string | null;
}

interface ReadyViewProps {
  tabTitle: string;
  tabType: string;
  tabHost: string;
  /** null while loading or when the request failed: the section is hidden. */
  recent: RecentMemory[] | null;
  /** One-line status after an action, e.g. after Undo. */
  notice?: string | null;
  saving: boolean;
  onSave: () => void;
  onAddNote: () => void;
  onOpenApp: () => void;
}

export default function ReadyView({
  tabTitle,
  tabType,
  tabHost,
  recent,
  notice,
  saving,
  onSave,
  onAddNote,
  onOpenApp,
}: ReadyViewProps) {
  return (
    <>
      <section className="space-y-4 px-5 pb-5 pt-5">
        <div className="rounded-card bg-raised p-4">
          <p className="truncate font-mono text-eyebrow text-muted">
            <span className="uppercase">{sourceLabel(tabType)}</span>
            {tabHost ? ` · ${tabHost}` : ""}
          </p>
          <h1 className="mt-1.5 line-clamp-3 text-[17px] font-semibold leading-snug text-fg">
            {tabTitle}
          </h1>
        </div>

        {notice ? (
          <p role="status" className="text-[15px] text-muted">
            {notice}
          </p>
        ) : null}

        <Button size="lg" fullWidth onClick={onSave} loading={saving}>
          Save to memory
        </Button>
        <Button
          variant="ghost"
          fullWidth
          leadingIcon={<IconNote size={18} />}
          onClick={onAddNote}
          className="text-muted hover:text-fg"
        >
          Write a quick note instead
        </Button>
      </section>

      <section
        aria-labelledby="recent-heading"
        className="border-t border-line px-5 pb-4 pt-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-heading" className="text-[15px] text-muted">
            Recently saved
          </h2>
          <button
            type="button"
            onClick={onOpenApp}
            className="inline-flex min-h-touch items-center gap-1 text-[15px] font-medium text-link hover:underline"
          >
            Open Sentiora
            <IconArrowRight size={16} />
          </button>
        </div>
        {recent && recent.length > 0 ? (
          <ul className="mt-1 space-y-2">
            {recent.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[15px] text-fg">{item.title}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {sourceLabel(item.source_type)} ·{" "}
                  {shortAge(item.captured_at ?? item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : recent ? (
          <p className="mt-1 text-[15px] text-muted">Nothing saved yet.</p>
        ) : null}
      </section>
    </>
  );
}
