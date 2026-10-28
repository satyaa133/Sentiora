import { Button, Echo, IconUndo, SourceBadge } from "@shared/ui";

interface SavedViewProps {
  title: string;
  sourceType: string;
  /** True once the server reports the memory as indexed. */
  indexed: boolean;
  /** Undo is offered only when this save created a new memory. */
  canUndo: boolean;
  undoing: boolean;
  undoError?: string | null;
  onUndo: () => void;
  onOpenApp: () => void;
}

export default function SavedView({
  title,
  sourceType,
  indexed,
  canUndo,
  undoing,
  undoError,
  onUndo,
  onOpenApp,
}: SavedViewProps) {
  return (
    <>
      <section className="flex flex-col items-center bg-inverse px-5 pb-7 pt-8 text-center">
        <Echo state="happy" size={84} tone="inverse" />
        <h1
          role="status"
          className="mt-4 font-display text-[22px] font-bold tracking-tight text-on-inverse"
        >
          Saved. Echo&apos;s got it.
        </h1>
        <p className="mt-1 text-[15px] text-on-inverse-muted">
          {indexed ? "Searchable now." : "Searchable in a few seconds."}
        </p>
      </section>
      <section className="space-y-4 px-5 pb-5 pt-5">
        <div className="flex items-start gap-3">
          <SourceBadge type={sourceType} className="mt-0.5" />
          <p className="line-clamp-3 text-[17px] font-semibold leading-snug text-fg">
            {title}
          </p>
        </div>
        {undoError ? (
          <p role="alert" className="text-[15px] text-link">
            {undoError}
          </p>
        ) : null}
        <div className="flex gap-2">
          {canUndo ? (
            <Button
              leadingIcon={<IconUndo size={18} />}
              onClick={onUndo}
              loading={undoing}
              className="flex-1"
            >
              Undo
            </Button>
          ) : null}
          <Button variant="inverse" onClick={onOpenApp} className="flex-[1.6]">
            Open in Sentiora
          </Button>
        </div>
      </section>
    </>
  );
}
