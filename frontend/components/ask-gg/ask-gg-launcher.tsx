'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AskGgMascot, type BoetScene } from './ask-gg-mascot';
import {
  pickNudge,
  markNudgeShown,
  type AskGgNudge,
} from '@/lib/ask-gg-nudges';
import { useGgMuted } from '@/lib/ask-gg-mute';
import { derivePageContext } from '@/lib/ask-gg-context';

// Ask Boet Everywhere — the floating launcher (Boet the safari ranger) +
// his proactive voice.
//
// ALWAYS-LOADED: this file may import only react, next/navigation,
// './ask-gg-mascot', '@/lib/ask-gg-nudges', '@/lib/ask-gg-mute' and
// '@/lib/ask-gg-context' (all lean — the panel chunk carries everything
// heavy). Rendered by AskGgHost on every non-suppressed page in BROWSER modes.
//
// Boet lives in the bottom-right corner (the design's 210px). He WANDERS
// on his own — idles a few seconds, plays one of eight activity scenes
// (wave / binoculars / campfire / tent / fishing / knife / map / drive), back
// to idle, forever — all in-character (the scenes live in his SVG). Tapping him
// opens the chat. His eyes follow the cursor.
//
// There is no shooting scene, and there must not be one: this rotation runs on
// every public page for signed-out visitors. See ask-gg-mascot.tsx.
//
// ONE proactive bubble per page — useful-first (site-guide G1 + G3):
//   - G3 (state-aware): on a listing page Boet fetches the server Guide's
//     LIVE intro ($0 AI) and leads with THAT; tapping opens the Guide tab.
//   - Otherwise this page-kind's static coaching tip; tapping stages the
//     question in the composer — never auto-sent, so no AI quota is spent.
//   - Otherwise a short rotating hello.
//   - MUTE (permanent): while muted Boet says nothing — but stays tappable
//     and stops wandering (calm idle). Toggled by the speaker button.
//   - Never over the install-prompt card, tab hidden, panel open, or mid-form.
//
// Geometry: a fixed #askgg-dock (flex column) holds the bubble above Boet.
// body[data-install-prompt] no longer lifts the dock (the install prompt is a
// centred z-1000 modal now, not a corner card) but it IS still read below to
// keep Boet quiet while that modal is up.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Boet greets on every page visit. Copy rotates so repeat visits don't read
// robotically — the first line does the full intro, the rest are short
// hellos in his voice.
const HELLO_TEXTS = [
  "Howzit 👋 I'm Boet, your All Outdoor guide. Can I help you find something?",
  'Hi again 👋 Need a hand finding something?',
  "👋 I'm right here if you need anything — just give me a tap.",
  'Howzit! Looking for something specific? I can help.',
  'Need a hand or some advice? Tap me and ask 👋',
];

// Dry SA one-liners (operator-approved set, 2026-07-20). Boet cracks one
// now and then instead of a plain hello, and sometimes as the linger
// prompt. HOUSE RULE: keep them wholesome outdoor/braai/camp humour —
// NEVER firearm jokes on this platform. Tapping the bubble still opens
// the chat, so a joke is also an invitation.
const JOKES = [
  'What do you call a buck with no eyes? No-eye-deer. …I’ll see myself out.',
  'I’d tell you my camping joke, but it’s in tents.',
  'Braai forecast: 100% chance of someone telling you you’re doing it wrong.',
  'Biltong is just steak that learned patience.',
  'My bakkie and I have a deal — it doesn’t start, and I stay calm. Mostly.',
  'Fish swim in schools. Some of them still never learn.',
  '‘Now-now’ is a precise unit of time. Somewhere between now and never.',
  'Load shedding taught me more about camping than camping ever did.',
  'Rain on the tent isn’t a leak, boet. It’s character building.',
  'I asked my compass for life advice. It just pointed me somewhere else.',
  'A skottel is just a braai in a hurry. We don’t judge. Much.',
  'The veld is lekker quiet this time of year. Unlike my neighbour’s generator.',
];

// Linger prompt — the user's been parked on one page a while; Boet checks
// in. Dry, not needy. A tap opens the chat.
const LINGER_TEXTS = [
  'You’ve been here a while, boet. Need a hand?',
  'Still looking? Tap me and I’ll help you find it.',
  'Ag, don’t scroll alone — ask me anything.',
];

