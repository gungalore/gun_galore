import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import {
  cornerAngles,
  squareness,
  tiltAdvice,
  TOO_BIG,
  TOO_SMALL,
  guidanceFor,
  guidanceText,
  mayCapture,
  occupancy,
} from './guidance';

const rect = (x: number, y: number, w: number, h: number): Quad => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe('occupancy', () => {
  it('measures the quad, not its bounding box', () => {
    // ⚠️ A document held at an angle has a bounding box far larger than
    // itself. Measuring that would call a small skewed page "big enough" and
    // stop telling the member to move closer.
    const diamond: Quad = [
      { x: 500, y: 0 }, { x: 1000, y: 500 }, { x: 500, y: 1000 }, { x: 0, y: 500 },
    ];
    // The diamond is exactly half its 1000x1000 bounding box.
    expect(occupancy(diamond, 1000, 1000)).toBeCloseTo(0.5, 6);
  });

  it('is 1 for a full-frame quad and 0 for a degenerate one', () => {
    expect(occupancy(rect(0, 0, 800, 600), 800, 600)).toBeCloseTo(1, 6);
    expect(occupancy(rect(0, 0, 0, 0), 800, 600)).toBe(0);
  });

  it('survives a frame of no size', () => {
    expect(occupancy(rect(0, 0, 10, 10), 0, 0)).toBe(0);
  });

  it('is orientation-agnostic — a wound-backwards quad still measures positive', () => {
    const backwards: Quad = [
      { x: 0, y: 0 }, { x: 0, y: 600 }, { x: 800, y: 600 }, { x: 800, y: 0 },
    ];
    expect(occupancy(backwards, 800, 600)).toBeCloseTo(1, 6);
  });
});

describe('guidanceFor', () => {
  it('says point when there is nothing, or nothing trusted yet', () => {
    expect(guidanceFor({ occupancy: null, locked: false, still: true })).toBe('point');
    // ⚠️ AN UNLOCKED QUAD IS NOT ADVICE. A detection that has not held for a
    // few frames is as likely to be a blanket seam, and "move closer" aimed at
    // a seam sends the member the wrong way.
    expect(guidanceFor({ occupancy: 0.6, locked: false, still: true })).toBe('point');
  });

  it('⚠️ SAYS MOVE CLOSER BELOW THE BRACKET AND FURTHER ABOVE IT', () => {
    expect(guidanceFor({ occupancy: 0.2, locked: true, still: true })).toBe('closer');
    expect(guidanceFor({ occupancy: TOO_SMALL - 0.01, locked: true, still: true })).toBe('closer');
    expect(guidanceFor({ occupancy: TOO_BIG + 0.01, locked: true, still: true })).toBe('further');
    expect(guidanceFor({ occupancy: 0.9, locked: true, still: true })).toBe('further');
  });

  it('asks for stillness inside the bracket, then fires', () => {
    expect(guidanceFor({ occupancy: 0.6, locked: true, still: false })).toBe('steady');
    expect(guidanceFor({ occupancy: 0.6, locked: true, still: true })).toBe('ready');
  });

  it('⚠️ ONLY "ready" MAY FIRE THE SHUTTER', () => {
    // Everything else is a state the member can still act on. Firing in any of
    // them ships a scan they did not agree to.
    for (const g of ['point', 'closer', 'further', 'steady'] as const) {
      expect(mayCapture(g)).toBe(false);
    }
    expect(mayCapture('ready')).toBe(true);
  });

  it('accepts the bracket edges rather than nagging on the boundary', () => {
    expect(guidanceFor({ occupancy: TOO_SMALL, locked: true, still: true })).toBe('ready');
    expect(guidanceFor({ occupancy: TOO_BIG, locked: true, still: true })).toBe('ready');
  });
});

describe('guidanceText', () => {
  it('gives one actionable sentence per state, and none when firing', () => {
    expect(guidanceText('point', 'certificate')).toContain('certificate');
    expect(guidanceText('closer', 'card')).toBe('Move closer');
    expect(guidanceText('further', 'card')).toContain('further');
    expect(guidanceText('steady', 'card')).toContain('Hold still');
    // Nothing at 'ready' — it would be read after the shutter had already gone.
    expect(guidanceText('ready', 'card')).toBeNull();
  });
});

