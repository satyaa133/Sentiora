import { Button, Echo, IconRefresh } from "@shared/ui";

interface ErrorViewProps {
  message: string;
  onRetry: () => void;
  onBack: () => void;
}

export default function ErrorView({ message, onRetry, onBack }: ErrorViewProps) {
  return (
    <section className="flex flex-col items-center px-5 pb-5 pt-7 text-center">
      <Echo state="faded" size={84} />
      <h1 className="mt-4 font-display text-[22px] font-bold tracking-tight">
        Echo couldn&apos;t save this page
      </h1>
      <p role="alert" className="mt-2 text-[15px] leading-relaxed text-muted">
        {message}
      </p>
      <div className="mt-5 flex w-full gap-2">
        <Button variant="secondary" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          leadingIcon={<IconRefresh size={18} />}
          onClick={onRetry}
          className="flex-[1.6]"
        >
          Try again
        </Button>
      </div>
    </section>
  );
}
