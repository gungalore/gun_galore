'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AskGgMascot } from './ask-gg-mascot';
import {
  pickNudge,
  markNudgeShown,
  type AskGgNudge,
} from '@/lib/ask-gg-nudges';

// Ask GG Everywhere — the floating launcher (FAB) + Sparkie's voice.
//
// ALWAYS-LOADED: this file may import only react, next/navigation,
// './ask-gg-mascot' and '@/lib/ask-gg-nudges' (bundle rule — the panel
// chunk carries everything heavy). Rendered by AskGgHost on every
// non-suppressed page in BROWSER modes only.
//
// ONE bubble, two brains:
//   - Daily hello: one dismissible greeting per day, 6s after load.
//   - Contextual nudges (W5.5): page-kind + dwell-time suggestions
//     ("want a fair-price check on this?"). Tapping opens the panel
//     with the question STAGED in the composer — never auto-sent.
//     Frequency caps live in lib/ask-gg-nudges.ts (1/session, 4h gap,
//     24h per kind). Hello and nudges never both fire on one page view,
//     and neither shows over the install-prompt card.
//
// Geometry unchanged from W3 (FAB z52; bubble rides above it; both
// lift via body[data-install-prompt] rules in globals.css).

const HELLO_KEY = 'gg_askgg_hello_on';
const HELLO_TEXT =
  "Howzit! I'm Ask GG — ask me anything about gear, your orders or how the site works.";

interface Bubble {
  text: string;
  /** Composer prefill when tapped (nudges); hello just opens. */
  prefill?: string;
  kind: 'hello' | AskGgNudge['kind'];
}

export function AskGgLauncher({
  onOpen,
  panelArmed,
}: {
  /** Opens the panel; optional prefill lands in the composer. */
  onOpen: (prefill?: string) => void;
  panelArmed: boolean;
}) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  // One bubble per page view — hello and nudge never stack.
  const spentThisPageRef = useRef(false);

  // Daily hello — 6s after load, skipped if the panel was already used
  // this session or the install card owns the corner. The day is spent
  // the moment it shows.
  useEffect(() => {
    if (panelArmed) return;
    let today: string;
    try {
      today = new Date().toDateString();
      if (localStorage.getItem(HELLO_KEY) === today) return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => {
      if (spentThisPageRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (document.body.hasAttribute('data-install-prompt')) return;
      try {
        localStorage.setItem(HELLO_KEY, today);
      } catch {
        /* still greet this once */
      }
      spentThisPageRef.current = true;
      setBubble({ kind: 'hello', text: HELLO_TEXT });
    }, 6000);
    return () => clearTimeout(t);
  }, [panelArmed]);

  // Contextual nudge — dwell-gated per page kind. pickNudge() owns all
  // frequency caps; this effect owns the moment (dwell, visible tab,
  // corner free, panel closed, nothing else shown this page view).
  const pathname = usePathname();
  useEffect(() => {
    if (panelArmed) return;
    const nudge = pickNudge(pathname);
    if (!nudge) return;
    const t = window.setTimeout(() => {
      if (spentThisPageRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (document.body.hasAttribute('data-install-prompt')) return;
      // Don't talk over someone mid-form (composer, search, checkout inputs).
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      markNudgeShown(nudge.kind);
      spentThisPageRef.current = true;
      setBubble({ kind: nudge.kind, text: nudge.text, prefill: nudge.prefill });
    }, nudge.delayMs);
    return () => clearTimeout(t);
  }, [pathname, panelArmed]);

  // Reset the per-page-view guard + drop any visible bubble on nav.
  useEffect(() => {
    spentThisPageRef.current = false;
    setBubble(null);
  }, [pathname]);

  // Auto-hide after 14s; stand down when the panel opens via any entry.
  useEffect(() => {
    if (panelArmed) {
      setBubble(null);
      return;
    }
    if (!bubble) return;
    const t = window.setTimeout(() => setBubble(null), 14_000);
    return () => clearTimeout(t);
  }, [bubble, panelArmed]);

  const open = (prefill?: string) => {
    setBubble(null);
    onOpen(prefill);
  };

  return (
    <>
      {bubble && (
        <div
          id="askgg-hello"
          role="status"
          className={[
            'gg-hello app-chrome fixed z-[52] flex items-start gap-1',
            'right-4 bottom-[calc(80px+env(safe-area-inset-bottom))]',
            'md:right-6 md:bottom-[86px]',
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
            onClick={() => open(bubble.prefill)}
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
            {bubble.text}
          </button>
          <button
            type="button"
            aria-label="Dismiss suggestion"
            onClick={() => setBubble(null)}
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
        onClick={() => open()}
        aria-label="Open Ask GG — your Gun Galore assistant"
        className={[
          'app-chrome fixed z-[52]',
          'flex items-center justify-center',
          // No button chrome — Sparkie IS the launcher. The 56px box is
          // just his hit area (a comfortable ≥44px tap target); he floats
          // inside it, same corner on mobile + desktop.
          'right-4 w-14 h-14',
          'bottom-[calc(16px+env(safe-area-inset-bottom))]',
          'md:right-6 md:bottom-6',
        ].join(' ')}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          // Soft shadow so the character reads as a floating spark against
          // any page background, with nothing behind him.
          filter: 'drop-shadow(0 3px 9px rgba(0,0,0,0.55))',
        }}
      >
        {/* Just the character now. Grins while he's talking. */}
        <AskGgMascot alive size={56} mood={bubble ? 'happy' : 'idle'} />
      </button>
    </>
  );
}
