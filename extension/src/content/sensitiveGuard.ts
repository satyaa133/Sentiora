import { isUrlBlocked } from "../shared/blocklist";

export function isCurrentPageSensitive(): boolean {
  const url = window.location.href;

  // 1. Check blocklist
  if (isUrlBlocked(url)) {
    return true;
  }

  // 2. Check noindex meta tag
  const noindexMeta = document.querySelector('meta[name="robots"][content*="noindex"]');
  if (noindexMeta) {
    return true;
  }

  // 3. Check for password input fields on page (likely login / auth page)
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  if (passwordInputs.length > 0) {
    return true;
  }

  return false;
}
