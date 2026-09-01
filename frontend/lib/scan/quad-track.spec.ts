import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import { CONFIRM_FRAMES, QuadTracker, SAME_RECT } from './quad-track';

const W = 1000;

function at(x: number, y: number, w = 300, h = 400): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** A nudge well inside SAME_RECT — the same rectangle, seen again. */
const same = (q: Quad, d = 4): Quad =>
  q.map((p) => ({ x: p.x + d, y: p.y })) as Quad;

/** A jump well outside SAME_RECT — a different rectangle. */
const other = at(600, 500);

describe('the overlay must never blink when a different rectangle appears', () => {
  it('keeps drawing the tracked quad while a newcomer is unproven', () => {
    const t = new QuadTracker();
    const card = at(100, 100);
    t.push(card, W);
    t.push(same(card), W);
    expect(t.state.lock).toBeGreaterThanOrEqual(2);

    // One sighting of something else must not move the quad OR drop the lock.
    const s = t.push(other, W);
    expect(s.lock).toBeGreaterThanOrEqual(2);
    expect(s.quad![0].x).toBeCloseTo(card[0].x + 4, 0);
  });

  it('never promotes either of two rectangles that alternate', () => {
    // ⚠️ THE FAULT THIS WHOLE MODULE PROTECTS. The card, then the table edge,
    // then the card again. Counting both towards one lock dragged the markers
    // between them, and that flip-flop was the jitter.
    const t = new QuadTracker();
    const card = at(100, 100);
    t.push(card, W);
    t.push(same(card), W);
    for (let i = 0; i < 8; i++) {
      t.push(other, W);
      t.push(same(card, 2), W);
    }
    // Still on the card, never once on the table edge.
    expect(t.state.quad![0].x).toBeLessThan(200);
    expect(t.state.lock).toBeGreaterThanOrEqual(2);
  });

  it('follows a document that genuinely moved, after it agrees with itself', () => {
    const t = new QuadTracker();
    const card = at(100, 100);
    t.push(card, W);
    t.push(same(card), W);
    for (let i = 0; i < CONFIRM_FRAMES; i++) t.push(same(other, i), W);
    expect(t.state.quad![0].x).toBeGreaterThan(500);
  });

  it('holds the lock across the switch — that drop WAS the blink', () => {
    const t = new QuadTracker();
    const card = at(100, 100);
    t.push(card, W);
    t.push(same(card), W);
    t.push(same(card), W);
    const before = t.state.lock;
    for (let i = 0; i < CONFIRM_FRAMES; i++) t.push(same(other, i), W);
    expect(t.state.lock).toBe(before);
    expect(t.state.lock).toBeGreaterThanOrEqual(2);
  });

  it('does not blink off for a single missed frame', () => {
    const t = new QuadTracker();
    const card = at(100, 100);
    for (let i = 0; i < 4; i++) t.push(same(card, i), W);
    const s = t.push(null, W);
    expect(s.quad).not.toBeNull();
    expect(s.lock).toBeGreaterThanOrEqual(2);
  });

  it('gives up once the lock is spent', () => {
    const t = new QuadTracker();
    const card = at(100, 100);
    for (let i = 0; i < 4; i++) t.push(same(card, i), W);
    for (let i = 0; i < 5; i++) t.push(null, W);
    expect(t.state.quad).toBeNull();
    expect(t.state.lock).toBe(0);
  });

  it('never hands back a blended quad — the target is a real detection', () => {
    // The inference-rate EMA that used to sit here put a lag floor in front of
    // the render-rate filter, which is why raising the smoother's damping did
    // so much less than its numbers promised.
    const t = new QuadTracker();
    const a = at(100, 100);
    t.push(a, W);
    const b = same(a, 6);
    const s = t.push(b, W);
    expect(s.quad![0].x).toBe(b[0].x);
  });

  it('treats SAME_RECT as a fraction of the frame, not pixels', () => {
    const t = new QuadTracker();
    const card = at(100, 100);
    t.push(card, W);
    t.push(same(card), W);
    const lockBefore = t.state.lock;
    // A step just inside the threshold on a wide frame is the same rectangle.
    const nudge = same(card, W * SAME_RECT * 0.9);
    t.push(nudge, W);
    expect(t.state.lock).toBeGreaterThan(lockBefore - 1);
    expect(t.state.quad![0].x).toBeCloseTo(nudge[0].x, 0);
  });
});
