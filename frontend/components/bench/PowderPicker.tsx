'use client';

/**
 * THE BENCH — "Add a powder".
 *
 * The one place a member grows their bench from inside the finder. Purely
 * presentational: the page owns the canonical list, the loading flag, the
 * bench snapshot, the PUT and the toast. This file owns the search box, the
 * filtering, and nothing else — Escape, the focus trap and the return of
 * focus all come from OverlayShell, so the five overlays cannot drift apart.
 *
 * Both prototypes in one component, because PowderPickerProps carries no
 * variant flag: the 420px centred modal from Main.dc.html at 768 and above,
 * the 70%-tall bottom sheet from Pwa.dc.html below it and in the installed
 * app.
 *
 * One deliberate divergence from the prototype, and it comes from the
 * contract: the prototype REMOVES powders already on the bench from the list;
 * PowderPickerProps hands us `onBench` instead, so they stay in place, shown
 * as added and not selectable. Vanishing rows are the worse behaviour — a
 * member who searches "H4350" moments after adding it gets an empty list and
 * no idea why.
 *
 * ⚠️ COPY. Operator ruling 2026-09-02: nothing here may name where a figure
 * comes from. No "manual", no "CIP", no "SAAMI", no "published", no source
 * counts. Powder MAKER names are product facts and stay — they are the whole
 * point of the second column.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BenchPowder } from '@/lib/bench/api';
import type { PowderPickerProps } from './contract';
import { IconX, OverlayShell, usePhone } from './primitives';

/**
 * The canonical list is the whole powder table, not the member's bench, so it
 * is long enough that re-filtering on every keystroke is felt on a phone. The
 * input stays controlled — typing is never delayed — and only the list waits.
 * 160ms sits under --dur-fast, so the pause reads as the list settling rather
 * than as lag.
 */
const SEARCH_DEBOUNCE_MS = 160;

/** Matched on name AND maker, as the prototype does — "Hodgdon" finds H4350. */
function matches(p: BenchPowder, term: string): boolean {
  if (!term) return true;
  return `${p.name} ${p.maker ?? ''}`.toLowerCase().includes(term);
}

/**
 * How many loads this powder would add for THIS bench — the reason to reach
 * for one powder over another.
 *
 * `loadsForBench` is optional on BenchPowder: undefined means the server did
 * not compute it, which is not the same fact as zero. Printing "no loads for
 * your bullets" over a missing count would be an invention, so the line is
 * dropped instead.
 */
function hintFor(p: BenchPowder): string | null {
  const n = p.loadsForBench;
  if (n === undefined || n === null) return null;
  return n > 0 ? `${n} load${n > 1 ? 's' : ''} on your bench` : 'no loads for your bullets';
}

