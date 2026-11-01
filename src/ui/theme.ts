import { useEffect } from "react";
import type { Preferences } from "../types";
export function useTheme(theme: Preferences["theme"]) {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme:dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