// How long someone sits on one page before Boet offers help (ms), and the
// share of linger prompts he swaps for a joke instead.
const LINGER_AFTER_MS = 60_000;
const LINGER_JOKE_CHANCE = 0.3;
// Share of generic-page greetings that become a joke instead of a hello.
const HELLO_JOKE_CHANCE = 0.25;

// Activity scenes Boet wanders through (everything but idle). The launcher
// alternates idle → one of these → idle.
const ACTIVITIES: BoetScene[] = [
  'wave',
  'binoculars',
  'campfire',
  'tent',
  'fishing',
  'knife',
  'map',
  'drive',
];

interface Bubble {
  text: string;
  /** Composer prefill when tapped (nudges); hello just opens. */
  prefill?: string;
  kind: 'hello' | AskGgNudge['kind'];
}

// The dock used to sit at z-52, i.e. UNDER the installed-app bottom tab bar
// (z-55) — the house rule is that anything floating must be z >= 60 or the
// bar clips it. AskGgHost only mounts the launcher in browser modes, but
// useStandalone() resolves after hydration, so an installed PWA still paints
// one frame with Boet standing on the tab bar. He is now z-60; these two
// rules are what make that promotion safe, and they live here rather than in
// globals.css because they only make sense next to the z they are correcting:
//
//   1. In standalone, lift the dock a full tab-bar height so it clears the
//      bar GEOMETRICALLY, not just in paint order. (Mutually exclusive with
//      the buy-bar lift on the listing page, which is scoped to
//      :not([data-standalone]).)
//   2. At z-60 Boet now ties with the modal tier and wins on DOM order,
//      because the host is the last thing in <body>. Stand down while a
//      blocking overlay is up. `data-blocking-overlay` is the attribute the
//      auction BidModal already sets for the listing page's buy bar; any new
//      full-screen overlay that shares this corner should set it too.
const DOCK_STACKING_CSS = [
  `html[data-standalone='true'] #askgg-dock{bottom:calc(70px + env(safe-area-inset-bottom));}`,
  `body:has([data-blocking-overlay]) #askgg-dock{display:none;}`,
].join('');

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
  // Permanent mute (localStorage). While muted Boet says nothing proactively.
  const [muted, setMuted] = useGgMuted();

  // Minimized (localStorage): Boet collapses to a compact "✨ Ask Boet" pill
  // in the same corner — for users who find him in the way. The pill still
  // opens the chat; a small restore control brings him back. While minimized
  // no bubbles or scenes fire. Hydrated in an effect so SSR stays deterministic.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    try {
      setMinimized(localStorage.getItem('gg-mascot-minimized') === '1');
    } catch {
      /* private mode etc. — stay expanded */
    }
  }, []);
  const applyMinimized = (next: boolean) => {
    setMinimized(next);
    try {
      localStorage.setItem('gg-mascot-minimized', next ? '1' : '0');
    } catch {
      /* non-fatal */
    }
  };

  // ── Occasional activity (calm cadence) ───────────────────────────
  // Boet mostly just stands there breathing/blinking. Every ~30–60s of
  // idle he plays ONE ~4s activity scene, then settles again — punctuation,
  // not a show (operator dialed the original constant wandering down,
  // 2026-07-20). Never while the panel's open, muted, minimized, tab
  // hidden, or reduced-motion (he just idles). The launcher lives in the
  // root layout, so the cadence survives navigation instead of resetting
  // per page.
  const [scene, setScene] = useState<BoetScene>('idle');
  const sceneRef = useRef<BoetScene>('idle');
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    if (panelArmed || muted || minimized) {
      setScene('idle');
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let t: number;
    const step = () => {
      const cur = sceneRef.current;
      const dwell = cur === 'idle' ? 28_000 + Math.random() * 32_000 : 4000;
      t = window.setTimeout(() => {
        // Hold on a hidden tab — animations are paused anyway; just idle.
        if (document.hidden) {
          setScene('idle');
          step();
          return;
        }
        const next: BoetScene =
          sceneRef.current === 'idle'
            ? ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)]
            : 'idle';
        setScene(next);
        step();
      }, dwell);
    };
    step();
    return () => clearTimeout(t);
  }, [panelArmed, muted, minimized]);

  // Demo/QA hook: window.__boetScene('campfire') locks a scene; pass null to
  // resume wandering. (Back-compat alias for the old __ggAdventure name.)
  useEffect(() => {
    const w = window as unknown as {
      __boetScene?: (k: BoetScene | null) => void;
      __ggAdventure?: (k: BoetScene | null) => void;
    };
    const set = (k: BoetScene | null) => setScene(k ?? 'idle');
    w.__boetScene = set;
    w.__ggAdventure = set;
    return () => {
      delete w.__boetScene;
      delete w.__ggAdventure;
    };
  }, []);

  // ONE proactive "speak" per page — useful-first. After a short dwell Boet
  // shows this page-kind's contextual coaching tip (if any, once per session);
  // otherwise a rotating hello. Muted → silent. Guards: panel closed, tab
  // visible, install card down, not mid-form.
  useEffect(() => {
    if (panelArmed || muted || minimized) return;
    const coach = pickNudge(pathname);
    const { kind, ctx } = derivePageContext(pathname);

    // G3 — on a listing page whose kind slot is free, fetch the server
    // Guide's LIVE intro ($0 AI) in parallel with the dwell.
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
          markNudgeShown(kind);
          setBubble({ kind, text: `${liveIntro} Tap me for the guide 👇` });
        } else if (coach) {
          markNudgeShown(coach.kind);
          setBubble({
            kind: coach.kind,
            text: coach.text,
            prefill: coach.prefill,
          });
        } else if (Math.random() < HELLO_JOKE_CHANCE) {
          // Now and then the greeting is one of Boet's dry one-liners
          // instead of a hello — same slot, same tap-to-open behaviour.
          setBubble({
            kind: 'hello',
            text: JOKES[Math.floor(Math.random() * JOKES.length)],
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
  }, [pathname, panelArmed, muted, minimized]);

  // ── Linger prompt ────────────────────────────────────────────────
  // Parked on ONE page for LINGER_AFTER_MS without opening the chat →
  // Boet checks in ("Need a hand?"), occasionally with a joke instead.
  // Separate from the greeting (which fires ~4s in and auto-hides at
  // 14s): this is a second, later bubble — once per page view, same
  // guards as every other proactive speak, and never over a bubble
  // that's still showing.
  const lingerSpentRef = useRef(false);
  useEffect(() => {
    if (panelArmed || muted || minimized) return;
    const t = window.setTimeout(() => {
      if (lingerSpentRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (document.body.hasAttribute('data-install-prompt')) return;
      if (document.getElementById('askgg-hello')) return; // bubble still up
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      lingerSpentRef.current = true;
      const text =
        Math.random() < LINGER_JOKE_CHANCE
          ? JOKES[Math.floor(Math.random() * JOKES.length)]
          : LINGER_TEXTS[Math.floor(Math.random() * LINGER_TEXTS.length)];
      setBubble({ kind: 'hello', text });
    }, LINGER_AFTER_MS);
    return () => clearTimeout(t);
  }, [pathname, panelArmed, muted, minimized]);

  // Reset the per-page-view guards + drop any visible bubble on nav.
  useEffect(() => {
    spentThisPageRef.current = false;
    lingerSpentRef.current = false;
    setBubble(null);
  }, [pathname]);

  // Auto-hide after 14s; stand down when the panel opens or Boet is muted.
  useEffect(() => {
    if (panelArmed || muted || minimized) {
      setBubble(null);
      return;
    }
    if (!bubble) return;
    const t = window.setTimeout(() => setBubble(null), 14_000);
    return () => clearTimeout(t);
  }, [bubble, panelArmed, muted, minimized]);

  const open = (prefill?: string) => {
    setBubble(null);
    onOpen(prefill);
  };

  // Minimized: the whole dock reduces to a compact "✨ Ask Boet" pill in the
  // same corner. It still opens the chat; the small ◱ control restores Boet.
  if (minimized) {
    return (
      <div
        id="askgg-dock"
        className={[
          'app-chrome fixed z-[60] flex items-center gap-1.5',
          'right-4 bottom-[calc(12px+env(safe-area-inset-bottom))]',
          // The inset applies at every breakpoint: an iPad in browser mode is
          // md+ and still has a home indicator to clear.
          'md:right-6 md:bottom-[calc(20px+env(safe-area-inset-bottom))]',
        ].join(' ')}
      >
        {/* display:none by UA rule, so never a flex item. */}
        <style>{DOCK_STACKING_CSS}</style>
        <button
          type="button"
          id="askgg-fab"
          onClick={() => open()}
          aria-label="Open Ask Boet — your All Outdoor assistant"
          className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            boxShadow: '0 3px 12px rgba(0,0,0,0.45)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          <span aria-hidden>✨</span> Ask Boet
        </button>
        <button
          type="button"
          onClick={() => applyMinimized(false)}
          aria-label="Bring Boet back"
          title="Bring Boet back"
          className="flex items-center justify-center rounded-full w-6 h-6"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12,
            lineHeight: 0,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      id="askgg-dock"
      className={[
        'app-chrome fixed z-[60] flex flex-col items-end gap-1',
        // Boet's footprint — the design's 210px on desktop, trimmed on
        // mobile so a taller character doesn't crowd content. The id
        // selector in globals.css lifts this whole dock over the install card.
        'w-[150px] md:w-[210px]',
        'right-3 md:right-[26px]',
        // Inset at every breakpoint — an iPad in browser mode is md+ and
        // still has a home indicator under Boet's feet.
        'bottom-[calc(10px+env(safe-area-inset-bottom))] md:bottom-[calc(14px+env(safe-area-inset-bottom))]',
      ].join(' ')}
    >
      {/* display:none by UA rule, so never a flex item. */}
      <style>{DOCK_STACKING_CSS}</style>

      {bubble && (
        <div
          id="askgg-hello"
          role="status"
          className="gg-hello flex items-start gap-1"
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
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              color: 'var(--text-tertiary)',
              // Was 15x16 — the smallest target on the site, and it's the
              // control for getting an unsolicited bubble off your screen.
              // Missing it taps the suggestion instead, which opens the very
              // thing you were trying to close. 28px keeps the × visually
              // small while clearing the 24px WCAG 2.5.8 minimum.
              minWidth: 28,
              minHeight: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Boet himself — his hit area. The character fills the dock width;
          the SVG's 260×300 viewBox sets the height. */}
      <div style={{ position: 'relative', width: '100%' }}>
        <button
          type="button"
          id="askgg-fab"
          onClick={() => open()}
          aria-label="Open Ask Boet — your All Outdoor assistant"
          className="block w-full"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            filter: 'drop-shadow(0 3px 9px rgba(0,0,0,0.55))',
            // Calm + slightly dimmed while muted; hit area stays live.
            opacity: muted ? 0.9 : 1,
            transition: 'opacity 250ms ease',
          }}
        >
          <AskGgMascot alive={!muted} fill scene={scene} />
        </button>

        {/* Minimize — top-right, over the hat. Collapses to the pill.
            stopPropagation so tapping it never opens the panel. */}
        <button
          type="button"
          id="askgg-minimize"
          onClick={(e) => {
            e.stopPropagation();
            setBubble(null);
            applyMinimized(true);
          }}
          aria-label="Minimize Boet to a compact Ask Boet button"
          title="Minimize Boet"
          className="absolute flex items-center justify-center rounded-full w-6 h-6 md:w-7 md:h-7 right-0 top-0"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 0,
            lineHeight: 0,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Mute — just under the minimize. stopPropagation so tapping it
            never opens the panel. */}
        <button
          type="button"
          id="askgg-mute"
          onClick={(e) => {
            e.stopPropagation();
            const next = !muted;
            setMuted(next);
            if (next) setBubble(null);
          }}
          aria-label={muted ? 'Unmute Boet' : 'Mute Boet'}
          aria-pressed={muted}
          title={muted ? 'Unmute Boet' : 'Mute Boet'}
          className="absolute flex items-center justify-center rounded-full w-6 h-6 md:w-7 md:h-7 right-0 top-8 md:top-9"
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
    </div>
  );
}
