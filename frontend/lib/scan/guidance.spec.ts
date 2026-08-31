import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import {
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
    expect(guidanceFor({ occupancy: 0.7, locked: false, still: true })).toBe('point');
  });

  it('⚠️ SAYS MOVE CLOSER BELOW THE BRACKET AND FURTHER ABOVE IT', () => {
    expect(guidanceFor({ occupancy: 0.4, locked: true, still: true })).toBe('closer');
    expect(guidanceFor({ occupancy: TOO_SMALL - 0.01, locked: true, still: true })).toBe('closer');
    expect(guidanceFor({ occupancy: TOO_BIG + 0.01, locked: true, still: true })).toBe('further');
    expect(guidanceFor({ occupancy: 0.95, locked: true, still: true })).toBe('further');
  });

  it('asks for stillness inside the bracket, then fires', () => {
    expect(guidanceFor({ occupancy: 0.75, locked: true, still: false })).toBe('steady');
    expect(guidanceFor({ occupancy: 0.75, locked: true, still: true })).toBe('ready');
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
