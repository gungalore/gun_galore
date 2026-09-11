'use client';

/**
 * THE DESK — the six surfaces, and the two ways of reaching them.
 *
 * Desktop is a pill row in the top bar; the phone is bottom tabs, icon over
 * label. Same six names, same order, same active idiom (ink fill) — the
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
  IconBolt,
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

/**
 * The six, in fixed order. Nothing is configurable about this list.
 *
 * 🚨 IT WAS FIVE, AND TWO WRITTEN DECISIONS CITED THAT NUMBER AS THE REASON
 * THEY BECAME LENSES INSTEAD OF TABS — app/admin/desk/ledger/page.tsx ("Orders
 * is not a sixth tab") and the /admin/complaints entry in lib/desk-cutover.ts,
 * both quoting the sentence above. Adding one overrules them, so here is why
 * it is not the same request: Orders and the complaints register are other
 * VIEWS OF ONE BOARD'S DATA, fetched by that board's loader. Agent is a
 * different daemon, on its own poll, with its own failure — a hung Warden must
 * not be able to slow or blank the alerts inbox, and on one board it could.
 *
 * ⚠️ SITE BECAME HEALTH IN PLACE, IN THE SAME SLOT. Nothing the operator had
 * disappeared: /admin/desk/site redirects with its query string intact, the
 * Warden half is the new Agent tab, and the only thing genuinely removed from
 * the board is the four-flag settings panel (see lib/desk-cutover.ts under
 * /admin/settings). Keeping a sixth pill pointing at a redirect would have
 * been a tab whose only content is a trip somewhere else.
 *
 * ⚠️ SIX IS MEASURED, AND SEVEN WOULD NOT HAVE BEEN SAFE. Rendered with the
 * real Geist face at the real sizes: bottom tabs are flex:1 with 4px margins,
 * giving 51.7px of tap width at 360px and 56.7px at 390px for six — above the
 * 44px minimum the Desk polices everywhere else. SEVEN gives 43.1px at 360px,
 * i.e. under it, on a small Android. desk-guard cannot see this, because the
 * width comes from flex rather than from a literal it can grep, so it is
 * written here.
 *
 * ⚠️ AND THE DESKTOP ROW COMPRESSES ITS NEIGHBOURS RATHER THAN OVERFLOWING.
 * At 1024px the six pills need 415px against the five's 330; the 220px mark
 * block and the 420px right-hand block both carry the default flex-shrink, so
 * they give up 41px and 79px respectively and the header does not scroll.
 * Measured at 1024, 1100 and 1280 on a fixture that reproduces the bar's
 * geometry — NOT on the running app, so the residual risk is that the right
 * block's real contents (Consoles, search, the site dot, the avatar) need more
 * than the 341px it is left with at exactly 1024. A seventh pill would take it
 * to 471 and that margin is gone.
 */
export const DESK_TABS: DeskTab[] = [
  { key: 'desk', label: 'Desk', href: '/admin/desk', icon: IconDesk },
  { key: 'ledger', label: 'Ledger', href: '/admin/desk/ledger', icon: IconLedger },
  { key: 'people', label: 'People', href: '/admin/desk/people', icon: IconPeople },
  { key: 'pulse', label: 'Pulse', href: '/admin/desk/pulse', icon: IconPulse },
  // IconBolt is Warden's own glyph — it is what the chat card and the status
  // tag already use for the daemon, so the tab and the thing it leads to agree.
  { key: 'agent', label: 'Agent', href: '/admin/desk/agent', icon: IconBolt },
  { key: 'health', label: 'Health', href: '/admin/desk/health', icon: IconSite },
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
              height: 'var(--dk-h-control)',
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
              // Kept although nothing is filled any more: the focus ring is an
              // outline, and an outline follows the border radius.
              borderRadius: 10,
              textDecoration: 'none',
              // ⚠️ NO BACKGROUND ON THE ACTIVE TAB. The artboard's rule is
              // `.tab.on { color: #EEF2F0; font-weight: 600 }` and nothing
              // else, with the reasoning written beside it: "the active tab is
              // INK, not a colour: on this surface colour is reserved for
              // state, so a coloured tab would say something needs attention
              // when nothing does."
              //
              // A raised --dk-surface pill is the same claim in a quieter
              // voice — it is the only lifted box in the bar, so it reads as
              // a badge on whichever board you happen to be standing on.
              // Ink and weight carry it.
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