export function PowderPicker({
  open,
  powders,
  loading,
  onBench,
  onClose,
  onAdd,
}: PowderPickerProps) {
  const titleId = useId();
  const searchId = useId();
  const phone = usePhone();

  // `q` is what is in the box; `term` is what the list is filtered by. They
  // differ for one debounce window and no longer.
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setTerm(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q, open]);

  // Every opening starts from the whole list, as the prototype's openPicker
  // does (pickerQ: ''). A member who searched, added, and comes back for a
  // second powder should not have to clear a stale term first.
  //
  // ⚠️ RESET DURING RENDER, NOT IN AN EFFECT. useEffect runs after the browser
  // has painted, so an effect-based reset paints one frame of the PREVIOUS
  // search — the old text sitting in the box over its old filtered list —
  // before wiping it. Setting this component's own state during its own render
  // makes React throw the render away and re-run it before committing, so
  // nothing stale ever reaches the screen. The ref is what stops it looping:
  // it only fires on the false→true edge.
  const wasOpen = useRef(open);
  if (wasOpen.current !== open) {
    wasOpen.current = open;
    if (open) {
      setQ('');
      setTerm('');
    }
  }

  const onBenchIds = useMemo(() => new Set(onBench), [onBench]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return powders.filter((p) => matches(p, needle));
  }, [powders, term]);

  // The page owns the toast and the PUT, so adding is two calls: hand the
  // powder up, then close. Closing here rather than leaving it to the page is
  // what the flow specifies ("tap adds and closes"); a page that also clears
  // its own open flag inside onAdd simply sets the same flag twice.
  const add = useCallback(
    (p: BenchPowder) => {
      onAdd(p);
      onClose();
    },
    [onAdd, onClose],
  );

  // OverlayShell has no `open` prop — mounting IS opening, because its
  // entrance is a mount animation. The flag on this contract is therefore
  // answered here.
  if (!open) return null;

  return (
    <OverlayShell
      variant={phone ? 'bottom-sheet' : 'modal'}
      labelledBy={titleId}
      onClose={onClose}
      style={
        phone
          ? // Pwa.dc.html's sheet height. The shell already supplies the
            // fixed box, the 92% cap, the flex column and the radii.
            { height: '70%' }
          : // Main.dc.html's 420. `.bench-modal` is 760 by default, which is
            // the load card's width, not this one's; the min() keeps it off
            // the edges of a narrow window.
            {
              width: 'min(420px, calc(100vw - 32px))',
              display: 'flex',
              flexDirection: 'column',
            }
      }
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: phone ? 8 : 12,
          padding: phone ? '4px 4px 8px 16px' : '18px 20px 12px',
        }}
      >
        {/* The shell focuses this on open and makes it a script-only tab stop. */}
        <h2
          id={titleId}
          className="head"
          style={{ flex: 1, margin: 0, fontSize: phone ? 18 : 20 }}
        >
          Add a powder
        </h2>
        <IconX
          onClick={onClose}
          label="Close"
          size={phone ? 'mobile' : 'desktop'}
          glyph={phone ? 18 : 16}
        />
      </div>

      {/*
        Hand-rolled rather than <Field>: Field draws a visible uppercase label
        above the box, and a search input that already says what it wants in
        its placeholder does not need one twice. The label is still there for
        readers, just not on screen.
      */}
      <div style={{ flex: 'none', padding: phone ? '0 16px 10px' : '0 20px 10px' }}>
        <div className="field">
          <label htmlFor={searchId} className="sr-only">
            Search powders
          </label>
          <input
            id={searchId}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search powders"
            autoComplete="off"
            data-autofocus
            spellCheck={false}
            // 44px is the §9 tap target; 16px is not a taste call either, iOS
            // zooms the whole page in on focus for anything smaller.
            style={phone ? { height: 44, padding: '0 12px', fontSize: 16 } : undefined}
          />
        </div>
      </div>

      <div
        style={{
          borderTop: '0.5px solid var(--border-divider)',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          ...(phone
            ? // min-height 0 is load-bearing: without it the flex child
              // refuses to shrink below its content and the list grows past
              // the sheet instead of scrolling inside it.
              { flex: '1 1 auto', minHeight: 0, paddingBottom: 28 }
            : // The prototype's 320px cap, with a vh guard so a short window
              // does not push the footer under `.bench-modal`'s overflow.
              { maxHeight: 'min(320px, 52vh)' }),
        }}
      >
        {loading ? (
          <div aria-busy="true">
            {/*
              Not .gg-skeleton: its shimmer runs --bg-card → --bg-card-hover,
              which on this card's white ground is invisible. Same recipe as
              the shared <Skel>, inlined so the bench bundle does not pull in
              components/skeleton.tsx and, through it, listing-card.
              animate-pulse is an opacity keyframe, so the global box-shadow
              killswitch does not reach it.
            */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  padding: phone ? '17px 12px' : '13px 12px',
                  borderBottom: '0.5px solid var(--border-divider)',
                }}
              >
                <div
                  className="animate-pulse"
                  style={{
                    height: 12,
                    width: i % 2 === 0 ? '62%' : '46%',
                    borderRadius: 4,
                    background: 'var(--bg-inset)',
                  }}
                />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '22px 20px', fontSize: 13, color: 'var(--text-tertiary)' }}>
            {/*
              The list is filtered by `term`, so an empty list with an empty
              term is not a failed search — it is an empty list. Telling
              someone who has typed nothing that nothing matches their name
              sends them hunting for a typo they never made.
            */}
            {powders.length === 0
              ? /* Nothing was loaded at all. Telling someone their search
                   failed when the catalogue itself is empty sends them
                   hunting for a typo they never made — which is exactly
                   what happened when the Bench shipped before its import
                   had run. */
                'No powders are loaded yet.'
              : term.trim()
                ? 'Nothing matches that name.'
                : 'No powders to show.'}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.map((p) => {
              const added = onBenchIds.has(p.id);
              const hint = hintFor(p);

              const name = (
                <span>
                  {p.name}
                  {p.maker ? (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {' '}
                      · {p.maker}
                    </span>
                  ) : null}
                </span>
              );

              // Already on the bench: a row, not a control. A disabled button
              // still sits in the accessibility tree as something to press;
              // this is a statement of fact instead.
              if (added) {
                return (
                  <li key={p.id}>
                    <div
                      className="pick"
                      style={{
                        // Inline so it also beats `.bench .pick:hover` — a row
                        // that lights up under the cursor reads as clickable,
                        // and this one is not.
                        background: 'var(--bg-inset)',
                        cursor: 'default',
                        color: 'var(--text-tertiary)',
                        minHeight: phone ? 48 : undefined,
                      }}
                    >
                      {name}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          color: 'var(--text-tertiary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--success)"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                        On your bench
                      </span>
                    </div>
                  </li>
                );
              }

              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="pick"
                    onClick={() => add(p)}
                    style={phone ? { minHeight: 48, fontSize: 14 } : undefined}
                  >
                    {name}
                    {hint ? (
                      <span
                        className="num"
                        style={{
                          fontSize: 12,
                          color: 'var(--text-tertiary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {hint}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Main.dc.html only. The phone sheet is short and this is a nicety, so
          the prototype drops it there rather than eat a row of the list. */}
      <div
        style={{
          flex: 'none',
          padding: phone ? '8px 16px 12px' : '10px 20px 16px',
          fontSize: 11.5,
          color: 'var(--text-tertiary)',
        }}
      >
        H 4350, H-4350 and H4350 are the same powder.
      </div>

      {/* Filtering never moves focus, so the result count is announced. */}
      <span role="status" aria-live="polite" className="sr-only">
        {loading
          ? 'Loading powders'
          : `${filtered.length} powder${filtered.length === 1 ? '' : 's'}`}
      </span>
    </OverlayShell>
  );
}

export default PowderPicker;
