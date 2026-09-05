import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import {

  squareness,
  MIN_FILL,
  TOO_SMALL,
  guidanceFor,
  linearFill,
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
    expect(guidanceFor({ occupancy: 0.1, locked: true, still: true })).toBe('closer');
    expect(guidanceFor({ occupancy: TOO_SMALL - 0.01, locked: true, still: true })).toBe('closer');
    expect(
      guidanceFor({ occupancy: 0.5, locked: true, still: true, edgeMargin: 0 }),
    ).toBe('further');
    expect(
      guidanceFor({ occupancy: 0.9, locked: true, still: true, edgeMargin: 0.001 }),
    ).toBe('further');
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
    expect(
      guidanceFor({ occupancy: 0.7, locked: true, still: true, edgeMargin: 0.2 }),
    ).toBe('ready');
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

describe("squareness - still measured, no longer an instruction", () => {
  // ⚠️ THE MEASUREMENT STAYS, THE INSTRUCTION IS GONE. squareness() feeds the
  // `tilt` line in the diagnostic report and nothing else now. There used to
  // be a tiltAdvice() that named an edge and drew an arrow on it; it competed
  // with "move closer" for the same moment and the two alternated frame to
  // frame, so neither could be acted on. Operator: "lets lose the arrows and
  // tilt text. just keep the move closer and further."
  const square = (): Quad => [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 520 },
    { x: 100, y: 520 },
  ];
  const topFar = (): Quad => [
    { x: 170, y: 100 },
    { x: 330, y: 100 },
    { x: 400, y: 520 },
    { x: 100, y: 520 },
  ];

  it('reads 0 off square for a rectangle photographed head-on', () => {
    expect(squareness(square())).toBeCloseTo(0, 1);
  });

  it('⚠️ IS UNCHANGED BY ROTATION — WHICH IS WHY "ROTATE" IS THE WRONG FIX', () => {
    // A page lying at an angle on the desk is still a rectangle seen head-on.
    // Only PERSPECTIVE opens the corners, and only perspective needs fixing.
    const c = { x: 250, y: 310 };
    const spun = square().map((p) => {
      const a = 0.4;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      return {
        x: c.x + dx * Math.cos(a) - dy * Math.sin(a),
        y: c.y + dx * Math.sin(a) + dy * Math.cos(a),
      };
    }) as Quad;
    expect(squareness(spun)).toBeCloseTo(0, 1);
  });

  it('rises when perspective opens the corners', () => {
    expect(squareness(topFar())).toBeGreaterThan(5);
  });

  it('survives a degenerate quad without emitting NaN', () => {
    const flat: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(Number.isFinite(squareness(flat))).toBe(true);
  });

  it('⚠️ A TILTED BUT WELL-FRAMED PAGE IS NOW ALLOWED TO FIRE', () => {
    // The behaviour change, stated as a test. Being off parallel used to block
    // the shutter and demand a correction nobody can make while also being
    // told to move. The capture rectifies whatever angle the page was held at,
    // so the angle was never the reason to refuse.
    expect(
      guidanceFor({ occupancy: 0.6, locked: true, still: true, quad: topFar() }),
    ).toBe('ready');
  });

  it('⚠️ NEVER RETURNS A TILT STATE, WHATEVER THE QUAD', () => {
    const leftFar: Quad = [
      { x: 100, y: 170 },
      { x: 400, y: 100 },
      { x: 400, y: 520 },
      { x: 100, y: 450 },
    ];
    for (const quad of [square(), topFar(), leftFar]) {
      const g = guidanceFor({ occupancy: 0.6, locked: true, still: true, quad });
      expect(String(g).startsWith('tilt')).toBe(false);
    }
  });
});

describe('the 200 dpi quality floor', () => {
  const ok = { occupancy: 0.6, locked: true, still: true };

  it('passes when no document type was chosen and dpi cannot be known', () => {
    // Before the first measurement there is no dpi yet, so the gate passes.
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
    expect(guidanceFor({ occupancy: 0.9, locked: true, still: true, dpi: 600, edgeMargin: 0 })).toBe(
      'further',
    );
  });

  it('shows "Hold still" rather than firing when the phone has not settled', () => {
    expect(guidanceFor({ ...ok, still: false, dpi: 300 })).toBe('steady');
    expect(mayCapture('steady')).toBe(false);
  });
});

describe("⚠️ the operator's 60%, measured linearly", () => {
  const frame = { w: 400, h: 700 };
  const box = (w: number, h: number): Quad => rect((400 - w) / 2, (700 - h) / 2, w, h);

  it('linearFill is the larger axis share, so a landscape card is judged by its width', () => {
    expect(linearFill(box(240, 150), frame.w, frame.h)).toBeCloseTo(0.6, 6);
    expect(linearFill(box(200, 490), frame.w, frame.h)).toBeCloseTo(0.7, 6);
    expect(linearFill(box(0, 0), frame.w, frame.h)).toBe(0);
    expect(linearFill(box(200, 200), 0, 0)).toBe(0);
  });

  it('asks for closer under MIN_FILL, and fires at it', () => {
    const ok = { occupancy: 0.5, locked: true, still: true };
    expect(guidanceFor({ ...ok, fill: MIN_FILL - 0.01 })).toBe('closer');
    expect(guidanceFor({ ...ok, fill: MIN_FILL })).toBe('ready');
    expect(guidanceFor({ ...ok, fill: null })).toBe('closer');
  });

  it('honours a per-shape requirement below MIN_FILL, for the card the lens cannot get closer to', () => {
    const ok = { occupancy: 0.3, locked: true, still: true };
    expect(guidanceFor({ ...ok, fill: 0.52, minFill: 0.5 })).toBe('ready');
    expect(guidanceFor({ ...ok, fill: 0.52 })).toBe('closer');
  });
});
