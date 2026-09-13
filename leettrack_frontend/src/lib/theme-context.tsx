"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Theme = {
  accent_color: string;
  background_media: string;
  background_media_type: "video" | "image";
  // The link the Super Admin pasted in, kept around only for display
  // in the Appearance panel — the site itself never fetches this
  // directly (see background_media_proxy_path).
  background_media_url: string;
  // Relative backend path to the locally-cached copy of
  // background_media_url (empty if no URL is set). This is what
  // actually renders — the backend fetches the external link once and
  // caches it, so visitors' browsers hit our own server instead of
  // re-fetching the external host on every page load. See
  // BackgroundVideo.tsx.
  background_media_proxy_path: string;
  // Site-wide look-and-feel preset, applied via a `data-theme`
  // attribute on <html> (see globals.css for what each one changes —
  // purely panel styling, independent of accent_color/background).
  theme_preset: "classic" | "future";
  // Forces a solid color behind specific translucent surfaces (AI chat
  // input, AI reply bubbles, notification dropdown) instead of the
  // usual glass tint.
  dark_surfaces_enabled: boolean;
  dark_surfaces_color: string;
};

// No default media file assumed — an empty background_media means "no
// registered media yet" and the Background component just shows the
// dark gradient fallback. Nothing hardcoded to a specific filename.
const DEFAULT_THEME: Theme = {
  accent_color: "#FFFFFFF",
  background_media: "",
  background_media_type: "video",
  background_media_url: "",
  background_media_proxy_path: "",
  theme_preset: "future",
  dark_surfaces_enabled: false,
  dark_surfaces_color: "#000000",
};

const ThemeContext = createContext<Theme>(DEFAULT_THEME);

function applyThemeToDocument(t: Theme) {
  const root = document.documentElement;
  root.style.setProperty("--color-brand", t.accent_color);
  root.style.setProperty("--color-surface-dark", t.dark_surfaces_color);
  root.setAttribute("data-theme", t.theme_preset);
  root.setAttribute("data-dark-surfaces", t.dark_surfaces_enabled ? "on" : "off");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    api
      .get<Theme>("/api/settings/theme")
      .then((t) => {
        setTheme(t);
        applyThemeToDocument(t);
      })
      .catch(() => {
        // Backend not reachable yet / not running — fall back to defaults
        // rather than blocking render.
      });
  }, []);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
