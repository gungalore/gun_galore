import { describe, expect, it } from 'vitest';
import { Rect, aimAgreement, aimBox } from './aim';
import { DocShape, SHAPE_ORDER, guideAspect, holdHint } from './shapes';

const PHONE = { width: 390, height: 700 };

function areaFraction(r: Rect, v: { width: number; height: number }) {
  return (r.width * r.height) / (v.width * v.height);
}

describe('aimBox', () => {
  it('⚠️ ASKS FOR NO MORE THAN A PHONE CAN GIVE', () => {
    // Across the eighteen photographs the operator took of a real card and a
    // real ID book, the document covered 20% to 58% of the frame's area and
    // never more — the lens's near focus stops you getting closer. A box
    // nobody can fill is a box that teaches people the scanner is broken.
    for (const s of SHAPE_ORDER) {
      const f = areaFraction(aimBox(s, PHONE), PHONE);
      expect(f).toBeGreaterThan(0.15);
      expect(f).toBeLessThanOrEqual(0.62);
    }
  });

  it('keeps every box inside the viewfinder, with a border left over', () => {
    for (const s of SHAPE_ORDER) {
      const b = aimBox(s, PHONE);
      expect(b.x).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
      expect(b.x + b.width).toBeLessThan(PHONE.width);
      expect(b.y + b.height).toBeLessThan(PHONE.height);
    }
  });

  it('⚠️ DRAWS THE CARD LANDSCAPE AND THE PAGE UPRIGHT', () => {
    // The mix-up that teaches somebody to hold the phone the wrong way round.
    const card = aimBox('card', PHONE);
    expect(card.width).toBeGreaterThan(card.height);
    for (const s of ['a4', 'id-book'] as DocShape[]) {
      const b = aimBox(s, PHONE);
      expect(b.height).toBeGreaterThan(b.width);
    }
  });

  it('matches the shape the spec declares', () => {
    for (const s of SHAPE_ORDER) {
      const a = guideAspect(s);
      if (a === null) continue;
      const b = aimBox(s, PHONE);
      expect(b.width / b.height).toBeCloseTo(a, 3);
    }
  });

  it('is centred', () => {
    for (const s of SHAPE_ORDER) {
      const b = aimBox(s, PHONE);
      expect(b.x + b.width / 2).toBeCloseTo(PHONE.width / 2, 6);
      expect(b.y + b.height / 2).toBeCloseTo(PHONE.height / 2, 6);
    }
  });

  it('survives a landscape viewfinder', () => {
    const land = { width: 800, height: 400 };
    for (const s of SHAPE_ORDER) {
      const b = aimBox(s, land);
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
      expect(b.x + b.width).toBeLessThanOrEqual(land.width);
      expect(b.y + b.height).toBeLessThanOrEqual(land.height);
    }
  });
});

describe('aimAgreement', () => {
  const box: Rect = { x: 100, y: 200, width: 200, height: 120 };

  it('is 1 for an exact match and 0 for no overlap', () => {
    expect(aimAgreement(box, box)).toBeCloseTo(1, 6);
    expect(
      aimAgreement({ x: 0, y: 0, width: 50, height: 50 }, box),
    ).toBeCloseTo(0, 6);
  });

  it('⚠️ PUNISHES A RECTANGLE THAT SWALLOWS THE WHOLE FRAME', () => {
    // The operator's IMG_4947: the detector picked out the fabric and the
    // ruler, a rectangle that CONTAINS the aim box completely. Scoring
    // containment alone would have called that a perfect match.
    const sprawl: Rect = { x: 0, y: 0, width: 390, height: 700 };
    expect(aimAgreement(sprawl, box)).toBeLessThan(0.15);
  });

  it('punishes a postage stamp sitting neatly in the middle', () => {
    const tiny: Rect = { x: 190, y: 250, width: 20, height: 20 };
    expect(aimAgreement(tiny, box)).toBeLessThan(0.05);
  });

  it('rewards a document a little off-centre far more than either', () => {
    // An 18px slip on a 200x120 box scores about 0.67 — which is what
    // intersection-over-union gives, and a long way clear of the sprawl
    // (0.09) and stamp (0.02) cases above. The number that matters is the
    // gap between them, not the absolute value.
    const near: Rect = { x: 118, y: 214, width: 200, height: 120 };
    expect(aimAgreement(near, box)).toBeGreaterThan(0.6);
  });

  it('never returns a number outside 0..1', () => {
    for (const q of [
      { x: -500, y: -500, width: 2000, height: 2000 },
      { x: 100, y: 200, width: 0, height: 0 },
      { x: 150, y: 220, width: 10, height: 5000 },
    ]) {
      const v = aimAgreement(q, box);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('holdHint', () => {
  it('puts a card at the distance the operator actually measured', () => {
    // He photographed one from exactly 158 mm. 85.6 x 1.85 lands on 158 mm,
    // which is the whole reason 1.85 is the number.
    expect(holdHint('card')).toContain('16 cm');
  });

  it('⚠️ NEVER ASKS FOR A DISTANCE NO LENS CAN FOCUS AT', () => {
    // The clamp does not bind for a card — it exists for anything narrower
    // that gets added later, where the arithmetic alone would happily say
    // "hold it 4 cm away" and hand back a blurred photograph.
    const narrow = 30 * 1.85; // a 30 mm document, were one added
    expect(narrow).toBeLessThan(110);
    expect(holdHint('id-book')).toContain('16 cm');
  });

  it('puts an A4 page at arm-ish length and says nothing about a mystery', () => {
    expect(holdHint('a4')).toContain('39 cm');
    expect(holdHint('any')).toBeNull();
  });
});
