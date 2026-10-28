import { Button, Echo } from "@shared/ui";

interface CapturingViewProps {
  phase: "extracting" | "saving";
  tabTitle: string;
  onCancel: () => void;
}

export default function CapturingView({
  phase,
  tabTitle,
  onCancel,
}: CapturingViewProps) {
  return (
    <section
      aria-busy="true"
      className="flex flex-col items-center px-5 pb-6 pt-8 text-center"
    >
      <Echo state="saving" size={84} />
      <h1 role="status" className="mt-4 font-display text-xl font-bold tracking-tight">
        {phase === "saving" ? "Saving to your memory" : "Reading the page"}
      </h1>
      <p className="mt-1 text-[15px] text-muted">
        {phase === "saving"
          ? "Almost there."
          : "Pulling out the text, headings and details."}
      </p>
      <p className="mt-4 line-clamp-2 w-full rounded-btn bg-raised px-4 py-3 text-left text-[15px] text-fg">
        {tabTitle}
      </p>
      <Button variant="ghost" onClick={onCancel} className="mt-3">
        Cancel
      </Button>
    </section>
  );
}
