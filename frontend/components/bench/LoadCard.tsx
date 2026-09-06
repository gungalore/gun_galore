'use client';

/**
 * THE BENCH — the load card.
 *
 * One consolidated load, opened on top of the finder. Desktop is the centred
 * 760px modal from `Main.dc.html`; the phone is the bottom sheet from
 * `Pwa.dc.html`. Same content, same order, same copy — only the frame differs,
 * and the frame is OverlayShell's `variant`.
 *
 * ⚠️ NOTHING HERE NAMES WHERE A FIGURE COMES FROM (operator ruling,
 * 2026-09-02). The vocabulary is start charge / max charge / the maximum, and
 * the safety line is the SAFETY_LINE constant rather than copy retyped here —
 * see the note on it in contract.ts.
 *
 * Presentational only. Every figure arrives on props and every action is a
 * callback; the page owns the state and does the fetching.
 */

import { useMemo } from 'react';

import { SAFETY_LINE, projectileName, type LoadCardProps } from './contract';
import { Btn, IconX, OverlayShell, Tag, type BenchSize, usePhone } from './primitives';
import CartridgeThumb from './CartridgeThumb';
import CoalGauge from './CoalGauge';
import LoadChart from './LoadChart';
import {
  DIM_KEYS,
  canDraw,
  coalCheck,
  fmtVelocity,
  type Dims,
  type Units,
} from '@/lib/bench/geometry';
import type { CartridgeHead } from '@/lib/bench/api';

/* ── Which board this card is drawn from ────────────────────────────── */

/**
 * SPEC §5.4: the overlay frame flips at 768 — bottom sheet below it, centred
 * modal at and above it — and the installed app always gets the sheet.
 *
 * ⚠️ THE ONE PLACE IN THIS MODULE THAT NEEDS JS FOR A BREAKPOINT. Everything
 * else (ResultsList's rows, the group headers) renders both layouts and hides
 * one with `md:`, which is cheaper and SSR-exact. That trick cannot work here:
 * two OverlayShells would mount two dialogs, two focus traps and two entries
 * on the Escape stack, and the hidden one would still be answering keys.
 *
 * `false` until mounted, so the server and the first client render agree.
 *
 * ⚠️ THE FLIP MUST BE RIGHT IN THE FIRST RENDER. Mounting on a click does not
 * save it: resolve the breakpoint in an effect and the phone shows one frame
 * of the 760px two-column modal — squeezed to 358px, with the 340px chart
 * hanging out of it — before it snaps to the sheet. usePhone (primitives.tsx)
 * reads the media query through useSyncExternalStore, so the first render is
 * already correct and there is no frame to catch.
 */



/* ── Helpers ────────────────────────────────────────────────────────── */

/**
 * The API hands the silhouette figures back as a loose record with nulls for
 * whatever the reference sheet did not carry; the drawing wants
 * `number | undefined`. Dropping the nulls here rather than casting is what
 * lets canDraw() do its job — a partial profile does not fail visibly, it
 * draws a confident wrong shape, so the gap has to stay visible to it.
 */
