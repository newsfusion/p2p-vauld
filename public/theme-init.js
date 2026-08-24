// Theme initializer — loaded before React to prevent flash of wrong theme.
// Must be a separate file (no inline scripts allowed in Chrome MV3).
const t = localStorage.getItem("p2p-vauld-theme") || "system";
const isDark =
  t === "dark" ||
  (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.remove("light", "dark");
document.documentElement.classList.add(isDark ? "dark" : "light");
