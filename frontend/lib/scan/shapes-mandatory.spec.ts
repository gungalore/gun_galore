import { describe, expect, it } from 'vitest';
import { FLOOR_DPI, dpiOf } from './framing';
import {
  SHAPES,
  SHAPE_ORDER,
  acrossMm,
  expectAspect,
  guideAspect,
  holdHint,
  shapeForKind,
} from './shapes';

// ────────────────────────────────────────────────────────────────────
// ⚠️ EVERY SHAPE HAS A SIZE NOW, AND THAT IS THE WHOLE POINT.
//
// 'Something else' had longMm and shortMm of null. Three things silently
// switched off whenever it was chosen: the dpi readout, the 200 dpi quality
// floor, and the hold hint — and the aim box fell back to a fixed 0.82
// constant that had already been caught cropping an A4.
//
// So it was not a neutral escape hatch. It was a door a member could walk a
// statutory document through with every quality gate disabled and nothing on
// screen saying so. Removing it is what makes the floor mean something, and
// these tests exist so nobody adds a sizeless shape back without deciding to.
// ────────────────────────────────────────────────────────────────────

describe('every offered shape can be measured', () => {
  it('has real millimetres', () => {
    for (const key of SHAPE_ORDER) {
      const spec = SHAPES[key];
      expect(spec.longMm, `${key} has no long edge`).not.toBeNull();
      expect(spec.shortMm, `${key} has no short edge`).not.toBeNull();
      expect(spec.longMm!).toBeGreaterThan(0);
      expect(spec.shortMm!).toBeGreaterThan(0);
      expect(spec.longMm!).toBeGreaterThanOrEqual(spec.shortMm!);
    }
  });

  it('yields an aspect, a hold hint and a dpi basis for each', () => {
    for (const key of SHAPE_ORDER) {
      expect(guideAspect(key), `${key} aspect`).not.toBeNull();
      expect(expectAspect(key), `${key} detector prior`).toBeDefined();
      expect(acrossMm(key), `${key} across`).not.toBeNull();
      expect(holdHint(key), `${key} hold hint`).not.toBeNull();
    }
  });

  it('offers every shape it defines, and defines every shape it offers', () => {
    expect([...SHAPE_ORDER].sort()).toEqual(Object.keys(SHAPES).sort());
  });
});

describe('shapeForKind always lands on something measurable', () => {
  it('never returns a shape without a size, for any input', () => {
    for (const kind of [
      'COMPETENCY',
      'IDENTITY_DOCUMENT',
      'FIREARM_LICENCE',
      'SAFE_PHOTOGRAPHS',
      'OTHER',
      'VEHICLE_LICENCE_DISC',
      '',
      'something nobody has thought of',
    ]) {
      const shape = shapeForKind(kind);
      expect(SHAPES[shape], `${kind} -> ${shape}`).toBeDefined();
      expect(acrossMm(shape), `${kind} -> ${shape} has no size`).not.toBeNull();
    }
  });

  it('sends the vehicle disc to its own shape', () => {
    expect(shapeForKind('VEHICLE_LICENCE_DISC')).toBe('licence-disc');
  });

  it('falls back to A4, the cheaper wrong answer', () => {
    // An A4 box around a card still contains the card. A card box around an A4
    // crops a statutory document, which is the error that cannot be undone.
    expect(shapeForKind('OTHER')).toBe('a4');
  });
});

describe('the quality floor is reachable for every shape', () => {
  // A gate nothing can pass is the same as no gate. On a 4K stream, each shape
  // at the top of the occupancy bracket must clear 200 dpi — otherwise the
  // floor would permanently contradict the framing guidance and the member
  // would be told to move closer and further at once.
  it('clears 200 dpi at the top of the bracket on a 4K stream', () => {
    const shortPx = 3024;
    for (const key of SHAPE_ORDER) {
      const across = acrossMm(key)!;
      // 0.70 of frame AREA, converted to a span across the short axis for a
      // document of this aspect in a 4:3 frame.
      const spanFraction = Math.sqrt(0.7 / 0.94);
      const dpi = dpiOf(spanFraction * shortPx * (across / across), across);
      expect(dpi, `${key} cannot reach the floor`).toBeGreaterThanOrEqual(
        FLOOR_DPI,
      );
    }
  });
});
