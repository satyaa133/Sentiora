import { cx } from "@shared/ui";

interface EchoControlsProps {
  paused: boolean;
  onTogglePause: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  className?: string;
}

const CONTROL =
  "inline-flex min-h-touch items-center rounded-full px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg";

/** Small bottom-right group: Pause/Wake Echo and Sound on/off (DESIGN.md §8.4). */
export default function EchoControls({
  paused,
  onTogglePause,
  soundOn,
  onToggleSound,
  className,
}: EchoControlsProps) {
  return (
    <div
      role="group"
      aria-label="Echo"
      className={cx(
        "pointer-events-auto flex items-center rounded-full border border-line bg-surface/95 shadow-pop backdrop-blur",
        className,
      )}
    >
      <button type="button" onClick={onTogglePause} className={CONTROL}>
        {paused ? "Wake Echo" : "Pause Echo"}
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-line" />
      <button
        type="button"
        aria-pressed={soundOn}
        onClick={onToggleSound}
        className={CONTROL}
      >
        {soundOn ? "Sound on" : "Sound off"}
      </button>
    </div>
  );
}
