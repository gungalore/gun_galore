'use client';

/**
 * THE DESK — the shell every surface renders inside.
 *
 * Desktop: a 56px top bar (mark · tabs · search, site dot, avatar) over a
 * 1280-wide content column with an optional 340 rail. Phone: a 56px header
 * with a title and two round buttons, and the five tabs pinned to the bottom.
 *
 * ⚠️ NO TRANSFORM ON ANY ELEMENT IN THIS FILE. The drawer, both dialogs and
 * the search palette are `position: fixed`, and a transformed ancestor would
 * re-anchor all of them to the shell instead of the viewport. That is the
 * single most expensive mistake available in this component, and the symptom
 * — a drawer that scrolls with the page — looks like a drawer bug rather
 * than a shell bug, which is why it has cost this repo two afternoons.
 */
import * as React from 'react';
import { BottomTabs, DeskMark, TopTabs } from './tabs';
import { ServicesDrawer } from './services-drawer';
import { Dot } from './numbers';
import { IconExternal, IconSearch } from './icons';
import { SearchPalette } from './dialogs';
import { useDeskSearch } from './use-desk-search';
import { useIsPhone } from './interactions';

export interface DeskShellProps {
  /** Which of the five tabs is lit. */
  active: string;
  /** Phone header title — "The Desk", "Ledger". */
  title: string;
  /** Phone header sub-line — "10 things need you · 3 overdue". */
  sub?: string;
  /**
   * Site health, shown in the top bar and as the phone's first button.
   *
   * ⚠️ NO DEFAULT, AND THAT IS THE POINT. This used to fall back to
   * `{ tone: 'ok', word: 'Healthy' }`, and only the Site board ever passed a
   * real one — so the Desk, the Ledger, People and Pulse all carried a green
   * dot reading "Healthy" that no probe had ever produced. A status light
   * wired to nothing is worse than no light: it reads OK through an outage.
   * Omitted means the dot is not drawn at all.
   */
  site?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; word: string };
  /**
   * OPTIONAL NOTIFICATION THAT THE PALETTE OPENED. It does not decide whether
   * search exists — the shell owns that now (see useDeskSearch below), so the
   * control is always drawn and always works.
   *
   * 🚨 THIS COMMENT USED TO SAY "the search control is drawn only when this is
   * supplied. Nothing mounts SearchPalette yet and there is no search endpoint."
   * BOTH HALVES WERE WRONG, and together they cost this rebuild four cutover
   * entries. GET /admin/search existed the whole time, with its own comment
   * saying it "powers the type-ahead in the admin layout header"; SearchPalette
   * existed the whole time, finished, with keyboard navigation. And the gate
   * was `{onSearch ? <button/> : null}` — the Pile passed `() => undefined`,
   * which is truthy, so the button rendered anyway and swallowed every press.
   * The warning describing the bug was sitting directly above the bug.
   */
  onSearch?: () => void;
  /** The 340 context rail. Desktop only — the phone folds it into the body. */
  rail?: React.ReactNode;
  children: React.ReactNode;
}

export function DeskShell({
  active,
  title,
  sub,
  site,
  onSearch,
  rail,
  children,
}: DeskShellProps) {
  const phone = useIsPhone();

  /*
   * ⚠️ THE EXTERNAL CONSOLES LIVE ON THE SHELL, NOT ON A PAGE. Every
   * surface needs them and none of them owns them: an operator reaches for
   * Bob Go from the Ledger and for Meta from the Site board. Hanging it off
   * a page would mean five copies and one of them going stale.
   */
  const [services, setServices] = React.useState(false);

  /**
   * 🚨 SEARCH IS THE SHELL'S, FOR THE SAME REASON THE CONSOLES ARE. It used
   * to be a per-page `onSearch` prop, and the only page that passed one
   * passed `() => undefined` — a function, therefore truthy, therefore the
   * button rendered and swallowed every press, on the two surfaces whose
   * cutover note says in as many words that an arbitrary listing or
   * transaction cannot be reached.
   *
   * Owning it here means every surface gets it and none of them can get it
   * wrong. `onSearch` is kept only so a page can still be NOTIFIED that the
   * palette opened; it no longer decides whether search exists.
   */
  const search = useDeskSearch();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {phone ? (
        <PhoneHeader
          title={title}
          sub={sub}
          site={site}
          onSearch={() => {
            search.open();
            onSearch?.();
          }}
          onServices={() => setServices(true)}
        />
      ) : (
        <DesktopBar
          active={active}
          site={site}
          onSearch={() => {
            search.open();
            onSearch?.();
          }}
          onServices={() => setServices(true)}
        />
      )}

      <SearchPalette
        open={search.isOpen}
        onClose={search.close}
        query={search.query}
        onQueryChange={search.setQuery}
        results={search.results}
        loading={search.loading}
      />
      {search.failure ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 90,
            maxWidth: 420,
            padding: '9px 13px',
            borderRadius: 6,
            background: 'var(--dk-surface)',
            border: '1px solid var(--dk-bad)',
            color: 'var(--dk-ink)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {`Search failed. ${search.failure}`}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          gap: 32,
          // The phone leaves room for the bottom tabs plus the safe area; the
          // desktop does not have them.
          padding: phone ? '12px 14px calc(94px + env(safe-area-inset-bottom, 0px))' : '24px 32px 32px',
          maxWidth: 1280,
          width: '100%',
          margin: '0 auto',
          alignItems: 'flex-start',
          flex: 1,
        }}
      >
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {children}
          {/* The phone gets the rail's content underneath the pile rather than
              beside it — same information, one column. */}
          {phone && rail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>{rail}</div>
          ) : null}
        </main>

        {!phone && rail ? (
          <aside style={{ width: 340, flex: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rail}
          </aside>
        ) : null}
      </div>

      {phone ? <BottomTabs active={active} /> : null}

      <ServicesDrawer open={services} onClose={() => setServices(false)} />
    </div>
  );
}

