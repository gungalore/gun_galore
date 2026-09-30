'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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
  useEffect(() => {
    setTheme(resolveTheme(getStoredTheme()));
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

  // Sync DOM when theme changes — EXCEPT on the very first run. The pre-paint
  // script has already put the right value on <html>, and this render's
  // `theme` is the placeholder 'light': writing it here would flip an OS-dark
  // page to light for one tick before the adopt effect corrects it — a flash
  // on exactly the devices that had nothing wrong with them.
  const syncedOnce = useRef(false);
  useEffect(() => {
    if (!syncedOnce.current) {
      syncedOnce.current = true;
      return;
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Listen for external theme changes (direct DOM manipulation)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const newTheme = document.documentElement.dataset.theme;
      if (newTheme && (newTheme === 'light' || newTheme === 'dark')) {
        localStorage.setItem(STORAGE_KEY, newTheme);
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
