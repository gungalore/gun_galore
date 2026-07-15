'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AskGgMascot } from './ask-gg-mascot';
import {
  pickNudge,
  markNudgeShown,
  type AskGgNudge,
} from '@/lib/ask-gg-nudges';
import { useGgMuted } from '@/lib/ask-gg-mute';
import { derivePageContext } from '@/lib/ask-gg-context';

// Ask GG Everywhere — the floating launcher (mascot) + GG's proactive voice.
//
// ALWAYS-LOADED: this file may import only react, next/navigation,
// './ask-gg-mascot', '@/lib/ask-gg-nudges', '@/lib/ask-gg-mute' and
// '@/lib/ask-gg-context' (all lean — the panel chunk carries everything
// heavy). Rendered by AskGgHost on every non-suppressed page in BROWSER modes.
//
// ONE proactive bubble per page — useful-first (site-guide G1 + G3):
//   - G3 (state-aware): on a listing page GG fetches the server Guide's LIVE
//     intro ($0 AI) — e.g. an auction's "Current bid R… · reserve met · ends
//     in Xh" — and leads with THAT, tapping opens the Guide tab. The fetch
//     runs in parallel with the dwell so it's ready in time; misses fall back.
//   - Otherwise this page-kind's static coaching tip ("want a fair-price
//     check?"), tapping stages the question in the composer — never auto-sent,
//     so no AI quota is spent until the user chooses to ask.
//   - Otherwise a short rotating hello, so he still greets on generic pages.
//     Frequency lives in lib/ask-gg-nudges.ts (once per kind/session).
//   - MUTE (lib/ask-gg-mute, permanent): while muted GG says nothing at all —
//     no coaching, no hello — but stays fully tappable. Toggled by the small
//     speaker button at his ~4 o'clock.
//   - Never over the install-prompt card, tab hidden, panel open, or mid-form.
//
// Geometry: a fixed #askgg-dock wraps the mascot (#askgg-fab) + mute button;
// the bubble rides above it; dock + bubble lift via body[data-install-prompt]
// rules in globals.css.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// The assistant (GG) greets on every page visit. Copy rotates so repeat visits
// don't read robotically — the first line does the full intro (name matches the
// "Ask GG" branding), the rest are short hellos.
const HELLO_TEXTS = [
  "Hey there 👋 I'm GG, your Gun Galore assistant. Can I help you find something?",
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
  // Permanent mute (localStorage). While muted GG says nothing proactively.
  const [muted, setMuted] = useGgMuted();

  // ONE proactive "speak" per page — useful-first. After a short dwell GG
  // shows this page-kind's contextual coaching tip (if there is one and it
  // hasn't been shown this session); otherwise a rotating hello, so he still
  // greets on generic pages. Muted → silent. Guards: panel closed, tab
  // visible, install card down, not mid-form. The 3.5–4.2s dwell means rapid
  // click-throughs (timer cancelled on nav) never trigger it.
  useEffect(() => {
    if (panelArmed || muted) return;
    const coach = pickNudge(pathname);
    const { kind, ctx } = derivePageContext(pathname);

    // G3 — on a listing page whose kind slot is still free, fetch the server
    // Guide's LIVE intro ($0 AI) in parallel with the dwell. Only auctions (and
    // other state-aware guides) return an intro; everything else stays null and
    // falls back to the static tip. At most one fetch per session (the kind
    // cap closes after the first listing bubble). Resolves into a dead closure
    // harmlessly if the user navigates first.
    let liveIntro: string | null = null;
    if (coach && kind === 'listing' && ctx.listingId) {
      const qs = new URLSearchParams({ path: pathname ?? '/' });
      qs.set('listingId', ctx.listingId);
      fetch(`${API_URL}/ask-gg/public/guide?${qs.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((g: { intro?: string } | null) => {
          liveIntro = typeof g?.intro === 'string' ? g.intro : null;
        })
        .catch(() => {
          /* offline / throttled — fall back to the static tip */
        });
    }

    const t = window.setTimeout(
      () => {
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
        spentThisPageRef.current = true;
        if (liveIntro) {
          // Live, state-aware tip → tapping (no prefill) opens the Guide tab.
          markNudgeShown(kind);
          setBubble({ kind, text: `${liveIntro} Tap me for the guide 👇` });
        } else if (coach) {
          markNudgeShown(coach.kind);
          setBubble({
            kind: coach.kind,
            text: coach.text,
            prefill: coach.prefill,
          });
        } else {
          const text = HELLO_TEXTS[greetIdxRef.current % HELLO_TEXTS.length];
          greetIdxRef.current += 1;
          setBubble({ kind: 'hello', text });
        }
      },
      coach ? 4200 : 3500,
    );
    return () => clearTimeout(t);
  }, [pathname, panelArmed, muted]);

  // Reset the per-page-view guard + drop any visible bubble on nav.
  useEffect(() => {
    spentThisPageRef.current = false;
    setBubble(null);
  }, [pathname]);

  // Auto-hide after 14s; stand down when the panel opens or GG is muted.
  useEffect(() => {
    if (panelArmed || muted) {
      setBubble(null);
      return;
    }
    if (!bubble) return;
    const t = window.setTimeout(() => setBubble(null), 14_000);
    return () => clearTimeout(t);
  }, [bubble, panelArmed, muted]);

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
      <div
        id="askgg-dock"
        className={[
          'app-chrome fixed z-[52]',
          // No button chrome — GG IS the launcher. This box is his hit area;
          // he floats inside it. Doubled on desktop (80px → 160px) per
          // operator; mobile stays 80px. The mute button rides his ~4 o'clock.
          'right-4 w-20 h-20 md:w-40 md:h-40',
          'bottom-[calc(12px+env(safe-area-inset-bottom))]',
          'md:right-6 md:bottom-5',
        ].join(' ')}
      >
        <button
          type="button"
          id="askgg-fab"
          onClick={() => open()}
          aria-label="Open Ask GG — your Gun Galore assistant"
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            // Soft shadow so the character reads as a floating spark against
            // any page background, with nothing behind him.
            filter: 'drop-shadow(0 3px 9px rgba(0,0,0,0.55))',
            // Calm + slightly dimmed while muted.
            opacity: muted ? 0.9 : 1,
          }}
        >
          {/* Just the character. Grins while he's talking; still + calm (no
              idle wiggles) while muted. `fill` scales him to the responsive
              box (80px mobile → 160px desktop). */}
          <AskGgMascot alive={!muted} fill mood={bubble ? 'happy' : 'idle'} />
        </button>
        {/* Mute toggle at GG's ~4 o'clock — the clear way to shut him up.
            Permanent (localStorage) until unmuted. stopPropagation so tapping
            it never opens the panel. */}
        <button
          type="button"
          id="askgg-mute"
          onClick={(e) => {
            e.stopPropagation();
            const next = !muted;
            setMuted(next);
            if (next) setBubble(null);
          }}
          aria-label={muted ? 'Unmute GG' : 'Mute GG'}
          aria-pressed={muted}
          title={muted ? 'Unmute GG' : 'Mute GG'}
          className={[
            'absolute flex items-center justify-center rounded-full',
            'w-6 h-6 md:w-8 md:h-8',
            'right-[2px] bottom-[10px] md:right-[6px] md:bottom-[24px]',
          ].join(' ')}
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
            color: muted ? 'var(--red)' : 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 0,
            lineHeight: 0,
          }}
        >
          {muted ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M19 5a9 9 0 0 1 0 14" />
            </svg>
          )}
        </button>
      </div>
    </>
  );
}
