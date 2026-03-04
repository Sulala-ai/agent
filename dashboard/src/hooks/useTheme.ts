import { useEffect, useState } from "react";

const STORAGE_KEY = "sulala-theme";
type Theme = "light" | "dark";

function getStored(): Theme {
  if (typeof window === "undefined") return "light";
  const s = localStorage.getItem(STORAGE_KEY);
  if (s === "dark" || s === "light") return s;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStored);

  useEffect(() => {
    apply(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (next: Theme | ((prev: Theme) => Theme)) => {
    setThemeState((prev) => (typeof next === "function" ? next(prev) : next));
  };

  const toggle = () =>
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));

  return { theme, setTheme, toggle };
}
