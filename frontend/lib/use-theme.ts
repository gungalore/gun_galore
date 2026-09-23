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

export function useTheme() {
  // Read theme directly from localStorage on each render to avoid stale state
  const [theme, setTheme] = useState<ResolvedTheme>(() => {
    const stored = getStoredTheme();
    return resolveTheme(stored);
  });

  const setThemeValue = useCallback((value: ThemeValue) => {
    localStorage.setItem(STORAGE_KEY, value);
    setTheme(resolveTheme(value));
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

  // Sync DOM when theme changes
  useEffect(() => {
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