function dimsOf(thumb: CartridgeHead['thumb']): Partial<Dims> | null {
  if (!thumb) return null;
  const out: Partial<Dims> = {};
  for (const k of DIM_KEYS) {
    const v = thumb[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Charges stay in grains under both unit systems; only velocity flips. */
function velocityText(fps: number | null, units: Units): string {
  return fps === null ? '—' : fmtVelocity(fps, units);
}

/* ── Figure tile ────────────────────────────────────────────────────── */

function ChargeTile({
  label,
  gr,
  fps,
  units,
  size,
  ceiling,
}: {
  label: string;
  gr: number;
  fps: number | null;
  units: Units;
  size: BenchSize;
  /**
   * The max charge.
   *
   * ⚠️ THE TWO TILES USED TO DIFFER ONLY BY WEIGHT, AND THE HEAVIER ONE READ AS
   * THE RECOMMENDED ONE. It is the opposite: it is the ceiling a work-up stops
   * at. The gold line and the sub-line say so in words as well as in colour —
   * gold, never red, because red on this screen means "the thing to press".
   */
  ceiling?: boolean;
}) {
  const phone = size === 'mobile';
  return (
    <div
      style={{
        padding: 12,
        border: `0.5px solid ${ceiling ? 'var(--gold-line)' : 'var(--border)'}`,
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-inset)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </div>
      {/* SPEC §5.3 type ramp: the figures are 28 on desktop, 26 on the phone,
          Archivo 600 (.head) and tabular (.num) so start and max line up. */}
      <div className="num head" style={{ fontSize: phone ? 26 : 28, marginTop: 4, lineHeight: 1 }}>
        {gr.toFixed(1)}{' '}
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>gr</span>
      </div>
      <div
        className="num"
        style={{ fontSize: phone ? 12 : 12.5, color: 'var(--text-secondary)', marginTop: 6 }}
      >
        {velocityText(fps, units)}
      </div>
      {ceiling && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
          ceiling, not a target
        </div>
      )}
    </div>
  );
}

/* ── The card ───────────────────────────────────────────────────────── */

export function LoadCard({
  units,
  row,
  cartridge,
  weightGr,
  onClose,
  onLog,
  onSpec,
}: LoadCardProps) {
  const phone = usePhone();
  const size: BenchSize = phone ? 'mobile' : 'desktop';
  // Scoped to the row so two cards in one session never collide on the id
  // OverlayShell uses to find the title and move focus to it.
  const titleId = `bench-load-title-${row.id}`;

  /**
   * The COAL tags, in the prototype's order and wording.
   *
   * ⚠️ THE TOP OF A RANGE IS WHAT HAS TO CLEAR THE MAXIMUM. Checking the low
   * end passes a load whose long end will not chamber. Where the maximum is
   * unknown the millimetres cannot be computed, so the server's own flags are
   * shown as plain text instead of dropped — a warning that quietly vanishes
   * because one figure is missing is the worst of the three outcomes.
   */
  const tags = useMemo(() => {
    const out: { t: string; warn: boolean }[] = [];
    const hi = row.coalHiMm ?? row.coalMm;
    const max = cartridge.maxLengthMm;
    if (hi !== null && max !== null) {
      const c = coalCheck(hi, max);
      if (c.bad) out.push({ t: c.t, warn: true });
    } else if (row.flags.includes('COAL_OVER_MAX')) {
      out.push({ t: 'COAL OVER MAX', warn: true });
    } else if (row.flags.includes('COAL_NEAR_MAX')) {
      out.push({ t: 'COAL NEAR MAX', warn: true });
    }
    /* ⚠️ THE SERVER'S FLAG, NOT `coalHiMm !== null`. The band is set by one
       rule at one end; re-deriving it from the presence of a high figure gave
       the card a different answer from the results row behind it and the log
       in front of it, for the same load. */
    if (row.flags.includes('COAL_RANGE')) {
      out.push({ t: 'COAL RANGE', warn: false });
    }
    return out;
  }, [row.coalHiMm, row.coalMm, row.flags, cartridge.maxLengthMm]);

  const dims = useMemo(() => dimsOf(cartridge.thumb), [cartridge.thumb]);

  /* The pieces both frames share, built once. */

  const heading = (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        {cartridge.name} · {weightGr} gr
      </div>
      <div id={titleId} className="head" style={{ fontSize: phone ? 18 : 20, marginTop: 2 }}>
        {projectileName(row)}{' '}
        <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>with</span> {row.powder}
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {tags.map((f) => (
            <Tag key={f.t} warn={f.warn}>
              {f.t}
            </Tag>
          ))}
        </div>
      )}
    </>
  );

  const tiles = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: phone ? 8 : 10,
      }}
    >
      <ChargeTile
        label="Start charge"
        gr={row.startGr}
        fps={row.startFps}
        units={units}
        size={size}
      />
      <ChargeTile
        label="Max charge"
        gr={row.maxGr}
        fps={row.maxFps}
        units={units}
        size={size}
        ceiling
      />
    </div>
  );

  const gauge = (
    <CoalGauge
      units={units}
      coalMm={row.coalMm}
      maxLengthMm={cartridge.maxLengthMm}
      coalLoMm={row.coalLoMm}
      coalHiMm={row.coalHiMm}
    />
  );

  const chart = (
    <LoadChart
      units={units}
      startGr={row.startGr}
      startFps={row.startFps}
      maxGr={row.maxGr}
      maxFps={row.maxFps}
      animate
    />
  );

  const actions = (
    <>
      <Btn red size={size} onClick={onLog} style={phone ? { flex: 1 } : undefined}>
        Log this load
      </Btn>
      <Btn size={size} onClick={onSpec} style={phone ? { flex: 1 } : undefined}>
        Cartridge spec
      </Btn>
    </>
  );

  /**
   * ⚠️ ABOVE THE BUTTONS, AT BODY SIZE. It used to sit in an 11.5px footer bar
   * in `--text-tertiary` — the smallest, faintest type on a card whose two
   * biggest figures are a charge window, which is the one sentence on the
   * screen that has to be read before either of them is acted on. Still once
   * per card, still SAFETY_LINE verbatim.
   */
  const safety = (
    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
      {SAFETY_LINE}
    </p>
  );

  /* ── Phone: bottom sheet ──────────────────────────────────────────── */

  if (phone) {
    return (
      <OverlayShell variant="bottom-sheet" labelledBy={titleId} onClose={onClose}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '4px 4px 10px 16px',
            flex: 'none',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>{heading}</div>
          <IconX label="Close" size="mobile" glyph={18} onClick={onClose} />
        </div>

        <div
          className="scroll"
          style={{
            // minHeight:0 is load-bearing. A flex item's default
            // min-height:auto refuses to shrink below its content, so without
            // it the body pushes past the shell's 92% cap and `overflow:
            // hidden` clips the safety line away instead of letting it scroll.
            flex: '1 1 auto',
            minHeight: 0,
            // The home indicator sits over the last ~34px of the screen on a
            // notched iPhone, and this column ends in the two buttons.
            padding: '0 16px calc(28px + env(safe-area-inset-bottom))',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {tiles}
          {gauge}
          {chart}
          {safety}
          <div style={{ display: 'flex', gap: 8 }}>{actions}</div>
        </div>
      </OverlayShell>
    );
  }

  /* ── Desktop: centred modal ───────────────────────────────────────── */

  return (
    <OverlayShell
      variant="modal"
      labelledBy={titleId}
      onClose={onClose}
      // The header and the safety footer are pinned and the two columns
      // between them scroll, so the panel itself must not — `.bench-modal`
      // sets max-height: calc(100vh - 48px) with overflow: hidden.
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          padding: '18px 20px 12px',
          borderBottom: '0.5px solid var(--border-divider)',
        }}
      >
        {/* Only when all thirteen figures are there. A silhouette built from a
            partial sheet collapses the missing vertex onto its neighbour and
            draws a different cartridge, perfectly confidently. */}
        {canDraw(dims) && (
          <div style={{ flex: 'none', marginTop: 4 }}>
            <CartridgeThumb dims={dims} size="desktop" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>{heading}</div>
        <IconX label="Close" onClick={onClose} style={{ flex: 'none' }} />
      </div>

      {/* The same minHeight:0 the sheet's body needs, and for the same
          reason. `.bench-modal` caps itself at calc(100vh - 48px) and hides
          the overflow, and this card is ~430px of content: a browser window
          shorter than that — a phone or small tablet in LANDSCAPE is over the
          768 breakpoint, so it lands here at ~390px tall — would clip the
          safety line off the bottom with no way to scroll to it. The column
          scrolls instead. Nothing moves at heights where it already fits. */}
      <div
        className="scroll"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 0,
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderRight: '0.5px solid var(--border-divider)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {tiles}
          {gauge}
          {/* marginTop:auto pins the safety line and the actions to the foot of
              the column so the two halves of the grid finish level whatever
              height the gauge and the chart settle at. */}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {safety}
            <div style={{ display: 'flex', gap: 8 }}>{actions}</div>
          </div>
        </div>

        <div style={{ padding: '16px 20px', minWidth: 0 }}>{chart}</div>
      </div>
    </OverlayShell>
  );
}

export default LoadCard;
