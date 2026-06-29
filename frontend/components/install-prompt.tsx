'use client';

import { useEffect, useState } from 'react';
import { InstallAnimation } from './install-animation';
import { useInstallPrompt } from '@/lib/use-install-prompt';

// Floating "Install Gun Galore" CTA + the shared install-help modal.
//
// Install state (native event capture, installed-detection, iOS) lives in
// useInstallPrompt() so the nav drawer's manual "Install app" button shares it.
// This component owns the proactive floating nudge and the instruction modal.
//
// We DON'T auto-fire the native prompt:
//   1. Chrome's engagement heuristic will reject .prompt() right after landing.
//   2. A surprise modal interrupts whatever the user came to do.
//   3. The event is single-use; once consumed it won't re-fire this session.
//
// The instruction modal is also opened on demand from the nav via the
// `gg:show-install-help` window event — for when Chrome hasn't fired
// beforeinstallprompt yet (the only install path then is the browser's own
// ⋮ menu, which we can only explain, not trigger) or on iOS Safari.
//
// Dismissing the floating CTA hides it for 14 days (localStorage).

const DISMISSED_KEY = 'gg-install-prompt-dismissed-until';
const DISMISS_DAYS = 14;

export function InstallPrompt() {
  const { canInstall, isInstalled, isIosSafari, promptInstall } =
    useInstallPrompt();
  const [dismissed, setDismissed] = useState(true); // assume dismissed until effect checks
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fallback nudge for phones where the one-tap install is never offered
  // (non-Chrome browsers, bottom-tier Android Go devices, etc.). We arm it
  // after a short delay so capable phones get the real "Install" button once
  // Chrome fires its event — only phones that never fire it fall through to the
  // "Add to home screen" shortcut hint.
  const [isMobile, setIsMobile] = useState(false);
  const [fallbackArmed, setFallbackArmed] = useState(false);

  useEffect(() => {
    setDismissed(isDismissedRecently());
    const mobile = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(
      navigator.userAgent,
    );
    setIsMobile(mobile);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (mobile) timer = setTimeout(() => setFallbackArmed(true), 5000);
    // The nav's "Install app" button (and any other surface) can ask us to
    // pop the instruction modal — e.g. iOS, or Android before Chrome has fired
    // the install event.
    function onShowHelp() {
      setHelpOpen(true);
    }
    window.addEventListener('gg:show-install-help', onShowHelp);
    return () => {
      window.removeEventListener('gg:show-install-help', onShowHelp);
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function install() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'dismissed') dismissFor(DISMISS_DAYS);
      // If the native event wasn't ready, fall back to the steps modal.
      if (outcome === 'unavailable') setHelpOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function dismissFloating() {
    setDismissed(true);
    dismissFor(DISMISS_DAYS);
  }

  // Once armed, if the one-tap install still isn't available and it's not iOS,
  // show the "Add to home screen" shortcut nudge instead (low-end / non-Chrome).
  const showFallbackHint =
    fallbackArmed && isMobile && !canInstall && !isIosSafari && !isInstalled;

  // The floating CTA shows only when there's an actionable path and the user
  // hasn't dismissed it / already installed.
  const showFloating =
    !isInstalled && !dismissed && (canInstall || isIosSafari || showFallbackHint);

  // Copy adapts to the path: real install vs. shortcut fallback.
  const title = canInstall ? 'Install Gun Galore' : 'Add to home screen';
  const subtitle = canInstall
    ? 'Faster repeat visits, home-screen icon, fullscreen launch.'
    : 'Get a Gun Galore icon on your home screen.';

  if (!showFloating && !helpOpen) return null;

  return (
    <>
      {showFloating && (
        <div
          role="dialog"
          aria-label={title}
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
              {title}
            </p>
            <p
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          </div>
          {canInstall ? (
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
              onClick={() => setHelpOpen(true)}
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
              {isIosSafari ? 'How' : 'Add'}
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
      )}

      {helpOpen && (
        <InstallHelpModal
          isIos={isIosSafari}
          canInstall={canInstall}
          onInstall={async () => {
            const outcome = await promptInstall();
            if (outcome !== 'unavailable') setHelpOpen(false);
          }}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  );
}

// Instruction modal. On iOS shows the animated Safari Share → Add walkthrough;
// elsewhere shows the Android/desktop "browser menu → Install app" steps. If a
// native prompt is available it offers the one-tap Install button too.
function InstallHelpModal({
  isIos,
  canInstall,
  onInstall,
  onClose,
}: {
  isIos: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How to install Gun Galore"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 61,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        overflowY: 'auto',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          width: '100%',
          padding: 16,
          borderRadius: 14,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxHeight: 'calc(100dvh - 24px)',
        }}
      >
        {isIos ? (
          <>
            <div
              style={{
                width: '100%',
                aspectRatio: '9 / 16',
                maxHeight: '62dvh',
                margin: '0 auto',
              }}
            >
              <InstallAnimation />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                Add Gun Galore to your home screen
              </p>
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                In Safari: tap <strong>Share</strong> (the box with an arrow) →
                <strong> Add to Home Screen</strong> → <strong>Add</strong>.
              </p>
            </div>
          </>
        ) : (
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              {canInstall
                ? 'Install the Gun Galore app'
                : 'Add Gun Galore to your home screen'}
            </p>
            {canInstall ? (
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: '0 0 4px',
                }}
              >
                Tap <strong>Install</strong> below to add Gun Galore to your home
                screen.
              </p>
            ) : (
              <>
                <ol
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    margin: 0,
                    paddingLeft: 18,
                  }}
                >
                  <li>
                    Open your browser&rsquo;s menu — the <strong>⋮</strong> (or
                    <strong> ⋯</strong>) icon, usually top-right.
                  </li>
                  <li>
                    Tap <strong>Add to Home screen</strong> (or{' '}
                    <strong>Install app</strong> if you see it).
                  </li>
                  <li>
                    Confirm <strong>Add</strong>.
                  </li>
                </ol>
                <p
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-tertiary)',
                    lineHeight: 1.5,
                    margin: '8px 0 0',
                  }}
                >
                  On some phones only &ldquo;Add to Home screen&rdquo; is
                  available — that still puts a Gun Galore icon on your home
                  screen; it just opens in your browser.
                </p>
              </>
            )}
          </div>
        )}

        {!isIos && canInstall && (
          <button
            type="button"
            onClick={onInstall}
            style={{
              width: '100%',
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '11px 14px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            background: !isIos && canInstall ? 'transparent' : 'var(--red)',
            color: !isIos && canInstall ? 'var(--text-secondary)' : '#fff',
            border: !isIos && canInstall ? '0.5px solid var(--border)' : 'none',
            padding: '11px 14px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {!isIos && canInstall ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  );
}

// ─── Dismissal helpers (localStorage with safe fallbacks) ──────────

function dismissFor(days: number) {
  try {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISSED_KEY, String(until));
  } catch {
    // localStorage blocked in private mode — accept the prompt may re-show.
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