describe('squareness — the operator\'s 87/93 corner check', () => {
  const square: Quad = [
    { x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 700 },
  ];
  /** Top edge shorter than bottom: the top of the document is further away. */
  const topFar: Quad = [
    { x: 180, y: 100 }, { x: 420, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 700 },
  ];
  const leftFar: Quad = [
    { x: 100, y: 180 }, { x: 500, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 620 },
  ];

  it('reads 90 at every corner of a square-on rectangle', () => {
    for (const a of cornerAngles(square)) expect(a).toBeCloseTo(90, 6);
    expect(squareness(square)).toBeCloseTo(0, 6);
  });

  it('⚠️ IS UNCHANGED BY ROTATION — WHICH IS WHY "ROTATE" IS THE WRONG FIX', () => {
    // Rolling the phone rotates the quad rigidly. Every corner stays at 90, so
    // a corner-angle check can never detect roll and telling somebody to
    // rotate can never correct what it does detect.
    const t = (25 * Math.PI) / 180;
    const spun = square.map((p) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
    })) as Quad;
    for (const a of cornerAngles(spun)) expect(a).toBeCloseTo(90, 6);
    expect(tiltAdvice(spun)).toBeNull();
  });

  it('detects tilt and names the direction from the shorter edge', () => {
    expect(squareness(topFar)).toBeGreaterThan(3);
    // The short edge is the far one — perspective shrinks distance — so the
    // phone leans towards it.
    expect(tiltAdvice(topFar)).toBe('tilt-top');
    expect(tiltAdvice(leftFar)).toBe('tilt-left');
  });

  it('leaves a nearly-square quad alone rather than nagging', () => {
    const nearly: Quad = [
      { x: 102, y: 100 }, { x: 498, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 700 },
    ];
    expect(squareness(nearly)).toBeLessThan(3);
    expect(tiltAdvice(nearly)).toBeNull();
  });

  it('⚠️ ASKS FOR SIZE BEFORE SQUARENESS', () => {
    // Levelling the phone while the document is still half a frame away wastes
    // the instruction — moving closer changes the geometry anyway, and two
    // corrections at once is one too many.
    expect(
      guidanceFor({ occupancy: 0.3, locked: true, still: true, quad: topFar }),
    ).toBe('closer');
    expect(
      guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: topFar }),
    ).toBe('tilt-top');
  });

  it('will not fire while the phone is off parallel', () => {
    expect(
      mayCapture(guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: topFar })),
    ).toBe(false);
    expect(
      mayCapture(guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: square })),
    ).toBe(true);
  });

  it('gives each tilt an instruction that names a real movement', () => {
    for (const g of ['tilt-top', 'tilt-bottom', 'tilt-left', 'tilt-right'] as const) {
      expect(guidanceText(g, 'certificate')).toMatch(/^Tilt the (top|bottom|left|right) of the phone down$/);
    }
  });
});

