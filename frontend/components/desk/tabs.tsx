'use client';

/**
 * THE DESK — the four surfaces, and the two ways of reaching them.
 *
 * Desktop is a pill row in the top bar; the phone is bottom tabs, icon over
 * label. Same four names, same order, same active idiom (ink fill) — the
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
import { IconBolt, IconDesk, IconPeople, IconSite, type IconProps } from './icons';
import { useDeskStatus } from './desk-status';

export interface DeskTab {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<IconProps>;
}

/**
 * The four, in fixed order. Nothing is configurable about this list.
 *
 * 🚨 IT WAS SIX, AND FOUR IS WHAT THE BARS CAN HONESTLY NAME. Two of the six
 * pointed at destinations that no longer have a page of their own:
 * /admin/desk/ledger and /admin/desk/site are both 307 route handlers, kept
 * because bookmarks and minted hrefs carry them, and a pill whose only content
 * is a trip somewhere else is a tab pretending to be a surface. Pulse went
 * with them — the whole analytics board is deleted in this phase, and what
 * that costs is written down in lib/desk-cutover.ts under /admin/analytics,
 * /admin/analytics/insights, /admin/analytics/health and /admin/categories
 * rather than left for somebody to discover.
 *
 * ⚠️ THE LEDGER'S ROUTE HANDLER MUST STAY. It is the 307 that carries
 * `?status=PAID&page=3` onto the pile, minted by lib/desk-search.ts, the
 * People board and admin-health.service.ts. Losing the tab is a navigation
 * decision; losing the redirect would land a live link on an unfiltered page
 * one that looks like it worked.
 *
 * ⚠️ AGENT IS STILL NOT A LENS ON HEALTH, and this phase did not revisit that.
 * The reasoning that made it its own tab holds exactly as it did: Warden is a
 * different daemon, on its own poll, with its own failure, and a hung Warden
 * must not be able to slow or blank the alerts inbox — which on one board it
 * could. Four is reached by removing pills that lead to redirects, not by
 * merging boards that fail independently.
 *
 * ⚠️ THE KEY IS 'desk' AND THE LABEL IS 'Now'. The key is a wire value: five
 * pages pass it to DeskShell and `activeTabFor()` in lib/desk-pile.ts returns
 * it, and that file is not this track's to edit. Renaming the key would light
 * no tab at all on three of the pile's six lenses — silently, which is the
 * exact failure lib/desk-tabs-routes.spec.ts exists for.
 */
export const DESK_TABS: DeskTab[] = [
  { key: 'desk', label: 'Now', href: '/admin/desk', icon: IconDesk },
  { key: 'people', label: 'People', href: '/admin/desk/people', icon: IconPeople },
  { key: 'health', label: 'Health', href: '/admin/desk/health', icon: IconSite },
  // IconBolt is Warden's own glyph — it is what the chat card and the status
  // tag already use for the daemon, so the tab and the thing it leads to agree.
  { key: 'agent', label: 'Agent', href: '/admin/desk/agent', icon: IconBolt },
];

/**
 * Keys that no longer have a pill of their own, and the pill that stands in.
 *
 * 🚨 WITHOUT THIS, THREE OF THE PILE'S SIX LENSES LIGHT NOTHING.
 * `activeTabFor(view)` returns 'ledger' for the orders, sales and books
 * lenses — correct while there was a Ledger pill, and after this phase it is a
 * key no tab carries, so both bars would match nothing and the operator could
 * not tell which board they were standing on. The Ledger's route 307s onto the
 * pile, so the pile IS where a ledger lens lives; the alias says that in one
 * place instead of editing a file this track does not own.
 *
 * ⚠️ ONLY 'ledger' HAS A LIVE PRODUCER, AND SAYING SO IS THE POINT OF THIS
 * LINE. `activeTabFor()` emits it. NOTHING emits 'site' as an `active` today —
 * /admin/desk/site is a URL, and the board it 307s to passes 'health' — so
 * that entry is a spare, kept because backend/src/desk/desk.service.ts still
 * mints /admin/desk/site hrefs on all three Warden cards and the next person
 * to wire one up is likelier to reach for the route's own name than for
 * 'health'. If it is still unused when somebody next reads this, delete it.
 */