function DesktopBar({
  active,
  site,
  onSearch,
  onServices,
}: {
  active: string;
  site?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; word: string };
  onSearch?: () => void;
  onServices?: () => void;
}) {
  return (
    <header
      style={{
        height: 56,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 24px',
        borderBottom: '1px solid var(--dk-line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 220 }}>
        <DeskMark />
        <span style={{ fontSize: 14, fontWeight: 500 }}>The Desk</span>
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center' }}>
        <TopTabs active={active} />
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: 420, justifyContent: 'flex-end' }}>
        {/* ⚠️ AN EXIT, NOT A SURFACE. It sits with search and the site dot on
            the right rather than among the five tabs: those are where the
            work is, and this leads out of the building. */}
        {onServices ? (
          <button
            type="button"
            onClick={onServices}
            aria-label="External consoles"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 10px',
              background: 'transparent',
              border: '1px solid var(--dk-line-2)',
              borderRadius: 'var(--dk-radius-control)',
              color: 'var(--dk-ink-2)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <IconExternal size={14} />
            Services
          </button>
        ) : null}
        {onSearch ? (
          <button
            type="button"
            onClick={onSearch}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: 290,
              height: 32,
              padding: '0 12px',
              background: 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-control)',
              color: 'var(--dk-ink-3)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <IconSearch size={14} />
            <span style={{ flex: 1 }}>Search orders, members, listings</span>
            <span
              className="dk-mono"
              style={{
                fontSize: 10.5,
                padding: '1px 6px',
                border: '1px solid var(--dk-line-2)',
                borderRadius: 5,
                color: 'var(--dk-ink-4)',
              }}
            >
              Ctrl K
            </span>
          </button>
        ) : null}

        {site ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Dot tone={site.tone} />
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)' }}>{site.word}</span>
          </span>
        ) : null}

        <span
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'var(--dk-inset)',
            border: '1px solid var(--dk-line-2)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--dk-ink-2)',
          }}
        >
          Op
        </span>
      </div>
    </header>
  );
}

function PhoneHeader({
  title,
  sub,
  site,
  onSearch,
  onServices,
}: {
  title: string;
  sub?: string;
  site?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; word: string };
  onSearch?: () => void;
  onServices?: () => void;
}) {
  return (
    <header
      style={{
        height: 56,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        borderBottom: '1px solid var(--dk-line)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</span>
        {sub ? <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{sub}</span> : null}
      </div>
      {/* The site dot becomes a button here: the phone ribbon is four cells,
          so health moves into the header rather than being dropped. Drawn only
          when a surface actually measured it — see DeskShellProps.site. */}
      {site ? (
        <RoundButton label={`Site: ${site.word}`}>
          <Dot tone={site.tone} />
        </RoundButton>
      ) : null}
      {onSearch ? (
        <RoundButton label="Search" onClick={onSearch}>
          <IconSearch size={16} style={{ color: 'var(--dk-ink-2)' }} />
        </RoundButton>
      ) : null}
      {onServices ? (
        <RoundButton label="External consoles" onClick={onServices}>
          <IconExternal size={16} style={{ color: 'var(--dk-ink-2)' }} />
        </RoundButton>
      ) : null}
    </header>
  );
}

function RoundButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line-2)',
        borderRadius: 'var(--dk-radius-control)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/**
 * The shortcut hints under the pile. Desktop only.
 *
 * ⚠️ THE LIST IS WHAT WORKS, NOT WHAT WAS DESIGNED. Ctrl K was printed here
 * while every surface passed `onSearch: () => undefined` — a legend teaching
 * an operator a keystroke that does nothing, which costs more trust than the
 * missing feature does. It comes back the moment a screen can open the
 * palette, and `search` is the switch that brings it.
 */
export function ShortcutFooter({ search = false }: { search?: boolean }) {
  const keys: [string, string][] = [
    ['J K', 'move'],
    ['Enter', 'open'],
    ['A', 'primary action'],
    ['L', 'later'],
    ...(search ? ([['Ctrl K', 'search']] as [string, string][]) : []),
    ['Esc', 'close drawer'],
  ];
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 18,
        flexWrap: 'wrap',
        marginTop: 18,
        paddingTop: 14,
        borderTop: '1px solid var(--dk-line)',
      }}
    >
      {keys.map(([k, what]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            className="dk-mono"
            style={{
              fontSize: 10.5,
              padding: '1px 6px',
              background: 'var(--dk-inset)',
              border: '1px solid var(--dk-line-2)',
              borderRadius: 5,
              color: 'var(--dk-ink-2)',
            }}
          >
            {k}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{what}</span>
        </span>
      ))}
    </div>
  );
}
