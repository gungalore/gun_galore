import { describe, it, expect } from 'vitest';
import { advanceCapture } from './two-side-capture';

// ⚠️ THE REGRESSION THIS LOCKS: the front finishing must keep the surface
// open. Without keepOpen the wrapper let the scanner's close reach the parent,
// the whole capture unmounted, and the back was never offered — the flow was
// completely broken and nothing caught it, because there was no test that
// could run without a camera.
describe('advanceCapture', () => {
  it('after the FRONT: goes to the back and KEEPS THE SURFACE OPEN', () => {
    const step = advanceCapture('front', false);
    expect(step.next).toBe('back');
    expect(step.keepOpen).toBe(true); // the line whose absence broke the flow
    expect(step.complete).toBe(false);
  });

  it('after the BACK with a front in hand: completes and lets it close', () => {
    const step = advanceCapture('back', true);
    expect(step.complete).toBe(true);
    expect(step.keepOpen).toBe(false);
  });

  it('after the BACK with no front (a remount): restarts, still open', () => {
    const step = advanceCapture('back', false);
    expect(step.next).toBe('front');
    expect(step.complete).toBe(false);
    expect(step.keepOpen).toBe(true);
  });

  it('never completes on the front, however many times it is called', () => {
    for (let i = 0; i < 5; i++) {
      expect(advanceCapture('front', i % 2 === 0).complete).toBe(false);
    }
  });
});