const STANDS_IN_FOR: Record<string, string> = { ledger: 'desk', site: 'health' };

function litKey(active: string): string {
  return STANDS_IN_FOR[active] ?? active;
}

/* ────────────────────────────────────────────────────────────────────────
 * The counts
 * ──────────────────────────────────────────────────────────────────────── */

interface TabReading {
  /** The figure on the badge. */
  count: number | null;
  /** Whether the figure is a fault rather than a workload. */
  bad: boolean;
  /** What a screen reader hears instead of the bare label. */
  words: string | null;
}

/**
 * What each tab has to say, from the one shared poll.
 *
 * 🚨 THIS IS THE ONLY WAY AN OPERATOR STANDING ON HEALTH LEARNS THAT SOMETHING
 * LANDED ON NOW. Before the counts the shell knew nothing and the answer to
 * "is there anything waiting" was to press the tab and look. That is the whole
 * purpose of the badges; they are not ornament on a navigation bar.
 *
 * ⚠️ A BADGE IS DRAWN ONLY ABOVE ZERO, AND NEVER FOR A COUNT NOBODY READ.
 * lib/desk-status.ts keeps `number` and `null` apart all the way here for one
 * reason: a zero means stand down and a null means the question was not
 * answered. Both render silently — a chrome that printed "0" on four tabs
 * every morning is a chrome nobody reads — so the narrow, honest rule is that
 * the ABSENCE of a badge never asserts a zero. What distinguishes the two on
 * screen is the header dot, which draws the `unknown` tone in words after a
 * sweep that could not read the gates and draws nothing at all before the
 * first sweep lands. The residual gap, stated rather than hedged: on a cold
 * load whose first sweep fails outright, every tab is silent and that silence
 * looks like an all-clear until the board itself reports its own failure.
 */
function readingFor(key: string, counts: ReturnType<typeof useDeskStatus>['counts']): TabReading {
  if (key === 'desk') {
    const n = counts.now;
    const late = counts.overdue ?? 0;
    return {
      count: n,
      // ⚠️ OVERDUE COLOURS THE PILE'S BADGE; IT NEVER GETS A BADGE OF ITS OWN.
      // The artboard paints the overdue figure bad-red inside an otherwise dim
      // header line, and the pill has room for one number. Two numbers on one
      // tab is a sum nobody can read at a glance.
      bad: late > 0,
      words:
        n === null
          ? null
          : `${n} ${n === 1 ? 'thing needs' : 'things need'} you` +
            (late > 0 ? `, ${late} overdue` : ''),
    };
  }
  if (key === 'health') {
    const n = counts.redGates;
    return {
      count: n,
      bad: (n ?? 0) > 0,
      words: n === null ? null : `${n} red ${n === 1 ? 'gate' : 'gates'}`,
    };
  }
  if (key === 'agent') {
    const n = counts.proposals;
    return {
      count: n,
      // A proposal waiting is work, not a fault. Colour on this surface means
      // "something is wrong", and Warden asking permission is the system
      // behaving exactly as designed.
      bad: false,
      words: n === null ? null : `${n} waiting on you`,
    };
  }
  return { count: null, bad: false, words: null };
}

/**
 * The number beside a tab's name.
 *
 * ⚠️ COLOUR, NOT A FILLED PILL. The Desk's palette rule is that colour is only
 * ever state, and a badge with its own background is the only lifted box in
 * the bar — it reads as a decoration on whichever board you happen to be
 * standing on. Ink weight carries the count; --dk-bad carries the fault.
 *
 * ⚠️ AND NOTHING IS RED ON THE ACTIVE TAB. The active desktop pill is filled
 * with --dk-ink and its text is --dk-ground, so --dk-bad on it is a light
 * coral on a near-white ground — the one place in the bar where the state
 * colour is least legible. It is also the one place it is least needed: the
 * board you are standing on paints its own overdue figure red in the header
 * sub-line. The badge matters when you are somewhere else.
 */
