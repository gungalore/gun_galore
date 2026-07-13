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
//   - Welcome greeting: Sparkie says hi and offers a hand ~3.5s after the user
//     lands on EVERY page (operator: greet every visit). Copy rotates so
//     repeat visits don't read robotically.
//   - Contextual nudges (W5.5): page-kind + dwell-time suggestions
//     ("want a fair-price check on this?"). Tapping opens the panel
//     with the question STAGED in the composer — never auto-sent.
//     Frequency caps live in lib/ask-gg-nudges.ts (1/session, 4h gap,
//     24h per kind). Hello and nudges never both fire on one page view,
//     and neither shows over the install-prompt card.
//
// Geometry unchanged from W3 (FAB z52; bubble rides above it; both
// lift via body[data-install-prompt] rules in globals.css).

// Sparkie greets on every page visit. Copy rotates so repeat visits don't read
// robotically — the first line does the full intro, the rest are short hellos.
const HELLO_TEXTS = [
  "Hey there 👋 I'm Sparkie. Can I help you find something or answer a question?",
  'Hi again 👋 Need a hand finding something?',
  "👋 I'm right here if you need anything — just give me a tap.",
  'Howzit! Looking for something specific? I can help.',
  'Need a hand or some advice? Tap me and ask 👋',
];

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
  // Advances through HELLO_TEXTS so each greeting varies.
  const greetIdxRef = useRef(0);
  const pathname = usePathname();

  // Welcome greeting — ~3.5s after landing on EVERY page (operator: greet each
  // visit), so Sparkie always says hello and stays present. The 3.5s dwell means
  // rapid click-throughs don't trigger it (the timer is cancelled on nav);
  // it fires once the visitor settles on a page. Skipped only while the panel
  // is open, the tab is hidden, the install card owns the screen, or the user
  // is mid-form.
  useEffect(() => {
    if (panelArmed) return;
    const t = window.setTimeout(() => {
      if (spentThisPageRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (document.body.hasAttribute('data-install-prompt')) return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      const text = HELLO_TEXTS[greetIdxRef.current % HELLO_TEXTS.length];
      greetIdxRef.current += 1;
      spentThisPageRef.current = true;
      setBubble({ kind: 'hello', text });
    }, 3500);
    return () => clearTimeout(t);
  }, [pathname, panelArmed]);

  // Contextual nudge — dwell-gated per page kind. pickNudge() owns all
  // frequency caps; this effect owns the moment (dwell, visible tab, corner
  // free, panel closed, nothing else shown this page view). The greeting
  // usually takes the slot first; a nudge fills in only when the greeting was
  // skipped (install card up, or the user was typing at 3.5s).
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
            'right-4 bottom-[calc(100px+env(safe-area-inset-bottom))]',
            // Desktop FAB is 160px tall (md:h-40) sitting 20px off the bottom,
            // so the bubble clears its top (180px) with an 8px gap.
            'md:right-6 md:bottom-[188px]',
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
          // No button chrome — Sparkie IS the launcher. The box is just his
          // hit area; he floats inside it. Doubled on desktop (80px → 160px)
          // per operator; mobile stays 80px.
          'right-4 w-20 h-20 md:w-40 md:h-40',
          'bottom-[calc(12px+env(safe-area-inset-bottom))]',
          'md:right-6 md:bottom-5',
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
        {/* Just the character now. Grins while he's talking. `fill` lets him
            scale with the responsive box (80px mobile → 160px desktop). */}
        <AskGgMascot alive fill mood={bubble ? 'happy' : 'idle'} />
      </button>
    </>
  );
}
