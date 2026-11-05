'use client';

import { useState, useEffect, useCallback } from 'react';

type ThemeValue = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'gg-theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getStoredTheme(): ThemeValue {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function resolveTheme(preference: ThemeValue): ResolvedTheme {
  if (preference === 'system') return getSystemTheme();
  return preference;
}

// The viewport export emits two <meta name="theme-color"> tags selected by
// prefers-color-scheme. That is fine for the OS default, but this app also has
// an explicit light/dark control.
//
// ⚠️ INSTALLED ANDROID PWA: the system navigation bar background follows the
// device, not this app, and Chrome derives the navigation-button tint from
// theme-color. A dark theme-color therefore produced white buttons on the
// device's white bar — invisible. Keep the installed app on the light system
// colour so the buttons stay dark and visible; the app content itself remains
// dark. Browser tabs keep the app-coloured theme-color.
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#F7F6F3',
  dark: '#131110',
};

function syncThemeColor(theme: ResolvedTheme): void {
  const standalone =
    document.documentElement.dataset.standalone === 'true';
  const color = standalone ? '#F7F6F3' : THEME_COLOR[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', color);
  });
}

export function useTheme() {
  // ⚠️ THE FIRST RENDER IS ALWAYS 'light', AND THAT IS THE FIX FOR A REAL
  // HYDRATION MISMATCH (found 2026-09-30, once the toggle was mounted in the
  // PWA's shell header on every page). Computing the initial state from
  // `window` made the server say "light" (no window → system resolves light)
  // and the client say "dark" on an OS-dark device, so React threw
  // "Hydration failed because the server rendered HTML didn't match" and
  // regenerated the tree. The PRE-PAINT script in layout.tsx has already set
  // data-theme before React runs, so the page itself never flashes — only this
  // hook's icon is one render behind, and the effect below corrects it
  // immediately after mount.
  const [theme, setTheme] = useState<ResolvedTheme>('light');

  const setThemeValue = useCallback((value: ThemeValue) => {
    localStorage.setItem(STORAGE_KEY, value);
    setTheme(resolveTheme(value));
  }, []);

  // Adopt whatever the pre-paint script decided (stored preference, else the
  // OS). Runs once on mount — after hydration, so it cannot reintroduce the
  // mismatch.
  //
  // ⚠️ ALSO RE-ASSERT THE THEME-COLOUR META HERE. On an Android PWA launch the
  // pre-paint script can run before Next has emitted the meta tags, leaving
  // Chrome with the OS-derived (dark) system chrome until something writes it
  // again. That is what left the bottom bar tucked behind the system bar until
  // the member toggled theme. One write after mount settles the system insets.
  useEffect(() => {
    const resolved = resolveTheme(getStoredTheme());
    setTheme(resolved);
    syncThemeColor(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    // Flip the currently *rendered* theme rather than stepping through the
    // stored preference. The pre-paint script sets data-theme without writing
    // localStorage, so the stored value can still be 'system' while the page
    // renders light. A resolved-theme flip makes one click always switch.
    const domTheme = document.documentElement.dataset.theme;
    const current: ResolvedTheme =
      domTheme === 'dark' || domTheme === 'light'
        ? domTheme
        : resolveTheme(getStoredTheme());
    const next: ResolvedTheme = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }, []);

  // Sync DOM when theme changes, but NEVER write the placeholder 'light'
  // over a stored/system dark page. A `syncedOnce` ref was not StrictMode-safe:
  // React double-invokes mount effects in development, the second pass saw the
  // ref already true and wrote the placeholder light, then the adopt effect's
  // dark state was overwritten. Comparing against the STORED preference is
  // idempotent across any number of mounts and keeps the pre-paint value.
  useEffect(() => {
    const resolved = resolveTheme(getStoredTheme());
    if (theme !== resolved) return;
    document.documentElement.dataset.theme = theme;
    syncThemeColor(theme);
  }, [theme]);

  // Keep every mounted instance's icon/state in step when one of them changes
  // the DOM. Do NOT write localStorage here: the pre-paint script and the sync
  // effect both touch data-theme, and a transient DOM value must never become
  // the member's saved preference. The action that changes the theme already
  // writes storage before it updates state.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const newTheme = document.documentElement.dataset.theme;
      if (newTheme && (newTheme === 'light' || newTheme === 'dark')) {
        setTheme(newTheme as ResolvedTheme);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return {
    theme,
    setTheme: setThemeValue,
    toggleTheme,
  };
}

export { STORAGE_KEY };