function TabCount({ n, color }: { n: number; color: string }) {
  return (
    <span
      className="dk-mono"
      aria-hidden="true"
      style={{ fontSize: 10.5, fontWeight: 600, color, letterSpacing: '0.01em' }}
    >
      {n}
    </span>
  );
}

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
 *
 * ⚠️ THE WIDTH MEASUREMENT THAT USED TO LIVE HERE DESCRIBED SIX PILLS AND NO
 * COUNTS, AND BOTH HALVES HAVE MOVED. It recorded 415px of pills at 1024
 * against the five's 330, rendered with the real Geist face on a fixture that
 * reproduces the bar's geometry — with the 220px mark block and the 420px
 * right-hand block shrinking to absorb it. Four pills carry strictly fewer and
 * shorter labels than those six, so the row is narrower; what is NEW is up to
 * four badges, each a 10.5px mono figure plus a 6px gap, which is tens of
 * pixels back. The honest claim is the direction and the slack, not a figure:
 * the row cannot exceed the six-pill 415 that already fitted, so nothing here
 * can start the header scrolling. Re-measure on the same fixture before adding
 * a fifth pill.
 * ──────────────────────────────────────────────────────────────────────── */

export function TopTabs({ active }: { active: string }) {
  const { refs, onKeyDown } = useTabRoving(DESK_TABS.length);
  const { counts } = useDeskStatus();
  const lit = litKey(active);
  return (
    <div role="tablist" aria-label="Desk surfaces" style={{ display: 'flex', gap: 4 }}>
      {DESK_TABS.map((t, i) => {
        const on = t.key === lit;
        const reading = readingFor(t.key, counts);
        const aria = reading.words ? `${t.label}, ${reading.words}` : undefined;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            aria-label={aria}
            // Only the active tab is reachable by Tab; the arrows move within
            // the group. That is the tablist contract, and it stops the four
            // surfaces eating four stops on the way to the pile.
            tabIndex={on ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
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
            {reading.count !== null && reading.count > 0 ? (
              <TabCount
                n={reading.count}
                color={
                  on ? 'var(--dk-ground)' : reading.bad ? 'var(--dk-bad)' : 'var(--dk-ink-3)'
                }
              />
            ) : null}
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
  const { counts } = useDeskStatus();
  const lit = litKey(active);
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
        //
        // ⚠️ FOUR TABS DO NOT CHANGE THIS HEIGHT, and three other places
        // depend on it: components/desk/overlays.tsx (the undo toast's lift),
        // app/admin/desk/orders-register.tsx, and --dk-board-pad in tokens.css.
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
        const on = t.key === lit;
        const Icon = t.icon;
        const reading = readingFor(t.key, counts);
        const aria = reading.words ? `${t.label}, ${reading.words}` : undefined;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            aria-label={aria}
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
            {/* ⚠️ THE COUNT SITS BESIDE THE WORD, NOT OVER THE GLYPH. A dot
                pinned to the icon's top-right is the phone idiom everywhere
                else, and it is the one thing this bar cannot afford: it would
                be the only floating mark in 78px of near-black chrome, and at
                10.5px a two-digit figure on a 22px glyph is unreadable. Four
                tabs leave roughly 82px of tap width at 360px (flex:1 across
                the viewport less 8px of margin each), which is room for a
                word and a number on one line. */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 5,
                fontSize: 10.5,
                fontWeight: on ? 600 : 500,
              }}
            >
              {t.label}
              {reading.count !== null && reading.count > 0 ? (
                <TabCount
                  n={reading.count}
                  color={on ? 'var(--dk-ink)' : reading.bad ? 'var(--dk-bad)' : 'var(--dk-ink-3)'}
                />
              ) : null}
            </span>
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
