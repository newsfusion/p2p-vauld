import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { RUNTIME_NAMES } from "./runtime-names.js";

type ThemeMode = "light" | "dark" | "system";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const t = window.localStorage.getItem(RUNTIME_NAMES.theme);
    return t === "light" || t === "dark" || t === "system" ? t : "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    let effectiveTheme = theme;
    if (theme === "system") {
      effectiveTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    root.classList.add(effectiveTheme);
    window.localStorage.setItem(RUNTIME_NAMES.theme, theme);
  }, [theme]);

  // Listen to system theme changes specifically when in system mode
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === "system") {
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(e.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((current) => {
      if (current === "system") return "light";
      if (current === "light") return "dark";
      return "system";
    });
  };

  return (
    <button
      type="button"
      aria-label={`Toggle theme (current: ${theme})`}
      title={`Toggle theme (current: ${theme})`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={cycleTheme}
    >
      {theme === "system" && <Monitor className="h-4 w-4" />}
      {theme === "light" && <Sun className="h-4 w-4" />}
      {theme === "dark" && <Moon className="h-4 w-4" />}
    </button>
  );
}
