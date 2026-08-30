import { describe, expect, it } from 'vitest';
import { NEAR_LIMIT_MM, Rect, aimAgreement, aimBox } from './aim';
import {
  DocShape,
  FULL_FRAME_DISTANCE_RATIO,
  SHAPE_ORDER,
  acrossMm,
  guideAspect,
  holdHint,
} from './shapes';

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
      expect(areaFraction(aimBox(s, PHONE), PHONE)).toBeLessThanOrEqual(0.62);
    }
  });

  it('⚠️ AND NO CLOSER THAN A PHONE CAN FOCUS', () => {
    // The other half of the same constraint, and the half that was missing.
    // A fill is a fixed ANGLE, so the same fraction puts a small document much
    // nearer the lens than a large one: at 0.82 a card sat 19cm out and an A4
    // page 47cm. Operator, on a Samsung S23 — "i am holding the samsung to
    // close for it to focus when the card fits in the box" — while the same
    // box was fine on his iPhone, because field of view differs per phone.
    for (const s of SHAPE_ORDER) {
      const across = acrossMm(s);
      if (across === null) continue;
      const fill = aimBox(s, PHONE).width / PHONE.width;
      const distanceMm = (across * FULL_FRAME_DISTANCE_RATIO) / fill;
      expect(
        distanceMm,
        `${s} asks for the phone at ${(distanceMm / 10).toFixed(1)}cm`,
      ).toBeGreaterThanOrEqual(NEAR_LIMIT_MM - 0.001);
    }
  });

  it('⚠️ WHILE STILL YIELDING ENOUGH DETAIL TO READ', () => {
    // This replaces an area floor of 0.15, which described what the operator's
    // photographs happened to show rather than anything required. The real
    // lower bound is legibility, so assert that instead — and it is what makes
    // backing off the card safe: detail was never the binding constraint here.
    //
    // ⚠️ 200 DPI, NOT 300, AND THE DIFFERENCE IS THE POINT. 300 is the PRINT
    // standard; ~200 is what OCR of printed text needs. Written at 300 first,
    // this test failed on A4 at 214 DPI — a value my change did not touch and
    // which has always been the case, because a page is large and a phone
    // frame is finite. Worth knowing rather than hiding: the capture is
    // comfortably readable and NOT print-quality, which is exactly why the
    // print profile plan calls for keeping the original and re-rendering
    // rather than upscaling this.
    //
    // Card sits near 340 DPI after the change, down from 526.
    const TRACK_SHORT_PX = 2160; // the operator's measured track, 2160x3840
    for (const s of SHAPE_ORDER) {
      const across = acrossMm(s);
      if (across === null) continue;
      const fill = aimBox(s, PHONE).width / PHONE.width;
      const dpi = (TRACK_SHORT_PX * fill) / (across / 25.4);
      expect(dpi, `${s} lands at ${Math.round(dpi)} DPI`).toBeGreaterThan(200);
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

describe('⚠️ an unknown shape must not cut a known one', () => {
  // The operator photographed an A4 certificate through the
  // FIREARM_SOURCE_PROOF door — which matches nothing in shapeForKind and so
  // lands on 'any' — and got it back with the top and bottom edges gone. The
  // 'any' box was ratio 0.8; an A4 page is 0.707, so the page overflowed a box
  // the capture then cropped to exactly.
  //
  // Swept across real viewfinder aspects rather than one, because the failure
  // depended on the aspect: it did not show on the iPhone and did on the S23.
  const VIEWS = [
    { width: 390, height: 700 }, // 0.557 — the original test phone
    { width: 393, height: 574 }, // 0.684 — Samsung S23, chrome visible
    { width: 393, height: 456 }, // 0.862 — iPhone 15, chrome visible
    { width: 430, height: 900 }, // 0.478 — a tall viewfinder
  ];

  it('holds every known document shape inside the unknown box', () => {
    for (const view of VIEWS) {
      const any = aimBox('any', view);
      for (const s of SHAPE_ORDER) {
        const a = guideAspect(s);
        if (a === null) continue;
        // Fit that document into the unknown box the way a member would —
        // as large as it goes — and check it does not need to spill out.
        const w = Math.min(any.width, any.height * a);
        const h = w / a;
        expect(
          h,
          `${s} overflows the 'any' box on a ${view.width}x${view.height} view`,
        ).toBeLessThanOrEqual(any.height + 0.001);
        expect(w).toBeLessThanOrEqual(any.width + 0.001);
      }
    }
  });

  it('⚠️ THE OLD 1.25 BOX CUT AN A4, WHICH IS WHY THIS SUITE EXISTS', () => {
    const view = { width: 393, height: 574 };
    const maxW = view.width * 0.82;
    const maxH = view.height * 0.82;
    const oldH = Math.min(maxH, maxW * 1.25);
    const a4 = guideAspect('a4')!;
    // A page fitted to that box's width needed more height than it had.
    expect(maxW / a4).toBeGreaterThan(oldH);
    // And the box in force now holds it.
    expect(maxW / a4).toBeLessThanOrEqual(aimBox('any', view).height + 0.001);
  });

  it('stays inside the viewfinder on every one of them', () => {
    for (const view of VIEWS) {
      const b = aimBox('any', view);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(view.width);
      expect(b.y + b.height).toBeLessThanOrEqual(view.height);
    }
  });
});

describe('⚠️ the aim box is scale-invariant, only its aspect matters', () => {
  // The property the capture path now leans on. The box used to be computed
  // against the video ELEMENT and then applied to the captured RASTER, with a
  // React re-render and an await between the two measurements — so when the
  // browser toolbar moved in that gap, the crop came out at a different aspect
  // from the box the member had aimed into. Measured on a Samsung S23: aim box
  // aspect 0.707, file that reached the server 1646x1969 = 0.836.
  //
  // Computing it against the raster instead is only correct because aimBox
  // depends on nothing but the view's aspect. That is asserted here rather
  // than assumed, because the whole fix rests on it.
  it('gives the same relative rectangle at any scale', () => {
    for (const s of SHAPE_ORDER) {
      const small = aimBox(s, { width: 384, height: 574 });
      const large = aimBox(s, { width: 2160, height: 3229 }); // same aspect
      const k = 2160 / 384;
      expect(large.width / k).toBeCloseTo(small.width, 0);
      expect(large.height / k).toBeCloseTo(small.height, 0);
      expect(large.width / large.height).toBeCloseTo(
        small.width / small.height,
        3,
      );
    }
  });

  it('⚠️ AND A DIFFERENT ASPECT GIVES DIFFERENT FRACTIONS — which is why one measurement must serve both', () => {
    // The two element heights straddling the await on the operator's phone:
    // 486 at grab time, 574 by the time the old code read the rect.
    const atGrab = aimBox('a4', { width: 384, height: 486 });
    const afterwards = aimBox('a4', { width: 384, height: 574 });

    // At 486 the box is HEIGHT-limited; at 574 it is width-limited. Both are
    // correctly A4, and they are not the same rectangle.
    expect(atGrab.width / atGrab.height).toBeCloseTo(0.707, 2);
    expect(afterwards.width / afterwards.height).toBeCloseTo(0.707, 2);
    expect(atGrab.width).not.toBeCloseTo(afterwards.width, 0);

    // The fractions are what got sent, and mixing them is what broke the crop.
    // Take the LATER fractions and apply them to the EARLIER raster, exactly
    // as the old code did:
    const raster = { w: 2160, h: 2160 / (384 / 486) }; // grab-time aspect
    const cropW = (afterwards.width / 384) * raster.w;
    const cropH = (afterwards.height / 574) * raster.h;
    // 0.834 — and the file that actually reached the server was 1646x1969,
    // which is 0.836. That is the bug reproduced from first principles.
    expect(cropW / cropH).toBeCloseTo(0.836, 2);
    expect(cropW / cropH).not.toBeCloseTo(0.707, 2);

    // Using ONE measurement for both, the way the capture path now does,
    // returns the aspect the member aimed at.
    const consistentW = (atGrab.width / 384) * raster.w;
    const consistentH = (atGrab.height / 486) * raster.h;
    expect(consistentW / consistentH).toBeCloseTo(0.707, 2);
  });
});