describe("squareness — the operator's 87/93 corner check", () => {
  const square: Quad = [
    { x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 700 },
  ];
  /** Top edge shorter than bottom: the top of the document is further away. */
  const topFar: Quad = [
    { x: 180, y: 100 }, { x: 420, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 700 },
  ];
  const leftFar: Quad = [
    { x: 100, y: 180 }, { x: 500, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 620 },
  ];

  it('reads 90 at every corner of a square-on rectangle', () => {
    for (const a of cornerAngles(square)) expect(a).toBeCloseTo(90, 6);
    expect(squareness(square)).toBeCloseTo(0, 6);
  });

  it('⚠️ IS UNCHANGED BY ROTATION — WHICH IS WHY "ROTATE" IS THE WRONG FIX', () => {
    // Rolling the phone rotates the quad rigidly, so every corner stays at 90.
    // A corner-angle check can never detect roll, and telling somebody to
    // rotate can never correct what it does detect. This test is the reason
    // the instruction says "tilt" rather than the "rotate" that was asked for.
    const t = (25 * Math.PI) / 180;
    const spun = square.map((p) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
    })) as Quad;
    for (const a of cornerAngles(spun)) expect(a).toBeCloseTo(90, 6);
    expect(tiltAdvice(spun)).toBeNull();
  });

  it('detects tilt and names the direction from the shorter edge', () => {
    expect(squareness(topFar)).toBeGreaterThan(3);
    // The short edge is the FAR one — perspective shrinks distance — so the
    // phone leans towards it.
    expect(tiltAdvice(topFar)).toBe('tilt-top');
    expect(tiltAdvice(leftFar)).toBe('tilt-left');
  });

  it('is symmetric — a far BOTTOM edge asks for the opposite lean', () => {
    const bottomFar: Quad = [
      { x: 100, y: 100 }, { x: 500, y: 100 }, { x: 420, y: 700 }, { x: 180, y: 700 },
    ];
    expect(tiltAdvice(bottomFar)).toBe('tilt-bottom');
  });

  it('leaves a nearly-square quad alone rather than nagging', () => {
    const nearly: Quad = [
      { x: 102, y: 100 }, { x: 498, y: 100 }, { x: 500, y: 700 }, { x: 100, y: 700 },
    ];
    expect(squareness(nearly)).toBeLessThan(3);
    expect(tiltAdvice(nearly)).toBeNull();
  });

  it('⚠️ ASKS FOR SIZE BEFORE SQUARENESS', () => {
    // Levelling the phone while the document is still half a frame away wastes
    // the instruction — moving closer changes the geometry anyway, and two
    // corrections at once is one too many.
    expect(guidanceFor({ occupancy: 0.2, locked: true, still: true, quad: topFar })).toBe('closer');
    expect(guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: topFar })).toBe('tilt-top');
  });

  it('⚠️ WILL NOT FIRE WHILE THE PHONE IS OFF PARALLEL', () => {
    // A tilted capture loses resolution on the far edge, and that edge is
    // where a serial number is as likely to sit as anywhere else.
    expect(mayCapture(guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: topFar }))).toBe(false);
    expect(mayCapture(guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: square }))).toBe(true);
  });

  it('skips the check entirely when no quad is supplied', () => {
    expect(guidanceFor({ occupancy: 0.6, locked: true, still: true })).toBe('ready');
  });

  it('gives each tilt an instruction naming a real movement', () => {
    for (const g of ['tilt-top', 'tilt-bottom', 'tilt-left', 'tilt-right'] as const) {
      expect(guidanceText(g, 'certificate')).toMatch(
        /^Tilt the (top|bottom|left|right) of the phone down$/,
      );
    }
  });

  it('survives a degenerate quad without emitting NaN', () => {
    const collapsed: Quad = [
      { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 },
    ];
    for (const a of cornerAngles(collapsed)) expect(Number.isFinite(a)).toBe(true);
  });
});

describe('the 200 dpi quality floor', () => {
  const ok = { occupancy: 0.6, locked: true, still: true };

  it('passes when no document type was chosen and dpi cannot be known', () => {
    // shape 'any' has no known millimetres, so there is no dpi to gate on.
    expect(guidanceFor({ ...ok, dpi: null })).toBe('ready');
    expect(guidanceFor({ ...ok })).toBe('ready');
  });

  it('asks for closer below 200 dpi even when the bracket is satisfied', () => {
    expect(guidanceFor({ ...ok, dpi: 150 })).toBe('closer');
  });

  it('allows capture at and above 200 dpi', () => {
    expect(guidanceFor({ ...ok, dpi: 200 })).toBe('ready');
    expect(guidanceFor({ ...ok, dpi: 320 })).toBe('ready');
  });

  it('still refuses a document crowding the frame, however sharp', () => {
    // The frame-edge cliff is absolute; resolution cannot buy past it.
    expect(guidanceFor({ occupancy: 0.9, locked: true, still: true, dpi: 600 })).toBe(
      'further',
    );
  });

  it('shows "Hold still" rather than firing when the phone has not settled', () => {
    expect(guidanceFor({ ...ok, still: false, dpi: 300 })).toBe('steady');
    expect(mayCapture('steady')).toBe(false);
  });
});
