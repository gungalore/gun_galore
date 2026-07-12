'use client';

import { useEffect, useState } from 'react';
import { AskGgMascot } from './ask-gg-mascot';

// Ask GG Everywhere — the floating launcher (FAB), now with Sparkie.
//
// ALWAYS-LOADED: this file may import only react + './ask-gg-mascot'
// (bundle rule — the panel chunk carries everything heavy). Rendered by
// AskGgHost on every non-suppressed page in BROWSER modes only
// (standalone PWA uses the bottom-tab entry instead — W6).
//
// Geometry (locked in the approved plan):
//   desktop ≥md — pill with label, right/bottom 24px
//   mobile  <md — 48px icon circle, right 16px,
//                 bottom calc(16px + env(safe-area-inset-bottom))
//   z-index 52 — above content/sticky-strip(50)/nav(50), below the
//   PWA tab bar(55), sheets(56) and drawers(70+).
// While the install-prompt card owns the corner, globals.css lifts
// #askgg-fab (and #askgg-hello) via body[data-install-prompt].
//
// Daily hello (operator pick 2026-07-12, "idle life + daily hello"):
// ONE dismissible speech bubble per day, 6s after page load — skipped
// if the panel was already opened this session or the install card is
// showing. The day is spent the moment the bubble shows, even if it's
// ignored. It never opens the panel by itself.

const HELLO_KEY = 'gg_askgg_hello_on';
const HELLO_TEXT =
  "Howzit! I'm Ask GG — ask me anything about gear, your orders or how the site works.";

export function AskGgLauncher({
  onOpen,
  panelArmed,
}: {
  onOpen: () => void;
  panelArmed: boolean;
}) {
  const [hello, setHello] = useState(false);

  useEffect(() => {
    if (panelArmed) return;
    let today: string;
    try {
      today = new Date().toDateString();
      if (localStorage.getItem(HELLO_KEY) === today) return;
    } catch {
      return; // storage unavailable → never greet rather than greet every visit
    }
    const t = window.setTimeout(() => {
      if (document.body.hasAttribute('data-install-prompt')) return;
      try {
        localStorage.setItem(HELLO_KEY, today);
      } catch {
        /* still greet this once */
      }
      setHello(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [panelArmed]);

  // Auto-hide, and stand down if the panel opens through any entry.
  useEffect(() => {
    if (panelArmed) {
      setHello(false);
      return;
    }
    if (!hello) return;
    const t = window.setTimeout(() => setHello(false), 12_000);
    return () => clearTimeout(t);
  }, [hello, panelArmed]);

  const open = () => {
    setHello(false);
    onOpen();
  };

  return (
    <>
      {hello && (
        <div
          id="askgg-hello"
          role="status"
          className={[
            'gg-hello app-chrome fixed z-[52] flex items-start gap-1',
            'right-4 bottom-[calc(72px+env(safe-area-inset-bottom))]',
            'md:right-6 md:bottom-[76px]',
          ].join(' ')}
          style={{
            maxWidth: 250,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: '12px 12px 2px 12px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            padding: '10px 8px 10px 12px',
          }}
        >
          <button
            type="button"
            onClick={open}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 13,
              lineHeight: 1.45,
              color: 'var(--text-primary)',
            }}
          >
            {HELLO_TEXT}
          </button>
          <button
            type="button"
            aria-label="Dismiss greeting"
            onClick={() => setHello(false)}
            style={{
              background: 'none',
              border: 'none',
              padding: '0 2px',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              color: 'var(--text-tertiary)',
            }}
          >
            ×
          </button>
        </div>
      )}
      <button
        type="button"
        id="askgg-fab"
        onClick={open}
        aria-label="Open Ask GG — your Gun Galore assistant"
        className={[
          'ask-gg-lure app-chrome fixed z-[52]',
          'flex items-center justify-center gap-2',
          // Mobile: 48px circle hugging the safe area.
          'right-4 w-12 h-12',
          'bottom-[calc(16px+env(safe-area-inset-bottom))]',
          // Desktop: labelled pill at 24/24.
          'md:right-6 md:bottom-6 md:w-auto md:h-11 md:px-4',
        ].join(' ')}
        style={{
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          borderRadius: 999,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        }}
      >
        <AskGgMascot alive size={26} />
        <span
          className="hidden md:inline"
          style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          Ask GG
        </span>
      </button>
    </>
  );
}
