import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ────────────────────────────────────────────────────────────────────
// THE SCANNER'S MEASURE LOOP MAY SLOW DOWN. IT MAY NOT STOP.
//
// ⚠️ THIS SHIPPED, AND AUTO-CAPTURE SIMPLY DID NOT WORK ON A PHONE.
//
// The detect loop ended:
//
//     if (rolling > 45 && rate < RATES.length - 1) rate++;
//     if (rolling > 90) {
//       alive = false;
//       quadRef.current = null;
//       return;                                    // ← never re-armed
//     }
//     timer = window.setTimeout(detectOnce, RATES[rate]);
//
// The `return` sits above the only line that schedules the next tick, so once
// the rolling per-frame cost crossed 90ms the loop stopped for the rest of the
// session. autoBlocker is only ever evaluated inside that function, so ink,
// motion, glare and luma froze at their last values and the shutter could
// never arm again. Desktop stayed under the threshold; a phone running
// detectQuad every frame did not — which is why it reproduced nowhere else.
//
// Nothing said so. A camera doing nothing looks exactly like a camera that is
// broken, and two rounds of "auto capture still not working" were spent
// guessing at it from the outside.
//
// tsc is happy with it, every unit test is happy with it, and a production
// build is happy with it, because a loop that declines to reschedule itself is
// perfectly valid code. So it is asserted on the source, which is the only
// place it is visible.
//
// The correct degradation is the one this module already believed in — "THE
// DETECTOR DOES NOT HOLD THE TRIGGER". Drop detectQuad, which is expensive and
// only draws the green corners; keep the three cheap readings that decide the
// capture.
// ────────────────────────────────────────────────────────────────────

const FILE = join(
  process.cwd(),
  'components',
  'scan',
  'document-scanner.tsx',
);
const src = readFileSync(FILE, 'utf8');

/**
 * Source with comments removed.
 *
 * ⚠️ WITHOUT THIS THE GUARD FAILS ON ITSELF. The note beside the fix quotes
 * the deleted `alive = false; ... return;` so the next reader knows what was
 * wrong — and a raw text match cannot tell a quotation from the real thing.
 * A guard that forbids DESCRIBING the bug it prevents is a guard people delete.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The performance back-off block, from the rolling average to the re-arm. */
function backoffBlock(): string {
  const start = src.indexOf('rolling = rolling * 0.8');
  expect(start, 'the rolling frame-cost average has moved or gone').toBeGreaterThan(-1);
  const end = src.indexOf('timer = window.setTimeout(detectOnce', start);
  expect(end, 'the loop no longer re-arms itself after the back-off').toBeGreaterThan(start);
  return stripComments(src.slice(start, end));
}

describe('⚠️ the detect loop always re-arms', () => {
  it('never kills itself on a slow device', () => {
    // `alive = false` between the frame-cost measurement and the reschedule is
    // the exact shape of the bug: it stops the loop AND makes the guard at the
    // top of detectOnce refuse every later tick.
    expect(backoffBlock()).not.toMatch(/alive\s*=\s*false/);
  });

  it('never returns early instead of rescheduling', () => {
    // A bare `return` in that block reaches the same end by a different route.
    expect(backoffBlock()).not.toMatch(/\breturn\b/);
  });

  it('drops the detector rather than the whole loop', () => {
    // The intent the kill switch was reaching for, done the way that keeps
    // the shutter alive.
    expect(backoffBlock()).toMatch(/detectorOff\s*=\s*true/);
  });

  it('and the detector is actually gated on that flag', () => {
    expect(src).toMatch(/!detectorOff\s*\n?\s*\?\s*detectQuad|detectorOff[\s\S]{0,80}detectQuad/);
  });
});

describe('⚠️ the readings the shutter depends on', () => {
  it('measures exposure over the aim box, not the whole frame', () => {
    // GLARE_AT is 0.02 and glare outranks every other exposure check, so
    // whole-frame measurement let a window behind the desk refuse the capture.
    expect(src).toMatch(/regionExposure\(gray,\s*rect/);
    expect(src, 'a whole-buffer glare scan is back').not.toMatch(
      /for\s*\([^)]*i\s*<\s*gray\.data\.length[^)]*\)\s*\{\s*\n\s*if\s*\(gray\.data\[i\]\s*>\s*250\)/,
    );
  });

  it('maps the aim box with two scales, not one', () => {
    // A single width-derived scale applied to y walks off the buffer as soon
    // as the pane's aspect ratio drifts — which a phone's address bar does.
    expect(src).toMatch(/mapToBuffer\(/);
    expect(src, 'the single-scale mapping is back').not.toMatch(
      /const k = gray\.width \/ elBox\.width/,
    );
  });

  it('removes the exposure hunt from the motion reading', () => {
    // ⚠️ ASSERT THE PROPERTY, NOT THE SPELLING. This pinned the exact
    // identifiers `motionOf(sample, prevSample)` and duly went red when the
    // variable was renamed during a change that made the reading MORE correct,
    // not less. A guard that fails on a rename teaches people to edit the
    // guard, which is how a guard stops meaning anything.
    expect(src).toMatch(/motionOf\(/);
  });

  it('⚠️ MEASURES MOVEMENT INSIDE THE AIM BOX, NOT ACROSS THE WHOLE FRAME', () => {
    // Motion was the only one of the four readings taken whole-frame, and the
    // only one failing: on a document lying on a woven carpet it pinned at
    // 22.31 against a limit of 4 and never once dropped below it in 400
    // frames. Every carpet pixel the member was not pointing at counted as
    // evidence their hand was moving.
    expect(src).toMatch(/sampleRegion\(gray,\s*rect\)/);
  });
});
