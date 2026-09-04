'use client';

/**
 * THE DESK — the five surfaces, and the two ways of reaching them.
 *
 * Desktop is a pill row in the top bar; the phone is bottom tabs, icon over
 * label. Same five names, same order, same active idiom (ink fill) — the
 * operator moves between a laptop and a phone during one shift and should
 * not have to relearn where anything is.
 *
 * ⚠️ A REAL TABLIST, NOT A ROW OF LINKS THAT LOOK LIKE ONE. Arrow keys move
 * between tabs, only the active tab is in the tab order, and each carries
 * aria-selected. It is also a real navigation — each tab is an anchor to its
 * route — so middle-click and "open in new tab" work, which a div with an
 * onClick quietly breaks.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  IconDesk,
  IconLedger,
  IconPeople,
  IconPulse,
  IconSite,
  type IconProps,
} from './icons';

export interface DeskTab {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<IconProps>;
}

/** The five, in fixed order. Nothing is configurable about this list. */
export const DESK_TABS: DeskTab[] = [
  { key: 'desk', label: 'Desk', href: '/admin/desk', icon: IconDesk },
  { key: 'ledger', label: 'Ledger', href: '/admin/desk/ledger', icon: IconLedger },
  { key: 'people', label: 'People', href: '/admin/desk/people', icon: IconPeople },
  { key: 'pulse', label: 'Pulse', href: '/admin/desk/pulse', icon: IconPulse },
  { key: 'site', label: 'Site', href: '/admin/desk/site', icon: IconSite },
];

/** Shared arrow-key handling for both orientations. */
function useTabRoving(count: number) {
  const refs = React.useRef<(HTMLAnchorElement | null)[]>([]);
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      const next = (index + delta + count) % count;
      refs.current[next]?.focus();
    },
    [count],
  );
  return { refs, onKeyDown };
}

/* ────────────────────────────────────────────────────────────────────────
 * Desktop
 * ──────────────────────────────────────────────────────────────────────── */

export function TopTabs({ active }: { active: string }) {
  const { refs, onKeyDown } = useTabRoving(DESK_TABS.length);
  return (
    <div role="tablist" aria-label="Desk surfaces" style={{ display: 'flex', gap: 4 }}>
      {DESK_TABS.map((t, i) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            // Only the active tab is reachable by Tab; the arrows move within
            // the group. That is the tablist contract, and it stops the five
            // surfaces eating five stops on the way to the pile.
            tabIndex={on ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 32,
              padding: '0 14px',
              borderRadius: 'var(--dk-radius-pill)',
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              background: on ? 'var(--dk-ink)' : 'transparent',
              color: on ? 'var(--dk-ground)' : 'var(--dk-ink-2)',
              transition: 'background 120ms ease-out, color 120ms ease-out',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Phone
 * ──────────────────────────────────────────────────────────────────────── */

export function BottomTabs({ active }: { active: string }) {
  const { refs, onKeyDown } = useTabRoving(DESK_TABS.length);
  return (
    <nav
      role="tablist"
      aria-label="Desk surfaces"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'flex-start',
        // 78 tall including 20 of home-indicator room. The safe-area inset is
        // added on top rather than baked in, so it is right on a notched
        // phone and costs nothing on one without.
        height: 78,
        paddingTop: 8,
        // ⚠️ CLAMPED, exactly as components/bottom-tab-bar.tsx is. Chrome for
        // iOS keeps its own auto-hiding toolbar reserved even where
        // display-mode reads standalone, so env(safe-area-inset-bottom) can
        // come back far larger than the ~34pt home indicator it is meant to
        // describe — that is the 'white bar roughly twice the height of the
        // home indicator' already reported once on the shop. This bar paints
        // --dk-ground, so uncapped it would do the same in near-black.
        // min() needs no UA sniff: where the inset is honest nothing changes.
        paddingBottom: 'calc(20px + min(env(safe-area-inset-bottom, 0px), 34px))',
        background: 'var(--dk-ground)',
        borderTop: '1px solid var(--dk-line)',
      }}
    >
      {DESK_TABS.map((t, i) => {
        const on = t.key === active;
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              margin: '0 4px',
              padding: '6px 0',
              borderRadius: 10,
              textDecoration: 'none',
              background: on ? 'var(--dk-surface)' : 'transparent',
              color: on ? 'var(--dk-ink)' : 'var(--dk-ink-3)',
            }}
          >
            <Icon size={22} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 600 : 500 }}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The "AO" mark in the top bar. Ink block, ground letters. */
export function DeskMark() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 26,
        height: 26,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        background: 'var(--dk-ink)',
        color: 'var(--dk-ground)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      AO
    </span>
  );
}
