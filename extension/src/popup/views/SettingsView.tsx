import { Button, IconLogOut, ThemeToggle, Toggle } from "@shared/ui";

interface SettingsViewProps {
  autoDetectSensitive: boolean;
  onAutoDetectSensitiveChange: (value: boolean) => void;
  showSaveConfirmation: boolean;
  onShowSaveConfirmationChange: (value: boolean) => void;
  email: string | undefined;
  itemCount: number | null;
  onSignOut: () => void;
  onDone: () => void;
}

export default function SettingsView({
  autoDetectSensitive,
  onAutoDetectSensitiveChange,
  showSaveConfirmation,
  onShowSaveConfirmationChange,
  email,
  itemCount,
  onSignOut,
  onDone,
}: SettingsViewProps) {
  return (
    <section className="space-y-5 px-5 pb-5 pt-5">
      <h1 className="font-display text-[22px] font-bold tracking-tight">Settings</h1>

      <div className="divide-y divide-line-soft rounded-card border border-line px-4">
        <Toggle
          label="Auto-detect sensitive pages"
          checked={autoDetectSensitive}
          onChange={onAutoDetectSensitiveChange}
        />
        <Toggle
          label="Show save confirmation"
          checked={showSaveConfirmation}
          onChange={onShowSaveConfirmationChange}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-[15px] font-semibold">Appearance</h2>
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-card bg-raised px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-fg">{email}</p>
          {itemCount !== null ? (
            <p className="text-sm text-muted">
              {itemCount} {itemCount === 1 ? "memory" : "memories"} saved
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<IconLogOut size={16} />}
          onClick={onSignOut}
          className="shrink-0"
        >
          Sign out
        </Button>
      </div>

      <Button variant="secondary" fullWidth onClick={onDone}>
        Done
      </Button>
    </section>
  );
}
