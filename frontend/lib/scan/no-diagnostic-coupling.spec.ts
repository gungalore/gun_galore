import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ⚠️ A GUARD AGAINST ONE SPECIFIC, ALREADY-SHIPPED BUG.
 *
 * The scanner's capture gate read `still` from `trailRef` — the diagnostics
 * trail, which is written only inside `if (diagRef.current)`. With the panel
 * closed the trail is empty, the `?? 255` fallback fires every frame, the
 * phone is never "still", and the shutter can never fire. The scanner tracked
 * the document perfectly and then declined to photograph it, for every member
 * who was not the operator with the panel open.
 *
 * A feature that works only while it is being observed cannot be caught by
 * testing it while observing it, which is why this is a source check rather
 * than a behavioural one. The rule: `trailRef` is a MIRROR for humans to read.
 * Nothing that decides anything may read it.
 */
const SOURCE = readFileSync(
  join(__dirname, '..', '..', 'components', 'scan', 'document-scanner.tsx'),
  'utf8',
);

/** Strip block and line comments — the rule is about code, not prose about it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the guidance gate may not depend on diagnostics being open', () => {
  it('does not read trailRef inside the guidance computation', () => {
    const body = code(SOURCE);
    const start = body.indexOf('const next = guidanceFor({');
    expect(start).toBeGreaterThan(-1);
    const call = body.slice(start, body.indexOf('});', start));
    expect(call).not.toContain('trailRef');
  });

  it('derives stillness from the measurement the detector maintains', () => {
    const body = code(SOURCE);
    expect(body).toContain('const motionNow = motion;');
  });

  it('keeps every trailRef read out of the draw loop gate', () => {
    // The panel's own reads are fine — they are inside the JSX that only
    // renders when the panel is open. What must not happen is a read between
    // the draw loop opening and the guidance being decided.
    const body = code(SOURCE);
    const draw = body.indexOf('const draw = () => {');
    const decided = body.indexOf('const next = guidanceFor({');
    expect(draw).toBeGreaterThan(-1);
    expect(decided).toBeGreaterThan(draw);
    expect(body.slice(draw, decided)).not.toContain('trailRef');
  });
});
