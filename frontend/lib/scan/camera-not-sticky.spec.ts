import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ⚠️ A GUARD AGAINST THE LENS FREEZING ON WHATEVER THE FIRST LAUNCH SAW.
 *
 * The scanner used to sample the lenses only when it had no stored choice, and
 * then store whatever it picked. So the FIRST launch on a handset decided the
 * lens permanently. That is fine when the first launch happened to measure
 * well, and permanent when it did not — a probe run against a blank wall or in
 * poor light has nothing to rank on, the detail floor discards the good lens,
 * and the wrong answer is frozen with nothing to indicate it.
 *
 * Operator: "the setup just has to change to the lense with the longest focus
 * everytime the app starts up... don't make it sticky so it always calls up
 * the same lense it first detected."
 *
 * This is a source check because the behaviour lives in a component effect
 * around getUserMedia and enumerateDevices. A test that stubs all of that
 * proves the stub works; what matters is the one argument and the one missing
 * call, and those are readable directly.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'components/scan/document-scanner.tsx'),
  'utf8',
);

describe('the lens is chosen fresh on every start-up', () => {
  it('always samples, never conditionally on a remembered choice', () => {
    expect(SOURCE).toMatch(/probeCameras\(\s*track\s*,\s*\{\s*sample:\s*true\s*\}\s*\)/);
    // The shape that caused it: sampling only when nothing was remembered.
    expect(SOURCE).not.toMatch(/sample:\s*!remembered/);
  });

  it('⚠️ NEVER PERSISTS THE AUTOMATIC CHOICE', () => {
    // writeCameraPref must survive in exactly one place — the manual lens
    // cycle in the diagnostics panel, which is a deliberate override rather
    // than something we detected, and the escape hatch if the ranking is wrong
    // on some handset. Two call sites means the automatic path is storing
    // again and the freeze is back.
    const calls = SOURCE.match(/writeCameraPref\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('still lets a manual pick win over the automatic one', () => {
    // Not stickiness — an override. It is only ever written by the cycle
    // button, so it cannot record a lens nobody chose.
    expect(SOURCE).toMatch(/matchPref\(cams,\s*readCameraPref\(\)\)\s*\?\?\s*bestCamera\(cams\)/);
  });
});
