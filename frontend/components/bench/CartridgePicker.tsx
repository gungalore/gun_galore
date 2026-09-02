'use client';

/**
 * THE BENCH — "Add a cartridge".
 *
 * The third Add flow, and the one whose absence broke the screen: the finder
 * is an AND across powder, bullet AND cartridge, so a bench with powders and
 * bullets but no cartridge returns nothing, for ever. For a while all three
 * rail buttons opened the powder picker, which made this axis unreachable and
 * the results permanently empty (see the banner on BenchCartridgeOption in
 * contract.ts).
 *
 * Purely presentational, exactly like PowderPicker: the page owns the list,
 * the loading flag, the bench snapshot, the PUT and the toast. This file owns
 * the search box and the matching — Escape, the focus trap and the return of
 * focus all come from OverlayShell, so the overlays cannot drift apart.
 *
 * Both prototypes in one component, because CartridgePickerProps carries no
 * variant flag: the 420px centred modal from Main.dc.html at 768 and above,
 * the 70%-tall bottom sheet from Pwa.dc.html below it and in the installed
 * app.
 *
 * As in PowderPicker, cartridges already on the bench stay in place and are
 * shown as added rather than removed from the list — `onBench` exists for
 * exactly that. A member who searches "6,5 Creedmoor" moments after adding it
 * and gets an empty list has been told, wrongly, that we do not have it.
 *
 * ⚠️ COPY. Operator ruling 2026-09-02: nothing here may name where a figure
 * comes from. The count on each row is CONSOLIDATED LOADS — "n loads" — and
 * never a count of anything underneath them.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BenchCartridgeOption, CartridgePickerProps } from './contract';
import { IconX, OverlayShell, usePhone } from './primitives';

/**
 * ~165 cartridges is short enough to filter in the browser and long enough
 * that doing it on every keystroke is felt on a phone. The input stays
 * controlled — typing is never delayed — and only the list waits. 160ms sits
 * under --dur-fast, so the pause reads as the list settling rather than lag.
 */
const SEARCH_DEBOUNCE_MS = 160;

/**
 * 🚨 THE MOST IMPORTANT FUNCTION IN THIS FILE.
 *
 * Cartridge names are stored as the reference files print them, which is with
 * a EUROPEAN DECIMAL COMMA: "6,5 Creedmoor", "7,62 x 54 R", "9,3 x 62". A
 * South African member typing the most popular cartridge on the site will
 * write "6.5 creedmoor" with a full stop as often as not, and plenty will
 * write "65 creedmoor" with neither. A plain substring match finds the
 * cartridge for exactly one of those three spellings and leaves the other two
 * staring at "Nothing matches that name" — which, on a screen whose whole job
 * is to stop the bench being empty, is the same bug wearing a different hat.
 *
 * So both sides of the comparison are folded down to letters and digits: the
 * separator a member reaches for stops mattering, and "7.62x54r", "7,62 x 54
 * R" and "762 54 r" all land on the same needle. This is deliberately the
 * same character class the server's own cartridgeKey() uses — that helper is
 * why `key` is already "65creedmoor" — so the two ends of the wire agree on
 * what counts as punctuation.
 *
 * The x between the two figures of a metric name is a LETTER, not punctuation,
 * and is left alone deliberately: "7,62 x 54 R" is found by "7.62x54r" and by
 * "7,62 x 54 R", but not by "762 54 r". Folding it away as well would start
 * running "6x47" and "647" into one another for no case anybody has asked for.
 *
 * ⚠️ WHICH IS WHY THE TYPOGRAPHIC × IS FOLDED ONTO THE ASCII x FIRST, AND IS
 * THE ONE CHARACTER THAT IS. U+00D7 is not in [a-z], so the strip below would
 * DELETE it and run the two halves together: a member who pastes "7,62 × 54 R"
 * off a spec sheet folds to "76254r", the stored name folds to "762x54r", and
 * the two never meet — the comma bug again, in a different character. Mapping
 * it onto the letter it stands for makes the two spellings identical without
 * touching the "6x47" vs "647" distinction the paragraph above protects, and
 * it works in both directions, so a name that ever arrives with × is still
 * found by someone typing x.
 *
 * ⓘ KNOWN GAP, and a decision rather than an oversight: cartridgeKey() also
 * drops a "mm" that follows a figure and this does not, so a pasted
 * "7.62x54mm" does not find "7,62 x 54 R". Searching the name AND the expanded
 * key already covers the names that carry the unit — "9mm" finds "9 mm Luger"
 * through the name, "10 auto" finds "10 mm Auto" through the key — so the gap
 * is narrow, and closing it changes matching for every row. Pinned in
 * CartridgePicker.spec.tsx so it stays a choice.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    // × is ×, written as an escape rather than as itself: a regex whose
    // behaviour depends on one non-ASCII byte surviving every editor and
    // re-encoding this file meets is a regex that silently matches nothing.
    .replace(/\u00d7/g, 'x')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The one string a cartridge is matched against.
 *
 * Exported, with fold(), because CartridgePicker.spec.tsx pins the three
 * spellings of the most-loaded cartridge on the site against these two
 * functions rather than against a copy of them — a spec that rebuilds the
 * haystack itself proves only that the spec can spell.
 */
