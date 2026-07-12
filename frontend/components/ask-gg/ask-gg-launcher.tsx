'use client';

import { IconSparkles } from './icons';

// Ask GG Everywhere — the floating launcher (FAB).
//
// ALWAYS-LOADED: this file may import only react + './icons' (bundle
// rule — the panel chunk carries everything heavy). Rendered by
// AskGgHost on every non-suppressed page in BROWSER modes only
// (standalone PWA uses the bottom-tab entry instead — W4).
//
// Geometry (locked in the approved plan):
//   desktop ≥md — pill with label, right/bottom 24px
//   mobile  <md — 48px icon circle, right 16px,
//                 bottom calc(16px + env(safe-area-inset-bottom))
//   z-index 52 — above content/sticky-strip(50)/nav(50), below the
//   PWA tab bar(55), sheets(56) and drawers(70+).
// Reuses the existing .ask-gg-lure pulsing-glow class from the nav pill.

export function AskGgLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      id="askgg-fab"
      onClick={onOpen}
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
      <IconSparkles />
      <span
        className="hidden md:inline"
        style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        Ask GG
      </span>
    </button>
  );
}
