'use client';

import { useEffect, useState } from 'react';

// Floating "Install Gun Galore" button. Listens for the browser's
// beforeinstallprompt event (Chrome / Edge / Samsung / Opera on
// Android + desktop) and surfaces a styled CTA the user can click to
// trigger the native install dialog.
//
// Three reasons we DON'T auto-fire the prompt:
//   1. Browser engagement heuristics will skip it if the user just
//      landed; we'd be calling .prompt() and getting a NotAllowedError.
//   2. A surprise modal interrupts whatever the user came to do.
//   3. Once dismissed, the event won't fire again in the same session.
//
// Dismissal logic: clicking the X (or denying in the native dialog)
// hides the button for 14 days via localStorage. Re-appears after
// that window if the user is still uninstalled.
//
// iOS Safari does NOT fire beforeinstallprompt — it has no
// programmatic install API. For iOS we show a one-off instruction
// hint: "Tap Share, then Add to Home Screen." Only shown if the
// device is iOS Safari and not already in standalone mode.

const DISMISSED_KEY = 'gg-install-prompt-dismissed-until';
const DISMISS_DAYS = 14;

// Match the BeforeInstallPromptEvent surface we actually use.
// TypeScript's lib.dom doesn't ship a type for this yet (still a
// W3C draft), so we narrow our own.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [iosHintOpen, setIosHintOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Skip everything if dismissal is still active.
    if (isDismissedRecently()) return;

    // Skip if already installed (running in standalone mode).
    if (typeof window !== 'undefined') {
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        // Safari-specific signal.
        (window.navigator as { standalone?: boolean }).standalone === true;
      if (isStandalone) return;
    }

    // Android / desktop install path.
    function onBeforeInstall(e: Event) {
      // Block Chrome's default mini-infobar — we render our own UI.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS Safari detection (no beforeinstallprompt support).
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) setIsIosSafari(true);

    // Clear the dismissed flag if the user installs through any path —
    // appinstalled fires once installation completes.
    function onInstalled() {
      setDeferred(null);
      setIsIosSafari(false);
      try {
        localStorage.removeItem(DISMISSED_KEY);
      } catch {
        // localStorage may be blocked in private modes — ignore.
      }
    }
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'dismissed') {
        dismissFor(DISMISS_DAYS);
      }
    } finally {
      // Prompt can only fire once per event — clear either way.
      setDeferred(null);
      setBusy(false);
    }
  }

  function dismissFloating() {
    setDeferred(null);
    setIsIosSafari(false);
    setIosHintOpen(false);
    dismissFor(DISMISS_DAYS);
  }

  // Nothing to show: not installable in this browser yet, or user
  // already dismissed.
  if (!deferred && !isIosSafari) return null;

  return (
    <>
      <div
        role="dialog"
        aria-label="Install Gun Galore"
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 60,
          maxWidth: 320,
          padding: '12px 14px',
          borderRadius: 8,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          boxShadow:
            '0 10px 32px rgba(0,0,0,0.45), 0 0 12px rgba(200,16,46,0.22)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-primary)',
              fontWeight: 500,
              marginBottom: 2,
            }}
          >
            Install Gun Galore
          </p>
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              lineHeight: 1.4,
            }}
          >
            Faster repeat visits, home-screen icon, fullscreen launch.
          </p>
        </div>
        {deferred ? (
          <button
            type="button"
            onClick={install}
            disabled={busy}
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {busy ? 'Opening…' : 'Install'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIosHintOpen(true)}
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            How
          </button>
        )}
        <button
          type="button"
          onClick={dismissFloating}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            color: 'var(--text-tertiary)',
            border: 'none',
            padding: 4,
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      {/* iOS instruction modal — Safari can't trigger install
          programmatically, so the user has to do it themselves. We
          render a one-time hint with the actual gesture spelled out. */}
      {iosHintOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setIosHintOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 61,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 380,
              width: '100%',
              padding: 20,
              borderRadius: 12,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <p
              style={{
                fontSize: 15,
                fontWeight: 500,
                marginBottom: 12,
              }}
            >
              Add Gun Galore to your home screen
            </p>
            <ol
              style={{
                paddingLeft: 18,
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <li>
                Tap the <strong style={{ color: 'var(--text-primary)' }}>Share</strong> icon
                at the bottom of Safari (the square with the up-arrow).
              </li>
              <li>
                Scroll down and tap{' '}
                <strong style={{ color: 'var(--text-primary)' }}>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong style={{ color: 'var(--text-primary)' }}>Add</strong> in the top
                right. The Gun Galore icon will appear on your home
                screen.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setIosHintOpen(false)}
              style={{
                marginTop: 16,
                width: '100%',
                background: 'var(--red)',
                color: '#fff',
                border: 'none',
                padding: '10px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Dismissal helpers (localStorage with safe fallbacks) ──────────

function dismissFor(days: number) {
  try {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISSED_KEY, String(until));
  } catch {
    // localStorage blocked in private mode — accept that the prompt
    // may re-show this session. Not the end of the world.
  }
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}
