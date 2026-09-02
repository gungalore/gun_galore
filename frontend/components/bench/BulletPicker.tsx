'use client';

/**
 * THE BENCH — "Add a bullet".
 *
 * The second of the three Add flows, and the reason this file exists at all:
 * the rail has always drawn three Add buttons, but for a while all three
 * opened the powder picker. The results query is an AND across the three axes
 * — a load shows only when the member has the powder AND a matching bullet AND
 * the cartridge — so a bench that could never gain a bullet returned nothing,
 * for ever, however many powders were added to it.
 *
 * Purely presentational, exactly as PowderPicker is: the page owns the
 * canonical list, the loading flag, the bench snapshot, the PUT and the toast.
 * This file owns the search box and the filtering. Escape, the focus trap and
 * the return of focus all come from OverlayShell, so the overlays cannot drift
 * apart.
 *
 * Both prototypes in one component, because BulletPickerProps carries no
 * variant flag: the 420px centred modal at 768 and above, the 70%-tall bottom
 * sheet below it and in the installed app.
 *
 * Same deliberate divergence from the prototype as the powder picker: bullets
 * already on the bench stay in the list, shown as added and not selectable,
 * rather than vanishing from it. A member who searches for the bullet they
 * added a moment ago should find it sitting there, not an empty list.
 *
 * 🚨 EVERY ROW LEADS WITH ITS CALIBRE, AND THAT IS THE POINT OF THE ROW. A
 * weight is not a bullet: "Hornady 150gr SP" names a .277", a .308", a .311"
 * and a .323" projectile, and they are not interchangeable — three thou over
 * and the round will not chamber, or chambers and spikes pressure. When two
 * rows read the same, the calibre is the ONLY thing the member is choosing
 * between, so it goes first, in its own aligned column, not trailing after the
 * load count where the eye arrives last.
 *
 * ⚠️ COPY. Operator ruling 2026-09-02: nothing here may name where a figure
 * comes from. No "manual", no "CIP", no "SAAMI", no "published", and no source
 * counts — `loads` is a count of consolidated loads, which is the number the
 * member is choosing between. That rule reaches the calibre too: a row without
 * one says "Calibre unknown", never "not published". Bullet MAKER names
 * (Hornady, Sierra, Barnes) are product facts and stay.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CALIBRE_UNKNOWN, calibreSearchTokens, formatCalibre } from '@/lib/bench/calibre';
import type { BenchBulletOption, BulletPickerProps } from './contract';
import { bulletKey } from './contract';
import { IconX, OverlayShell, usePhone } from './primitives';

/**
 * The input stays controlled — typing is never delayed — and only the list
 * waits. 160ms sits under --dur-fast, so the pause reads as the list settling
 * rather than as lag. It matters more here than on powders: this list is
 * roughly 1,139 rows against 305 — and MORE than that since the calibre
 * split, because a (maker, weight, category) triple that appears across three
 * calibres is now three rows rather than one.
 */
const SEARCH_DEBOUNCE_MS = 160;

/**
 * How many rows are DRAWN. Not a cap on the data — `filtered` is always the
 * whole matching set, and its full size is what the count line and the live
 * region report.
 *
 * ⚠️ THE LIST IS NEVER SILENTLY TRUNCATED. That failure has already shipped
 * once on this module: powders were capped at 300 while 305 existed, so five
 * of them were unreachable however they were spelled, and nothing on screen
 * said so. A member who cannot see their bullet concludes it is not in the
 * catalogue and stops looking. So when the drawn set is short of the matching
 * set, the picker says exactly that, above the list, where it cannot be
 * missed — and narrowing the search brings the rest into reach.
 *
 * 200 is the ceiling on DOM cost: each row is a button and four spans, so the
 * full list is several thousand nodes to lay out on a phone before the first
 * keystroke.
 */
const DRAW_CAP = 200;

/**
 * The one string a row is matched against.
 *
 * The weight goes in twice, bare and with its unit, so "150" and "150gr" both
 * land, and the calibre goes in three ways — `.308"`, `308`, `0.308` — because
 * a member types it with the dot, without it, and occasionally with the
 * leading zero. Searching for the calibre is how someone with two 150 gr rows
 * in front of them gets down to the one that fits their rifle, so it has to
 * work on the digits alone.
 *
 * Built once per list rather than per keystroke: lower-casing a thousand-odd
 * strings on every debounce tick is work nobody asked for.
 */
export function haystack(b: BenchBulletOption): string {
  return `${calibreSearchTokens(b.calibreIn)} ${b.maker} ${b.weightGr} ${b.weightGr}gr ${b.category}`.toLowerCase();
}

