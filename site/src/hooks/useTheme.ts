import { useEffect, useState } from "react";
import type { ThemePreference } from "../types";

const storageKey = "models-cn-theme";

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" || value === "system"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

export function useTheme(): [
  ThemePreference,
  (theme: ThemePreference) => void,
] {
  const [preference, setPreference] = useState(readPreference);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        preference === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preference;
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#07110f" : "#f4f8f6");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  const update = (theme: ThemePreference) => {
    setPreference(theme);
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // The preference still applies for the current page.
    }
  };

  return [preference, update];
}
