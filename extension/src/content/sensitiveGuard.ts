import { isPdfUrl, isUrlBlocked } from "../shared/blocklist";

export type SensitivityReason = "blocked_url" | "noindex" | "password_field";

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

export function getPageSensitivityReason(): SensitivityReason | null {
  const url = window.location.href;
  const allowLocalPdf = isPdfUrl(url);

  if (isUrlBlocked(url, { allowLocalPdf })) {
    return "blocked_url";
  }

  const noindexMeta = document.querySelector('meta[name="robots"][content*="noindex"]');
  if (noindexMeta) {
    return "noindex";
  }

  // Manual capture must not bypass password-field protection.
  if (isVisiblePasswordField()) {
    return "password_field";
  }

  return null;
}

export function isCurrentPageSensitive(_manualCapture = false): boolean {
  return getPageSensitivityReason() !== null;
}
