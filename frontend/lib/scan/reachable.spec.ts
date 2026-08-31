import { describe, expect, it } from 'vitest';
import { FLOOR_DPI, dpiOf } from './framing';
import {
  EDGE_MARGIN,
  TOO_SMALL,
  edgeMargin,
  guidanceFor,
  occupancy,
} from './guidance';
import type { Quad } from './geometry';
import { SHAPE_ORDER, acrossMm, guideAspect } from './shapes';

// ────────────────────────────────────────────────────────────────────
// ⚠️ EVERY DOCUMENT MUST BE CAPTURABLE ON EVERY VIEWFINDER.
//
// This suite exists because it was not. TOO_SMALL was an absolute fraction of
// FRAME AREA, 0.45, chosen as a proxy for "big enough to read". But a firearm
// licence is a LANDSCAPE card, and a phone viewfinder is PORTRAIT, so the card
// wastes the bands above and below it however well the member frames it:
//
//     max achievable occupancy      card    A4 / ID book
//     Samsung portrait               49%        91%
//     iPhone portrait                53%        84%
//     tall portrait viewfinder       30%        68%
//
// On a tall viewfinder the card could never reach 45%, so auto-capture was
// impossible for the most important document in the product. On the others it
// was reachable only by touching both side edges — the measured cliff, where
// detection scores 0/15.
//
// The lesson, and the reason this is a suite rather than one fixed number:
// occupancy of the frame is not a property of the document. It is a property
// of the document AND the viewport aspect, so it can never carry a
// requirement that belongs to the document alone.
// ────────────────────────────────────────────────────────────────────

const VIEWS: Array<[string, number, number]> = [
  ['Samsung portrait', 384, 494],
  ['iPhone portrait', 384, 456],
  ['tall portrait', 430, 900],
  ['landscape', 494, 384],
];

/** The document fitted into the viewport at `fill` of the largest it would go. */
function framed(aspect: number, vw: number, vh: number, fill: number): Quad {
  const w = Math.min(vw, vh * aspect) * fill;
  const h = (w / aspect);
  const x = (vw - w) / 2;
  const y = (vh - h) / 2;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

describe('every shape can actually be captured, on every viewfinder', () => {
  it('reaches ready somewhere between too small and the frame edge', () => {
    for (const [name, vw, vh] of VIEWS) {
      for (const shape of SHAPE_ORDER) {
        const aspect = guideAspect(shape)!;
        // Sweep the document from small to as large as the viewport allows and
        // find the fills that would fire the shutter.
        const ready: number[] = [];
        for (let fill = 0.3; fill <= 1.0001; fill += 0.01) {
          const q = framed(aspect, vw, vh, fill);
          const g = guidanceFor({
            occupancy: occupancy(q, vw, vh),
            edgeMargin: edgeMargin(q, vw, vh),
            locked: true,
            still: true,
            quad: q,
          });
          if (g === 'ready') ready.push(fill);
        }
        expect(
          ready.length,
          `${shape} can never be captured on ${name} (${vw}x${vh})`,
        ).toBeGreaterThan(0);
        // And not by a hair. A one-step window is a gate nobody can hold.
        expect(
          ready[ready.length - 1] - ready[0],
          `${shape} has only a ${ready.length}-step window on ${name}`,
        ).toBeGreaterThan(0.1);
      }
    }
  });

  it('never asks for closer and further at the same document size', () => {
    // The failure mode of two bounds that disagree: the member obeys one
    // instruction and immediately gets the other.
    for (const [name, vw, vh] of VIEWS) {
      for (const shape of SHAPE_ORDER) {
        const aspect = guideAspect(shape)!;
        let sawFurther = false;
        for (let fill = 0.3; fill <= 1.0001; fill += 0.01) {
          const q = framed(aspect, vw, vh, fill);
          const g = guidanceFor({
            occupancy: occupancy(q, vw, vh),
            edgeMargin: edgeMargin(q, vw, vh),
            locked: true,
            still: true,
            quad: q,
          });
          if (g === 'further') sawFurther = true;
          // Once we have been told to back off, growing further must never
          // start asking us to come closer again.
          if (sawFurther) {
            expect(g, `${shape} on ${name} flips back to closer at ${fill}`).not.toBe(
              'closer',
            );
          }
        }
      }
    }
  });
});

describe('the two bounds each do the job they are named for', () => {
  it('keeps every corner off the measured cliff', () => {
    const q = framed(1.586, 400, 500, 1.0); // a card filling its viewport
    expect(edgeMargin(q, 400, 500)).toBeLessThan(EDGE_MARGIN);
    expect(
      guidanceFor({ occupancy: 0.5, edgeMargin: edgeMargin(q, 400, 500), locked: true, still: true }),
    ).toBe('further');
  });

  it('leaves resolution to dpi, which knows the document size', () => {
    // A card at 20% of frame is comfortably above the detection floor and
    // still hundreds of dpi — occupancy must not second-guess that.
    expect(
      guidanceFor({ occupancy: 0.2, edgeMargin: 0.2, locked: true, still: true, dpi: 500 }),
    ).toBe('ready');
    // The same framing on an A4 is far too little resolution, and dpi is the
    // bound that can tell the difference.
    expect(
      guidanceFor({ occupancy: 0.2, edgeMargin: 0.2, locked: true, still: true, dpi: 140 }),
    ).toBe('closer');
  });

  it('puts the detection floor below what every shape can reach', () => {
    for (const [name, vw, vh] of VIEWS) {
      for (const shape of SHAPE_ORDER) {
        const q = framed(guideAspect(shape)!, vw, vh, 1);
        expect(
          occupancy(q, vw, vh),
          `${shape} cannot reach the detection floor on ${name}`,
        ).toBeGreaterThan(TOO_SMALL);
      }
    }
  });

  it('is reachable at 200 dpi on a 4K stream for every shape', () => {
    for (const shape of SHAPE_ORDER) {
      const across = acrossMm(shape)!;
      // The document spanning 60% of a 3024px short axis — well inside the
      // edge margin, well above the detection floor.
      expect(dpiOf(0.6 * 3024, across), `${shape}`).toBeGreaterThanOrEqual(FLOOR_DPI);
    }
  });
});
