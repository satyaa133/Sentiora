import {
  Button,
  IconArrowRight,
  IconCheck,
  IconLoader,
  IconNote,
  IconShield,
  cx,
} from "@shared/ui";

import { shortAge, sourceLabel } from "../format";

export interface RecentMemory {
  id: string;
  title: string;
  source_type: string;
  captured_at?: string | null;
  created_at?: string | null;
}

/** What the extension has done with the current page; "checking" until known. */
export type PageStatus = "checking" | "saved" | "saving" | "not_saved" | "blocked";

const STATUS_LABEL: Record<Exclude<PageStatus, "checking">, string> = {
  saved: "Saved",
  saving: "Saving…",
  not_saved: "Not saved yet",
  blocked: "Blocked",
};

function StatusPill({ status }: { status: Exclude<PageStatus, "checking"> }) {
  const icon =
    status === "saved" ? (
      <IconCheck size={14} />
    ) : status === "saving" ? (
      <IconLoader size={14} className="motion-safe:animate-spin" />
    ) : status === "blocked" ? (
      <IconShield size={14} />
    ) : null;
  return (
    <span
      className={cx(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium",
        status === "not_saved"
          ? "border border-line text-muted"
          : "bg-accent-soft text-accent-soft-fg",
      )}
    >
      {icon}
      {STATUS_LABEL[status]}
    </span>
  );
}

interface ReadyViewProps {
  tabTitle: string;
  tabType: string;
  tabHost: string;
  /** null while loading or when the request failed: the section is hidden. */
  recent: RecentMemory[] | null;
  /** One-line status after an action, e.g. after Undo. */
  notice?: string | null;
  status: PageStatus;
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
  status,
  saving,
  onSave,
  onAddNote,
  onOpenApp,
}: ReadyViewProps) {
  return (
    <>
      <section className="space-y-4 px-5 pb-5 pt-5">
        <div className="rounded-card bg-raised p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-mono text-eyebrow text-muted">
              <span className="uppercase">{sourceLabel(tabType)}</span>
              {tabHost ? ` · ${tabHost}` : ""}
            </p>
            <span role="status">
              {status === "checking" ? null : <StatusPill status={status} />}
            </span>
          </div>
          <h1 className="mt-1.5 line-clamp-3 text-[17px] font-semibold leading-snug text-fg">
            {tabTitle}
          </h1>
          {status === "not_saved" ? (
            <p className="mt-2 text-[15px] text-muted">
              Echo saves pages as you read them. Save this one now if it didn&apos;t
              catch it.
            </p>
          ) : null}
        </div>

        {notice ? (
          <p role="status" className="text-[15px] text-muted">
            {notice}
          </p>
        ) : null}

        {status === "not_saved" ? (
          <Button variant="secondary" fullWidth onClick={onSave} loading={saving}>
            Save now
          </Button>
        ) : null}
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
