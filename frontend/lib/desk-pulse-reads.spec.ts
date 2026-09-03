import { describe, expect, it } from 'vitest';
import { DOW_LABELS, heatIndex, heatPeak, type HeatCell } from './desk-pulse';

// ────────────────────────────────────────────────────────────────────
// THE FOUR ANALYTICS READS THE MAP CALLED "NO DESK EQUIVALENT".
//
// 🚨 EVERY ONE OF THEM WAS A LIVE GET. Top makes and models, time to sale,
// search intel and the dormant segment had all been serving since the legacy
// page was written. Nothing had to be computed — they had to be asked for.
// It is the same shape as this module's period gap, which was a union that
// stopped two entries early while the comment above it listed all five.
//
// What genuinely needed writing is the grid maths below, so that is what is
// tested: a heatmap is the one place here where a plausible-looking bug
// paints a real number onto the wrong square, and nothing on screen says so.
// ────────────────────────────────────────────────────────────────────

describe('🚨 the heatmap index cannot collide', () => {
  it('keeps two cells apart that a string key would merge', () => {
    // The trap: keying on `${dow}${hour}` makes dow 1 / hour 12 and
    // dow 11 / hour 2 both "112". dow never reaches 11, but hour reaches 23
    // and the same collision exists at dow 2 / hour 3 vs dow 23 — the shape
    // is wrong even where today's data happens not to hit it. A Monday
    // lunchtime figure painted onto another square is invisible: it is a
    // real number in a real cell.
    const cells: HeatCell[] = [
      { dow: 1, hour: 12, count: 5 },
      { dow: 1, hour: 2, count: 9 },
      { dow: 2, hour: 3, count: 7 },
    ];
    const idx = heatIndex(cells);
    expect(idx.get(1 * 24 + 12)).toBe(5);
    expect(idx.get(1 * 24 + 2)).toBe(9);
    expect(idx.get(2 * 24 + 3)).toBe(7);
    expect(idx.size).toBe(3);
  });

  it('covers every square of the week without overlap', () => {
    const keys = new Set<number>();
    for (let dow = 0; dow < 7; dow += 1) {
      for (let hour = 0; hour < 24; hour += 1) keys.add(dow * 24 + hour);
    }
    expect(keys.size).toBe(7 * 24);
  });

  it('an absent cell is absent, not zero-by-accident', () => {
    // The server returns only cells WITH activity, so the grid must decide
    // what a missing square means — and it means zero here, because the
    // query counts rows. Making that explicit stops a later reader assuming
    // undefined signals "not measured", which it does not.
    const idx = heatIndex([{ dow: 3, hour: 9, count: 2 }]);
    expect(idx.get(3 * 24 + 9)).toBe(2);
    expect(idx.get(3 * 24 + 10)).toBeUndefined();
    expect(idx.get(3 * 24 + 10) ?? 0).toBe(0);
  });
});

describe('the heatmap peak', () => {
  it('is the largest cell, which is what the shading scales against', () => {
    expect(heatPeak([{ dow: 0, hour: 0, count: 3 }, { dow: 1, hour: 5, count: 11 }])).toBe(11);
  });

  it('is zero for an empty week rather than -Infinity', () => {
    // Math.max(...[]) is -Infinity, and dividing by it paints every cell as
    // a negative fraction — a grid that renders as uniformly blank and looks
    // like a quiet week rather than a bug.
    expect(heatPeak([])).toBe(0);
  });
});

describe('the day labels line up with Postgres', () => {
  it('is Sunday-first, matching EXTRACT(DOW)', () => {
    // ⚠️ EXTRACT(DOW) IS 0=SUNDAY. A Monday-first label array would shift
    // every row by one and produce a chart that is entirely plausible and
    // entirely wrong — the busiest trading day reported as the day before.
    expect(DOW_LABELS[0]).toBe('Sun');
    expect(DOW_LABELS[6]).toBe('Sat');
    expect(DOW_LABELS).toHaveLength(7);
  });
});
