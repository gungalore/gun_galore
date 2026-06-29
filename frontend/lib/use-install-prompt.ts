'use client';

import { useCallback, useEffect, useState } from 'react';

// Shared PWA-install state for the whole app.
//
// WHY a global + inline-script capture instead of a plain useEffect listener:
// Chrome fires `beforeinstallprompt` once the PWA is installable AND its
// engagement heuristic is satisfied — and that can happen BEFORE React
// hydrates. A useEffect listener mounts too late and misses the event, so the
// install button never appears. To fix the race, an inline <head> script (see
// INSTALL_CAPTURE_SCRIPT in app/layout.tsx) captures the event the instant it
// fires, stashes it on `window.__ggInstallEvent`, and dispatches a
// `gg:install-available` event. This hook hydrates from that global on mount
// and stays in sync via the custom events + `appinstalled`.
//
// IMPORTANT Android reality: there is NO way to open the install flow
// programmatically without that captured event. When it hasn't fired, the only
// path is the browser's own ⋮ menu → "Install app". So the manual entry point
// (nav drawer) falls back to showing those steps via `gg:show-install-help`.

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

declare global {
  interface Window {
    __ggInstallEvent?: BeforeInstallPromptEvent | null;
    __ggInstalled?: boolean;
  }
}

export interface InstallState {
  /** Native install prompt is captured and the app isn't installed yet. */
  canInstall: boolean;
  /** Best-effort: running standalone OR detected via getInstalledRelatedApps. */
  isInstalled: boolean;
  /** Running as the installed standalone app right now. */
  isStandalone: boolean;
  /** iOS Safari — no native prompt; must use manual Share → Add steps. */
  isIosSafari: boolean;
  /** Fire the native install dialog. Returns 'unavailable' if no event yet. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt(): InstallState {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);

  useEffect(() => {
    // 1) Hydrate from the early-capture global — covers the race where Chrome
    //    fired beforeinstallprompt before this component mounted.
    if (window.__ggInstalled) setIsInstalled(true);
    if (window.__ggInstallEvent) setEvent(window.__ggInstallEvent);

    // 2) Standalone launch = definitely installed.
    const standalone = detectStandalone();
    if (standalone) {
      setIsStandalone(true);
      setIsInstalled(true);
    }

    // 3) Best-effort "installed but currently browsing in a tab" check. While
    //    browsing in Chrome the display-mode is NOT standalone even if the PWA
    //    is installed; getInstalledRelatedApps reports the current web app on
    //    Android Chrome so we can suppress the nag.
    const nav = window.navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform: string }>>;
    };
    if (typeof nav.getInstalledRelatedApps === 'function') {
      nav
        .getInstalledRelatedApps()
        .then((apps) => {
          if (apps && apps.length > 0) setIsInstalled(true);
        })
        .catch(() => {
          /* not supported / blocked — fall back to the other signals */
        });
    }

    // 4) iOS Safari has no beforeinstallprompt — flag it for the manual hint.
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari && !standalone) setIsIosSafari(true);

    function onAvailable() {
      setEvent(window.__ggInstallEvent ?? null);
    }
    function onInstalled() {
      setEvent(null);
      setIsInstalled(true);
      setIsIosSafari(false);
    }
    window.addEventListener('gg:install-available', onAvailable);
    window.addEventListener('gg:installed', onInstalled);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('gg:install-available', onAvailable);
      window.removeEventListener('gg:installed', onInstalled);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    const e = event ?? (typeof window !== 'undefined' ? window.__ggInstallEvent : null) ?? null;
    if (!e) return 'unavailable';
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      // beforeinstallprompt is single-use — clear it; Chrome re-fires later if
      // the user dismissed.
      if (typeof window !== 'undefined') window.__ggInstallEvent = null;
      setEvent(null);
      if (outcome === 'accepted') setIsInstalled(true);
      return outcome;
    } catch {
      return 'unavailable';
    }
  }, [event]);

  return {
    canInstall: !!event && !isInstalled,
    isInstalled,
    isStandalone,
    isIosSafari,
    promptInstall,
  };
}