/**
 * Every word must appear somewhere in the row, in any order.
 *
 * ⚠️ NOT ONE SUBSTRING OVER THE JOINED STRING, WHICH IS WHAT THE POWDER
 * PICKER CAN AFFORD. A powder is matched on two fields that are nearly always
 * typed in one order ("Hodgdon H4350"); a bullet is matched on four, and a
 * member types them in whichever order they think of them. "hornady 150" and
 * "150 sp" both have to work, and so do "sp 150" and "308 150".
 */
export function matches(hay: string, words: string[]): boolean {
  for (const w of words) if (!hay.includes(w)) return false;
  return true;
}

export function BulletPicker({
  open,
  bullets,
  loading,
  onBench,
  onClose,
  onAdd,
}: BulletPickerProps) {
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

  // Every opening starts from the whole list. A member who searched, added,
  // and comes back for a second bullet should not have to clear a stale term
  // first.
  //
  // ⚠️ RESET DURING RENDER, NOT IN AN EFFECT. useEffect runs after the browser
  // has painted, so an effect-based reset paints one frame of the PREVIOUS
  // search — the old text over its old filtered list — before wiping it.
  // Setting this component's own state during its own render makes React throw
  // the render away and re-run it before committing, so nothing stale reaches
  // the screen. The ref is what stops it looping: it only fires on the
  // false→true edge.
  const wasOpen = useRef(open);
  if (wasOpen.current !== open) {
    wasOpen.current = open;
    if (open) {
      setQ('');
      setTerm('');
    }
  }

  const onBenchKeys = useMemo(() => new Set(onBench), [onBench]);

  // The row and its search string, paired once.
  //
  // ⚠️ SERVER ORDER IS PRESERVED, AND THE CAP IS WHY IT MATTERS. The endpoint
  // returns most-used bullets first, so the drawn head of an unsearched list
  // is the part worth adding. Re-sorting here — alphabetically, say — would
  // turn the same cap into "every maker from A to C", which looks like a
  // catalogue that stops at C.
  const indexed = useMemo(
    () => bullets.map((b) => ({ b, key: bulletKey(b), hay: haystack(b) })),
    [bullets],
  );

  const filtered = useMemo(() => {
    const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return indexed;
    return indexed.filter((e) => matches(e.hay, words));
  }, [indexed, term]);

  const shown = filtered.length > DRAW_CAP ? filtered.slice(0, DRAW_CAP) : filtered;
  const truncated = filtered.length - shown.length;

  // The page owns the toast and the PUT, so adding is two calls: hand the
  // bullet up, then close. Closing here rather than leaving it to the page is
  // what the flow specifies ("tap adds and closes"); a page that also clears
  // its own open flag inside onAdd simply sets the same flag twice.
  const add = useCallback(
    (b: BenchBulletOption) => {
      onAdd(b);
      onClose();
    },
    [onAdd, onClose],
  );

  // OverlayShell has no `open` prop — mounting IS opening, because its
  // entrance is a mount animation. The flag on this contract is answered here.
  if (!open) return null;

  return (
    <OverlayShell
      variant={phone ? 'bottom-sheet' : 'modal'}
      labelledBy={titleId}
      onClose={onClose}
      style={
        phone
          ? // Pwa.dc.html's sheet height. The shell already supplies the fixed
            // box, the 92% cap, the flex column and the radii.
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
          Add a bullet
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
            Search bullets by calibre, maker, weight or type
          </label>
          <input
            id={searchId}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Calibre, maker, weight or type — try 308 150"
            autoComplete="off"
            spellCheck={false}
            // 44px is the §9 tap target; 16px is not a taste call either, iOS
            // zooms the whole page in on focus for anything smaller.
            style={phone ? { height: 44, padding: '0 12px', fontSize: 16 } : undefined}
          />
        </div>
      </div>

      {/*
        Above the list, not below it. A member who has not found their bullet
        gives up at the point of giving up — they do not scroll to the end of
        200 rows first to look for a footnote explaining that there are more.
      */}
      {!loading && truncated > 0 ? (
        <div
          style={{
            flex: 'none',
            padding: phone ? '0 16px 8px' : '0 20px 8px',
            fontSize: 12,
            color: 'var(--text-tertiary)',
          }}
        >
          Showing {shown.length} of {filtered.length} bullets — refine your search to see the rest.
        </div>
      ) : null}

      <div
        style={{
          borderTop: '0.5px solid var(--border-divider)',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          ...(phone
            ? // min-height 0 is load-bearing: without it the flex child refuses
              // to shrink below its content and the list grows past the sheet
              // instead of scrolling inside it.
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
              PowderPicker's, inlined so the bench bundle does not pull in
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
        ) : shown.length === 0 ? (
          <div style={{ padding: '22px 20px', fontSize: 13, color: 'var(--text-tertiary)' }}>
            {/*
              The list is filtered by `term`, so an empty list with an empty
              term is not a failed search — it is an empty list. Telling
              someone who has typed nothing that nothing matches sends them
              hunting for a typo they never made.
            */}
            {bullets.length === 0
              ? 'No bullets are loaded yet.'
              : term.trim()
                ? 'Nothing matches that calibre, maker, weight or type.'
                : 'No bullets to show.'}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map(({ b, key }) => {
              const added = onBenchKeys.has(key);
              const calibre = formatCalibre(b.calibreIn);

              // ⚠️ ALL FOUR PARTS, ALWAYS, AND THE CALIBRE FIRST. A bullet's
              // identity IS calibre + maker + weight + category — that is
              // literally what bulletKey() joins, and what the AND in the
              // results query matches on. Two Hornady 150 gr bullets in
              // different categories are different bullets, and so are two in
              // different calibres: .277" for a .270 and .308" for a .308 are
              // the same three words on the box and will not swap. A row that
              // printed only "Hornady 150 gr · SP" drew the same line four
              // times and left the member picking blind.
              const name = (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: 10,
                    // A flex item inside `.pick`, which is space-between: the
                    // name takes the room and the load count keeps its own.
                    flex: '1 1 auto',
                    minWidth: 0,
                  }}
                >
                  {/*
                    Written the way it is written on the box — .308", three
                    digits, leading dot, trailing double-quote — and column
                    aligned with tabular numerals so two rows differing only
                    here can be told apart at a glance rather than by reading.
                    The measure comes from the server; nothing is rounded here.
                  */}
                  {calibre ? (
                    <span
                      className="num"
                      style={{
                        flex: 'none',
                        minWidth: 54,
                        textAlign: 'center',
                        padding: '2px 6px',
                        border: '0.5px solid var(--border)',
                        borderRadius: 'var(--r-sm)',
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {calibre}
                    </span>
                  ) : (
                    // Said, not left blank: an empty slot in the one column
                    // the member is choosing between reads as "same as the row
                    // above" rather than as "we do not know".
                    <span
                      style={{
                        flex: 'none',
                        minWidth: 54,
                        fontSize: 11.5,
                        fontStyle: 'italic',
                        color: 'var(--text-tertiary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {CALIBRE_UNKNOWN}
                    </span>
                  )}
                  <span style={{ minWidth: 0 }}>
                    {b.maker}
                    <span className="num" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {' '}
                      · {b.weightGr} gr
                    </span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {' '}
                      · {b.category}
                    </span>
                  </span>
                </span>
              );

              // Already on the bench: a row, not a control. A disabled button
              // still sits in the accessibility tree as something to press;
              // this is a statement of fact instead.
              if (added) {
                return (
                  <li key={key}>
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
                <li key={key}>
                  <button
                    type="button"
                    className="pick"
                    onClick={() => add(b)}
                    style={phone ? { minHeight: 48, fontSize: 14 } : undefined}
                  >
                    {name}
                    {/* A count of loads, which is the reason to pick one bullet
                        over another. Never a count of anything underneath it. */}
                    <span
                      className="num"
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {b.loads} load{b.loads === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Main.dc.html only. The phone sheet is short and this is a nicety, so
          the prototype drops it there rather than eat a row of the list. */}
      {phone ? null : (
        <div
          style={{
            flex: 'none',
            padding: '10px 20px 16px',
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
          }}
        >
          A bullet is its calibre, maker, weight and type together, so the same maker and weight
          appears once per calibre — a 150 gr .308&quot; and a 150 gr .277&quot; are different
          bullets and will not swap.
        </div>
      )}

      {/* Filtering never moves focus, so the result count is announced — and
          the announcement carries the FULL match count, not the drawn one, for
          the same reason the line above the list does. */}
      <span role="status" aria-live="polite" className="sr-only">
        {loading
          ? 'Loading bullets'
          : truncated > 0
            ? `${filtered.length} bullets, showing the first ${shown.length}`
            : `${filtered.length} bullet${filtered.length === 1 ? '' : 's'}`}
      </span>
    </OverlayShell>
  );
}

export default BulletPicker;
