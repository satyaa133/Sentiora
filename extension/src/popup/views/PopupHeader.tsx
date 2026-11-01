import { IconButton, IconClose, IconSettings, Logo } from "@shared/ui";

interface PopupHeaderProps {
  /** Omit to hide the settings button (signed out). */
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
}

export default function PopupHeader({
  onToggleSettings,
  settingsOpen = false,
}: PopupHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-line px-5">
      <Logo size={20} />
      {onToggleSettings ? (
        <IconButton
          label={settingsOpen ? "Close settings" : "Settings"}
          icon={settingsOpen ? <IconClose /> : <IconSettings />}
          onClick={onToggleSettings}
          className="-mr-2"
        />
      ) : null}
    </header>
  );
}
