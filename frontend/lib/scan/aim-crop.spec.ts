import { describe, expect, it } from 'vitest';
import { Quad } from './geometry';
import { aimBox } from './aim';
import { detectionAgreesWithAim as believesDetection } from './capture';

describe('trusting the aim box over a detection', () => {
  // The operator's own failure, 2026-08-19: a licence card lined up inside
  // the corners, shutter pressed, and the crop came back as a tall strip
  // holding the card and a foot of blue blanket. The detector had found a
  // tall rectangle in the carpet, and nothing asked whether it was anywhere
  // near where he had aimed.
  const FRAME = { width: 1080, height: 1920 };
  const box = aimBox('card', FRAME);

  it('⚠️ REJECTS THE TALL CARPET STRIP', () => {
    const strip: Quad = [
      { x: 220, y: 300 },
      { x: 860, y: 300 },
      { x: 860, y: 1700 },
      { x: 220, y: 1700 },
    ];
    expect(believesDetection(strip, box)).toBe(false);
  });

  it('believes a detection that lands on the card in the box', () => {
    const card: Quad = [
      { x: box.x + 4, y: box.y + 3 },
      { x: box.x + box.width - 5, y: box.y + 6 },
      { x: box.x + box.width - 3, y: box.y + box.height - 4 },
      { x: box.x + 2, y: box.y + box.height - 6 },
    ];
    expect(believesDetection(card, box)).toBe(true);
  });

  it('⚠️ STILL BELIEVES A HANDHELD, SLIGHTLY-OFF DETECTION', () => {
    // The threshold rejects "you found the carpet", not "your corners are a
    // few pixels out". Nobody lines a card up exactly, and a scanner that
    // threw away a good detection for being 5% adrift would be worse than
    // one that never checked.
    const off: Quad = [
      { x: box.x - 30, y: box.y - 18 },
      { x: box.x + box.width - 34, y: box.y - 12 },
      { x: box.x + box.width - 28, y: box.y + box.height - 20 },
      { x: box.x - 24, y: box.y + box.height - 26 },
    ];
    expect(believesDetection(off, box)).toBe(true);
  });

  it('rejects a rectangle that swallows the whole frame', () => {
    const everything: Quad = [
      { x: 0, y: 0 },
      { x: FRAME.width, y: 0 },
      { x: FRAME.width, y: FRAME.height },
      { x: 0, y: FRAME.height },
    ];
    expect(believesDetection(everything, box)).toBe(false);
  });

  it('rejects a fragment inside the card, like one printed table', () => {
    const table: Quad = [
      { x: box.x + 40, y: box.y + 70 },
      { x: box.x + 200, y: box.y + 70 },
      { x: box.x + 200, y: box.y + 110 },
      { x: box.x + 40, y: box.y + 110 },
    ];
    expect(believesDetection(table, box)).toBe(false);
  });
});
