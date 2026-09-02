'use client';

/**
 * THE BENCH — the bench rail, and the chip sections both shells share.
 *
 * Ported from Main.dc.html's "Bench rail" card. The three sections live in
 * their own exported component because the mobile bottom sheet (BenchSheet)
 * shows the SAME bench: two shells, one list. Copying the chip markup into the
 * sheet is exactly how the two surfaces drift apart, and a chip that behaves
 * differently on a phone is a safety problem, not a cosmetic one.
 *
 * ⚠️ A CHIP TOGGLES THIS SEARCH, NOT THE SAVED BENCH. onToggle only edits the
 * `off` set the page holds; nothing in this file calls a save. The saved bench
 * is changed solely through the Add flows, which the page wires to
 * PUT /bench/me. See the warning on OffState in contract.ts.
 */

import type { CSSProperties } from 'react';
import { useId } from 'react';
import type { BenchBullet } from '@/lib/bench/api';
import { bulletKey, type BenchRailProps } from './contract';
import { Chip, type BenchSize } from './primitives';

/** One string, two shells — the rail and the sheet must not word this apart. */
export const BENCH_HINT = 'Tap a chip to take it off the shelf for this search.';

/* ── Small parts ────────────────────────────────────────────────────── */

function CheckIcon() {
  return (
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
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/**
 * The bench persists the moment it changes, so the rail states that instead of
 * offering a Save button — which would imply the chips are unsaved edits, and
 * they are not saved at all.
 */
export function SavedBadge({ style }: { style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11.5,
        color: 'var(--success)',
        ...style,
      }}
    >
      <CheckIcon />
      Saved
    </span>
  );
}

const SECTION_HEAD: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const CHIP_ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

/**
 * "Hornady ELD Match" reads as the product; `category` ("HPBT") is the shape
 * family and is what bulletKey() is built from, so it is the fallback when a
 * bullet reached the bench without a product name.
 */
function bulletLabel(b: BenchBullet): string {
  return `${b.maker} ${b.type ?? b.category}`.trim();
}

/* ── The shared sections ────────────────────────────────────────────── */

/**
 * Powders / Bullets / Cartridges: an uppercase header carrying the count, a
 * wrapped run of chips, then a dashed Add.
 *
 * Not part of contract.ts. It takes BenchRailProps so the sheet can forward
 * its own props straight through — a mapping layer between the two shells is
 * one more place for them to disagree.
 *
 * `size` is the ONE thing the two shells legitimately disagree about, and the
 * shell is what knows: bench.css draws the 28px desktop chip and carries no
 * breakpoint, so the phone's 40px touch chip is applied per control by
 * primitives.Chip. It is a prop rather than a media query because the rail is
 * never on a phone and the sheet is never anywhere else — a breakpoint would
 * only be a second, disagreeing place to hold that same fact.
 */
export function BenchSections({
  bench,
  off,
  onToggle,
  onAddPowder,
  onAddBullet,
  onAddCartridge,
  size = 'desktop',
}: BenchRailProps & { size?: BenchSize }) {
  const uid = useId();

  return (
    <>
      <section aria-labelledby={`${uid}-powders`}>
        <h3 id={`${uid}-powders`} style={SECTION_HEAD}>
          Powders · {bench.powders.length}
        </h3>
        <div style={{ ...CHIP_ROW, marginBottom: 14 }}>
          {bench.powders.map((p) => (
            <Chip
              key={p.id}
              on={!off.powderIds.includes(p.id)}
              size={size}
              onClick={() => onToggle('powderIds', p.id)}
            >
              {p.name}
            </Chip>
          ))}
          {/* The three Adds read "Add, Add, Add" to a reader running the
              button list, so each one names its own shelf. The visible word
              stays "Add" — the section heading carries it for everyone else. */}
          <Chip add size={size} ariaLabel="Add powder" onClick={onAddPowder}>
            Add
          </Chip>
        </div>
      </section>

      <section aria-labelledby={`${uid}-bullets`}>
        <h3 id={`${uid}-bullets`} style={SECTION_HEAD}>
          Bullets · {bench.bullets.length}
        </h3>
        <div style={{ ...CHIP_ROW, marginBottom: 14 }}>
          {bench.bullets.map((b) => {
            // The key that is rendered and the key that is toggled come from
            // the same helper on purpose: two bullets can share a maker and a
            // product name and differ only by weight, so an ad-hoc key here
            // would switch off the wrong one.
            const key = bulletKey(b);
            return (
              <Chip
                key={key}
                on={!off.bullets.includes(key)}
                size={size}
                onClick={() => onToggle('bullets', key)}
              >
                {bulletLabel(b)}
                <span className="num" style={{ color: 'var(--text-tertiary)', fontSize: 11.5 }}>
                  {b.weightGr} gr
                </span>
              </Chip>
            );
          })}
          <Chip add size={size} ariaLabel="Add bullet" onClick={onAddBullet}>
            Add
          </Chip>
        </div>
      </section>

      <section aria-labelledby={`${uid}-cartridges`}>
        <h3 id={`${uid}-cartridges`} style={SECTION_HEAD}>
          Cartridges · {bench.cartridges.length}
        </h3>
        {/* No trailing margin: the rail closes on its card padding and the
            sheet on its own footer spacing, so one here would double up. */}
        <div style={CHIP_ROW}>
          {bench.cartridges.map((c) => (
            <Chip
              key={c.key}
              on={!off.cartridgeKeys.includes(c.key)}
              size={size}
              onClick={() => onToggle('cartridgeKeys', c.key)}
            >
              {c.name}
            </Chip>
          ))}
          <Chip add size={size} ariaLabel="Add cartridge" onClick={onAddCartridge}>
            Add
          </Chip>
        </div>
      </section>
    </>
  );
}

/* ── The rail ───────────────────────────────────────────────────────── */

export default function BenchRail(props: BenchRailProps) {
  return (
    /* `bench` is repeated here even though the page root carries it. Every
       control below is styled by a `.bench .x` descendant rule, so a rail
       mounted outside that root would render as bare buttons — wrong, but not
       obviously wrong. Nesting the class costs nothing and removes the trap.

       ⚠️ ...and for the same reason the rail does NOT wear `.scroll`. That
       rule is `.bench .scroll` — a DESCENDANT selector — so on this element,
       which carries `.bench` itself, it only matches by way of an outer
       `.bench` ancestor: precisely the ancestor this line refuses to assume.
       The overflow is therefore written here, where it cannot silently fail. */
    <aside
      className="bench"
      aria-label="My bench"
      style={{
        width: 280,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        paddingBottom: 16,
        overflowY: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <div className="head" style={{ fontSize: 15 }}>
            My bench
          </div>
          <SavedBadge />
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          {BENCH_HINT}
        </p>

        <BenchSections {...props} />
      </div>
    </aside>
  );
}
