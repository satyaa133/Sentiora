import { isUrlBlocked } from "../shared/blocklist";

function isVisiblePasswordField(): boolean {
  const passwordInputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  for (const input of passwordInputs) {
    const rect = input.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return true;
    }
  }
  return false;
}

export function isCurrentPageSensitive(manualCapture = false): boolean {
  const url = window.location.href;

  if (isUrlBlocked(url)) {
    return true;
  }

  const noindexMeta = document.querySelector('meta[name="robots"][content*="noindex"]');
  if (noindexMeta) {
    return true;
  }

  // Auto-capture only: skip pages with visible login/password fields.
  // Manual "Capture Memory Now" bypasses this check.
  if (!manualCapture && isVisiblePasswordField()) {
    return true;
  }

  return false;
}
