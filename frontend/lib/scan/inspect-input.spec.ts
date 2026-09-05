import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enhance, inspect } from './enhance';
import { GLARE_BAD, LUMA_HIGH } from './quality';
import type { Raster } from './warp';

// ────────────────────────────────────────────────────────────────────
// WHAT IMAGE THE QUALITY REPORT IS MEASURED ON.
//
// ⚠️ THIS IS A BUG CLASS, NOT A BUG, AND IT HAS ALREADY COME BACK ONCE. Every
// consumer of inspect() turns its numbers into advice about how the PICTURE
// WAS TAKEN — "tilting the phone will clear the glare", "holding still will
// read better", "more light will help". None of that is actionable against an
// artefact we introduced ourselves in enhance().
//
// It was found on a real capture: a competency certificate with a large gold
// crest came back "Acceptable — There is a glare on it", while the live frame
// gate on the same document read glare 0.000. Two numbers, same name, and the
// filter was manufacturing the fault.
//
// The first attempt at a fix moved LUMA_HIGH from 215 to 238 to stop the twin
// symptom. That treated the constant instead of the input, and it did not even
// clear it — enhanced paper measures 242. These tests exist so the next person
// changes the IMAGE and not the THRESHOLD.
// ────────────────────────────────────────────────────────────────────

/** A page of paper with a bright, high-contrast feature — a crest, a seal. */
function pageWithBrightFeature(): Raster {
  const w = 240;
  const h = 340;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inFeature =
        x > w / 3 && x < (2 * w) / 3 && y > h / 3 && y < (2 * h) / 3 &&
        (x + y) % 6 < 3;
      // Paper 190, feature 215. The brightest pixel in the whole image is 215,
      // so by any reading NOTHING here is blown out.
      const v = inFeature ? 215 : 190;
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** A soft photograph: low-frequency only, nothing crisp anywhere. */
function softPage(): Raster {
  const w = 240;
  const h = 340;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 170 + 12 * Math.sin(x / 14) * Math.sin(y / 14);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe('enhance() corrupts every number inspect() reports', () => {
  it('invents glare in a page that has none', () => {
    const raw = pageWithBrightFeature();
    expect(inspect(raw).glare).toBe(0);

    // The filter lifts paper to WHITE=245, so anything brighter clips, and the
    // unsharp mask overshoots at every edge. A crest is nothing but edges.
    const made = inspect(enhance(raw)).glare;
    expect(made).toBeGreaterThan(GLARE_BAD);
  });

  it('hides a genuinely soft photograph', () => {
    const raw = softPage();
    // Soft enough that the "this one came out soft" note should fire.
    expect(inspect(raw).sharpness).toBeLessThan(3.5);
    // Sharpening inflates it several times over, and the note that should have
    // fired is measured on a number that no longer describes the photograph.
    // This is the WORSE half of the bug: a note that never fires leaves
    // nothing behind to notice.
    //
    // ⚠️ THIS USED TO READ `> 3.5` — straight past the warning bar. It no
    // longer clears the bar on THIS scene, and only because the sharpening
    // schedule now measures how soft the source is and holds back on a soft
    // one (see `sharpenPlan`). The inflation is still four-fold, so the rule
    // this file exists to enforce is unchanged: inspect the INPUT.
    const raised = inspect(enhance(raw)).sharpness;
    expect(raised).toBeGreaterThan(inspect(raw).sharpness * 3);
  });

  it('pushes ordinary paper past the brightness bound', () => {
    const raw = pageWithBrightFeature();
    expect(inspect(raw).meanLuma).toBeLessThan(LUMA_HIGH);
    expect(inspect(enhance(raw)).meanLuma).toBeGreaterThan(LUMA_HIGH);
  });

  it('leaves the raw page inside every bound — the constants were never wrong', () => {
    // Measured across 94 real fixture photographs: max mean luma 206.6, and
    // 0/94 exceed LUMA_HIGH. The thresholds only ever misfired because they
    // were pointed at the wrong image.
    const r = inspect(pageWithBrightFeature());
    expect(r.glare).toBeLessThanOrEqual(GLARE_BAD);
    expect(r.meanLuma).toBeLessThan(LUMA_HIGH);
  });
});

/**
 * ⚠️ A SOURCE CHECK, BECAUSE THE BEHAVIOURAL TESTS ABOVE CANNOT CATCH THIS.
 *
 * They prove enhance() corrupts the numbers. They cannot prove capture.ts
 * feeds inspect() the uncorrupted image — that is one argument at one call
 * site, and passing the wrong one produces a scanner that still works, still
 * saves, still grades, and is simply wrong about why.
 */
describe('capture.ts inspects the photograph, not the enhancement', () => {
  const SOURCE = readFileSync(
    join(process.cwd(), 'lib/scan/capture.ts'),
    'utf8',
  );

  it('never calls inspect() on the enhanced raster', () => {
    expect(SOURCE).not.toMatch(/\binspect\(\s*better\s*\)/);
  });

  it('calls inspect() on the rectified page before cleanup', () => {
    expect(SOURCE).toMatch(/\binspect\(\s*flat\s*\)/);
  });
});
