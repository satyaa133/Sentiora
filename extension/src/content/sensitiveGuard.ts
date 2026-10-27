import { getUrlBlockReason, isPdfUrl } from "../shared/blocklist";

export type SensitivityReason = "blocked_url" | "user_blocked" | "noindex" | "password_field";

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

/**
 * Runs in the page before any extraction or message, so a sensitive page never
 * leaves the browser. `userDomains` are the sites blocked in the Privacy Center.
 */
export function getPageSensitivityReason(
  userDomains: readonly string[] = [],
): SensitivityReason | null {
  const url = window.location.href;
  const blockReason = getUrlBlockReason(url, { allowLocalPdf: isPdfUrl(url), userDomains });

  if (blockReason === "built_in") {
    return "blocked_url";
  }
  if (blockReason === "user") {
    return "user_blocked";
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

export function isCurrentPageSensitive(userDomains: readonly string[] = []): boolean {
  return getPageSensitivityReason(userDomains) !== null;
}
