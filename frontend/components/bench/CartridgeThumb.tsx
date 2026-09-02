'use client';

/**
 * THE BENCH — the list silhouette.
 *
 * The small cartridge outline that heads a results group and sits beside an
 * open load. Silhouette only: no dimension lines, no letters, no labels — the
 * spec card is where a figure is read, and a thumbnail carrying numbers at
 * 30 px tall would only invite squinting at them.
 *
 * Purely decorative, so it is `aria-hidden`: the group header next to it
 * already names the cartridge, and a screen reader gets nothing from a shape.
 */

import { canDraw, thumbOf } from '@/lib/bench/geometry';
import type { CartridgeThumbProps } from './contract';

/* ── The brass and the copper ────────────────────────────────────────
   These two are the only colours on the Bench that globals.css does not
   name, and neither this file nor the drawing may add tokens to a shared
   stylesheet. So each is MIXED from tokens that do exist. Rules that make
   this the only safe way to do it:

     · no raw hex and no rgb/hsl literals anywhere on this surface;
     · never `var(--gold)18` to tint — concatenating alpha onto a var()
       yields an invalid colour, which computes to TRANSPARENT, i.e. an
       invisible cartridge that no one notices until it ships.

   Each mix was checked against the prototype's swatches — case D9BF7A on
   8C7440, bullet B87333 on 7A4A20 — and lands within a few units of each
   channel. Those four are recorded here so the mixes can be re-verified
   later; they are documentation, not values this file may use.

   Exported because the 2D drawing must use the same brass; a thumbnail and
   its own spec card in two different golds reads as a bug.
   ─────────────────────────────────────────────────────────────────── */

/** Cartridge brass: warm, light, slightly greyed. */
export const CASE_FILL =
  'color-mix(in srgb, color-mix(in srgb, var(--gold-tag-fill) 56%, var(--border)) 92%, var(--text-secondary))';

/** The brass outline — the same gold pulled down toward the body ink. */
export const CASE_STROKE = 'color-mix(in srgb, var(--gold) 68%, var(--text-secondary))';

/** Gold walked toward red: the base both copper values are mixed from. */
const COPPER = 'color-mix(in srgb, var(--gold) 70%, var(--red))';

/** Jacket copper. */
export const BULLET_FILL = `color-mix(in srgb, ${COPPER} 85%, var(--border))`;

/** The copper outline. */
export const BULLET_STROKE = `color-mix(in srgb, ${COPPER} 50%, var(--text-secondary))`;

/**
 * 128×30 in lists, 96×24 on mobile — both drawn from the same 128×30
 * viewBox that `thumbOf` fixes, so the mobile thumbnail is the desktop one
 * scaled rather than a second, subtly different silhouette.
 */
const SIZES = {
  desktop: { w: 128, h: 30 },
  mobile: { w: 96, h: 24 },
} as const;

/* Exported both ways on purpose: ResultsList imports it by name, a spec card
   reaches for the default. One of the two would otherwise be a build break
   found by whoever wired their card up second. */
export function CartridgeThumb({ dims, size = 'desktop', className }: CartridgeThumbProps) {
  /* ⚠️ ALL THIRTEEN FIGURES OR NOTHING. A partial set does not fail visibly —
     a missing shoulder diameter collapses that vertex onto its neighbour and
     the result is a smooth, confident, WRONG cartridge. Drawing nothing is
     the honest outcome, and the caller's text fallback covers it. The prop is
     typed `Partial<Dims>`, and the API hands these over as a loose record, so
     this guard is doing real work rather than satisfying the compiler. */
  if (!canDraw(dims)) return null;

  const { casePath, bulletPath, thumbBox } = thumbOf(dims);
  const { w, h } = SIZES[size];

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={thumbBox}
      aria-hidden="true"
      focusable="false"
      /* `flex: none` because every caller drops this into a flex row beside a
         name that will happily squash it to nothing. */
      style={{ flex: 'none' }}
    >
      <path d={casePath} strokeWidth={0.7} style={{ fill: CASE_FILL, stroke: CASE_STROKE }} />
      <path d={bulletPath} strokeWidth={0.7} style={{ fill: BULLET_FILL, stroke: BULLET_STROKE }} />
    </svg>
  );
}

export default CartridgeThumb;
