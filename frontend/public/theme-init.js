/* global window, document */
// Applies the saved theme before React loads so there is no light/dark flash.
// Mirrors initTheme() in shared/src/ui/theme.ts; keep the storage key in sync.
(function () {
  try {
    var theme = window.localStorage.getItem("sentiora-theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // Storage unavailable: follow the OS preference.
  }
})();