export function cartridgeHay(c: { name: string; key: string }): string {
  return `${fold(c.name)} ${fold(c.key)}`;
}

/** A cartridge with its match text worked out once, not once per keystroke. */
interface Candidate {
  c: BenchCartridgeOption;
  /**
   * The folded name AND the key. They are not the same string: the key is
   * built by cartridgeKey(), which expands the common abbreviations, so a
   * cartridge printed ".308 Win." carries the key "308winchester". Searching
   * both means a member who types the full word finds it, and one who types
   * what is on the box finds it too.
   */
  hay: string;
}

export function CartridgePicker({
  open,
  cartridges,
  loading,
  onBench,
  onClose,
  onAdd,
}: CartridgePickerProps) {
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
  // and comes back for a second cartridge should not have to clear a stale
  // term first.
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

  // Folded once per list rather than once per keystroke — 165 rows × two
  // regex passes on every letter typed is work nobody needs to pay for.
  const candidates = useMemo<Candidate[]>(
    () => cartridges.map((c) => ({ c, hay: cartridgeHay(c) })),
    [cartridges],
  );

  const filtered = useMemo(() => {
    const needle = fold(term);
    // A needle that folds away to nothing — a lone comma, a stray full stop —
    // is not a search for everything's worth of punctuation, it is a member
    // mid-keystroke. Show the whole list rather than nothing.
    if (!needle) return candidates;
    return candidates.filter((x) => x.hay.includes(needle));
  }, [candidates, term]);

  // The page owns the toast and the PUT, so adding is two calls: hand the
  // cartridge up, then close. Closing here rather than leaving it to the page
  // is what the flow specifies ("tap adds and closes").
  const add = useCallback(
    (c: BenchCartridgeOption) => {
      onAdd(c);
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
          Add a cartridge
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
            Search cartridges
          </label>
          <input
            id={searchId}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            // Short on purpose: a phone input truncates anything longer, and
            // the punctuation hint below is a nicety, not the fix. The fix is
            // that fold() makes it true whether or not anyone reads it.
            placeholder="Search cartridges"
            autoComplete="off"
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
              PowderPicker's, inlined so the bench bundle does not pull in
              components/skeleton.tsx. animate-pulse is an opacity keyframe, so
              the global box-shadow killswitch does not reach it.
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
                    width: i % 2 === 0 ? '58%' : '44%',
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
              Three different facts, three different sentences. An empty list
              with an empty box is not a failed search, and telling someone who
              has typed nothing that nothing matches sends them hunting for a
              typo they never made.
            */}
            {cartridges.length === 0
              ? 'No cartridges are loaded yet.'
              : term.trim()
                ? 'Nothing matches that name.'
                : 'No cartridges to show.'}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.map(({ c }) => {
              const added = onBenchKeys.has(c.key);

              // Consolidated loads, which is the reason to reach for one
              // cartridge over another. Not finite or not positive means we
              // have nothing to say — printing "0 loads" beside a row that is
              // on the list precisely because it HAS loads would be inventing
              // a fact out of a missing one.
              const n = c.loads;
              const hint =
                Number.isFinite(n) && n > 0 ? `${n} load${n === 1 ? '' : 's'}` : null;

              // Already on the bench: a row, not a control. A disabled button
              // still sits in the accessibility tree as something to press;
              // this is a statement of fact instead.
              if (added) {
                return (
                  <li key={c.key}>
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
                      <span>{c.name}</span>
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
                <li key={c.key}>
                  <button
                    type="button"
                    className="pick"
                    onClick={() => add(c)}
                    style={phone ? { minHeight: 48, fontSize: 14 } : undefined}
                  >
                    <span>{c.name}</span>
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
          the prototype drops it there rather than eat a row of the list. The
          line is worth its space here: the names are printed with a decimal
          comma, and a member who does not know that needs telling once that it
          makes no difference what they type. */}
      {phone ? null : (
        <div
          style={{
            flex: 'none',
            padding: '10px 20px 16px',
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
          }}
        >
          Commas, full stops and spaces are ignored while you search, so 6,5 Creedmoor, 6.5
          Creedmoor and 65 creedmoor all find the same cartridge.
        </div>
      )}

      {/* Filtering never moves focus, so the result count is announced. */}
      <span role="status" aria-live="polite" className="sr-only">
        {loading
          ? 'Loading cartridges'
          : `${filtered.length} cartridge${filtered.length === 1 ? '' : 's'}`}
      </span>
    </OverlayShell>
  );
}

export default CartridgePicker;
