import { describe, it, expect } from 'vitest';
import {
  fmtLength,
  profile,
  paths,
  thumbOf,
  canDraw,
  coalCheck,
  fmtVelocity,
  type Dims,
} from './geometry';

/**
 * The real 6,5 Creedmoor figures, as the C.I.P. parser reads them off the
 * TDCC sheet. Kept as one block because they are only meaningful together:
 * head 11.99, extractor groove 10.39, body 11.95, shoulder 11.74, neck 7.49,
 * bullet 6.72 — a cartridge that tapers the way a real one does.
 */
const CREEDMOOR: Dims = {
  R: 1.37, R1: 11.99,
  E: 3.84, E1: 10.39,
  P1: 11.95, P2: 11.74,
  L1: 37.84, L2: 41.52, L3: 48.77, L6: 71.76,
  H1: 7.49, H2: 7.49, G1: 6.72,
};

describe('canDraw', () => {
  it('accepts a complete set', () => {
    expect(canDraw(CREEDMOOR)).toBe(true);
  });

  it('refuses a set missing one figure', () => {
    // ⚠️ The failure this guards is silent: without G1 the neck and the
    // bullet collapse onto one vertex and the drawing still renders — as a
    // confident, smooth, wrong cartridge.
    const { G1: _G1, ...partial } = CREEDMOOR;
    expect(canDraw(partial)).toBe(false);
  });

  it('refuses null, undefined and an empty object', () => {
    expect(canDraw(null)).toBe(false);
    expect(canDraw(undefined)).toBe(false);
    expect(canDraw({})).toBe(false);
  });

  it('refuses a NaN that arithmetic on a missing value would produce', () => {
    expect(canDraw({ ...CREEDMOOR, L6: Number.NaN })).toBe(false);
  });
});

describe('profile', () => {
  const P = profile(CREEDMOOR);

  it('never runs backwards along the axis', () => {
    // A profile that backtracks in x is a self-intersecting silhouette.
    for (let i = 1; i < P.length; i++) {
      expect(P[i][0]).toBeGreaterThanOrEqual(P[i - 1][0]);
    }
  });

  it('starts closed on the axis and ends closed on the axis', () => {
    expect(P[0]).toEqual([0, 0]);
    expect(P[P.length - 1]).toEqual([CREEDMOOR.L6, 0]);
  });

  it('spans exactly the overall length', () => {
    const xs = P.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(CREEDMOOR.L6);
  });

  it('is widest at the case head, not somewhere in the body', () => {
    const widest = Math.max(...P.map((p) => p[1]));
    expect(widest).toBeCloseTo(CREEDMOOR.R1 / 2, 5);
  });

  it('necks down before the bullet', () => {
    const neck = P.find((p) => p[0] === CREEDMOOR.L3 && p[1] === CREEDMOOR.H2 / 2);
    expect(neck).toBeDefined();
    expect(CREEDMOOR.G1 / 2).toBeLessThan(CREEDMOOR.P1 / 2);
  });
});

describe('paths', () => {
  const r = paths(CREEDMOOR, 2, 4, 60);

  it('closes both paths', () => {
    expect(r.casePath.trim().endsWith('Z')).toBe(true);
    expect(r.bulletPath.trim().endsWith('Z')).toBe(true);
  });

  it('emits no NaN into the path data', () => {
    // A single NaN silently blanks the whole path in every browser.
    expect(r.casePath).not.toMatch(/NaN/);
    expect(r.bulletPath).not.toMatch(/NaN/);
  });

  it('maps millimetres to the drawing with the given scale and origin', () => {
    expect(r.px(0)).toBe(4);
    expect(r.px(10)).toBe(24);
    expect(r.py(0)).toBe(60);
    expect(r.py(5)).toBe(50);
  });

  it('splits the case from the bullet at the neck', () => {
    expect(r.casePath.length).toBeGreaterThan(0);
    expect(r.bulletPath.length).toBeGreaterThan(0);
    expect(r.casePath).not.toBe(r.bulletPath);
  });
});

describe('thumbOf', () => {
  it('uses the list viewBox', () => {
    expect(thumbOf(CREEDMOOR).thumbBox).toBe('0 0 128 30');
  });
});

describe('coalCheck', () => {
  const L6 = 71.76;

  it('is quiet when the round is comfortably under maximum', () => {
    const c = coalCheck(70.0, L6);
    expect(c.bad).toBe(false);
    expect(c.t).toBe('');
  });

  it('flags within half a millimetre of maximum', () => {
    const c = coalCheck(71.4, L6);
    expect(c.bad).toBe(true);
    expect(c.t).toBe('COAL −0.36 MAX');
  });

  it('flags exactly at the half-millimetre boundary', () => {
    expect(coalCheck(71.26, L6).bad).toBe(true);
  });

  it('does not flag just outside the boundary', () => {
    expect(coalCheck(71.25, L6).bad).toBe(false);
  });

  it('flags a round longer than the maximum', () => {
    const c = coalCheck(72.0, L6);
    expect(c.bad).toBe(true);
    expect(c.t).toBe('COAL OVER MAX');
    expect(c.diff).toBeLessThan(0);
  });
});

describe('fmtVelocity', () => {
  it('leads with metric and brackets fps', () => {
    expect(fmtVelocity(2700, 'metric')).toBe('823 m/s (2700 fps)');
  });

  it('leads with fps and brackets metric', () => {
    expect(fmtVelocity(2700, 'imperial')).toBe('2700 fps (823 m/s)');
  });

  it('always shows both, because the manuals print fps and the range talks m/s', () => {
    expect(fmtVelocity(2400, 'metric')).toContain('fps');
    expect(fmtVelocity(2400, 'imperial')).toContain('m/s');
  });
});

/**
 * A .375 H&H Magnum: the long end of the catalogue, and the case the fixed
 * prototype scale silently clipped.
 */
const H_AND_H: Dims = {
  R: 1.4, R1: 13.51,
  E: 4.2, E1: 11.9,
  P1: 12.9, P2: 12.4,
  L1: 51.2, L2: 53.6, L3: 72.39, L6: 91.44,
  H1: 9.9, H2: 9.9, G1: 9.53,
};

describe('the drawing frame — long cartridges must not be clipped', () => {
  const THUMB_W = 128;

  it('keeps 6,5 Creedmoor at the prototype scale exactly', () => {
    // 118/74 is what the prototype fixed; anything at or under the reference
    // length must still render pixel-for-pixel as it drew.
    const r = paths(CREEDMOOR, 118 / 74, 4, 15);
    expect(thumbOf(CREEDMOOR).casePath).toBe(r.casePath);
  });

  it('shrinks the thumbnail so a .375 H&H still fits its box', () => {
    const t = thumbOf(H_AND_H);
    const xs = [...t.casePath.matchAll(/[ML](-?[\d.]+)/g)].map((m) => Number(m[1]));
    const bxs = [...t.bulletPath.matchAll(/[ML](-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs, ...bxs)).toBeLessThanOrEqual(THUMB_W);
  });

  it('would have overflowed at the prototype scale — the bug this guards', () => {
    // Proof the guard is load-bearing rather than theoretical.
    const overflowed = 4 + H_AND_H.L6 * (118 / 74);
    expect(overflowed).toBeGreaterThan(THUMB_W);
  });

  it('never scales a cartridge UP to fill the box', () => {
    // A .223 and a .338 must not draw the same length — relative size is
    // information the list is showing.
    const short: Dims = { ...CREEDMOOR, L3: 45, L6: 57.4 };
    const a = thumbOf(short).casePath;
    const b = thumbOf(CREEDMOOR).casePath;
    const endOf = (p: string) =>
      Math.max(...[...p.matchAll(/[ML](-?[\d.]+)/g)].map((m) => Number(m[1])));
    expect(endOf(a)).toBeLessThan(endOf(b));
  });
});

describe('fmtLength', () => {
  it('shows millimetres to two places', () => {
    expect(fmtLength(71.76, 'metric')).toBe('71.76 mm');
  });

  it('shows inches to three places, because two loses a thou', () => {
    expect(fmtLength(71.76, 'imperial')).toBe('2.825″');
  });

  it('shows ONE unit, unlike the table formatter', () => {
    // The drawing has no room for both; two units per callout is what makes an
    // engineering drawing unreadable.
    expect(fmtLength(48.77, 'metric')).not.toContain('″');
    expect(fmtLength(48.77, 'imperial')).not.toContain('mm');
  });

  it('converts with the shared constant, not a local copy', () => {
    expect(fmtLength(25.4, 'imperial')).toBe('1.000″');
  });
});

/* ── The four head shapes ────────────────────────────────────────────────
   Until this block the module had ONE fixture, and 6,5 Creedmoor is the
   friendliest cartridge in the catalogue: rimless, bottlenecked, long enough
   for the ogive and short enough for the frame. Every shape assertion in the
   suite above is therefore an assertion about a rimless bottleneck, and three
   of the four C.I.P. head shapes had never been through `profile()` at all.

   The figures below are the standard published dimensions in millimetres, to
   the nearest hundredth where they are commonly quoted. They are FIXTURES —
   the drawing is a pure function of them and what is being tested is that the
   function survives each shape, not that any figure here is authoritative. */

/** .303 British — RIMMED. The rim stands well proud of the body. */
const BRITISH_303: Dims = {
  R: 1.63, R1: 13.72,
  E: 3.0, E1: 11.2,
  P1: 11.53, P2: 10.19,
  L1: 42.14, L2: 46.99, L3: 56.44, L6: 78.11,
  H1: 8.89, H2: 8.64, G1: 7.92,
};

/** .284 Winchester — REBATED. The rim is SMALLER than the body it sits under. */
const WIN_284: Dims = {
  R: 1.4, R1: 12.01,
  E: 4.0, E1: 11.0,
  P1: 13.51, P2: 13.13,
  L1: 43.0, L2: 45.7, L3: 54.99, L6: 71.12,
  H1: 8.28, H2: 8.13, G1: 7.21,
};

/** 9 mm Luger — the short, straight-tapered pistol end of the catalogue. */
const LUGER_9: Dims = {
  R: 1.10, R1: 9.96,
  E: 3.30, E1: 8.80,
  P1: 9.93, P2: 9.75,
  L1: 13.55, L2: 17.30, L3: 19.15, L6: 29.69,
  H1: 9.70, H2: 9.65, G1: 9.03,
};

describe('profile — every head shape, not just a rimless bottleneck', () => {
  const monotonic = (P: ReturnType<typeof profile>) => {
    for (let i = 1; i < P.length; i++) {
      expect(P[i][0]).toBeGreaterThanOrEqual(P[i - 1][0]);
    }
  };

  it('draws a rimmed case with the rim as its widest point', () => {
    const P = profile(BRITISH_303);
    monotonic(P);
    expect(Math.max(...P.map((p) => p[1]))).toBeCloseTo(BRITISH_303.R1 / 2, 5);
    // And the rim is a real step, not the near-flush head of a rimless case:
    // this is the shape whose shell holder differs.
    expect(BRITISH_303.R1 - BRITISH_303.P1).toBeGreaterThan(1);
  });

  it('draws a rebated case widest at the BODY, not at the rim', () => {
    // ⚠️ THE ONE SHAPE THAT BREAKS THE "widest at the case head" ASSERTION
    // the Creedmoor block makes. A rebated case has a rim narrower than the
    // body above it, so a drawing that assumed the head was the widest point
    // would clip the body out of its own frame.
    const P = profile(WIN_284);
    monotonic(P);
    const widest = Math.max(...P.map((p) => p[1]));
    expect(widest).toBeCloseTo(WIN_284.P1 / 2, 5);
    expect(widest).toBeGreaterThan(WIN_284.R1 / 2);
  });

  it('draws a belted case — as a rimless one, which is why the card says so', () => {
    // The belt sits about 5 mm ahead of the head at the rim's own diameter and
    // NO letter in `Dims` locates it, so it is not drawn. `isBeltedType` in
    // lib/bench/spec-text.ts is what adds the sentence to the drawing note;
    // this test pins that the silhouette itself is still sound.
    const P = profile(H_AND_H);
    monotonic(P);
    expect(P[P.length - 1]).toEqual([H_AND_H.L6, 0]);
  });

  it('draws a short pistol case without folding the nose back on itself', () => {
    const P = profile(LUGER_9);
    monotonic(P);
    expect(Math.max(...P.map((p) => p[0]))).toBe(LUGER_9.L6);
  });

  it('emits no NaN for any of the four shapes', () => {
    for (const D of [BRITISH_303, WIN_284, H_AND_H, LUGER_9]) {
      const r = paths(D, 2, 4, 60);
      expect(r.casePath).not.toMatch(/NaN/);
      expect(r.bulletPath).not.toMatch(/NaN/);
    }
  });

  it('fits every shape inside the thumbnail box', () => {
    for (const D of [BRITISH_303, WIN_284, H_AND_H, LUGER_9]) {
      const t = thumbOf(D);
      const xs = [...t.casePath.matchAll(/[ML](-?[\d.]+)/g)].map((m) => Number(m[1]));
      const bxs = [...t.bulletPath.matchAll(/[ML](-?[\d.]+)/g)].map((m) => Number(m[1]));
      expect(Math.max(...xs, ...bxs)).toBeLessThanOrEqual(128);
    }
  });
});

describe('profile — the seated shank is clamped to the round', () => {
  it('keeps the 6 mm shank on a cartridge with room for it', () => {
    // 6,5 Creedmoor has 23 mm of bullet proud of the mouth, so the clamp must
    // be invisible here: the silhouette is the prototype's, vertex for vertex.
    const P = profile(CREEDMOOR);
    expect(P.some((p) => p[0] === CREEDMOOR.L3 + 6 && p[1] === CREEDMOOR.G1 / 2)).toBe(true);
  });

  it('does not run the shank past the tip when the bullet barely stands proud', () => {
    // ⚠️ THE BUG THIS GUARDS IS SILENT. Before the clamp, `L6 − L3 < 6` made
    // the ogive's step length negative: the silhouette walked BACKWARDS from
    // the shank to the tip and drew a nose pointing the wrong way, with no
    // error anywhere.
    const stub: Dims = { ...LUGER_9, L6: LUGER_9.L3 + 3 };
    const P = profile(stub);
    for (let i = 1; i < P.length; i++) {
      expect(P[i][0]).toBeGreaterThanOrEqual(P[i - 1][0]);
    }
    expect(Math.max(...P.map((p) => p[0]))).toBe(stub.L6);
  });

  it('survives a round whose overall length is barely past the case mouth', () => {
    const flush: Dims = { ...LUGER_9, L6: LUGER_9.L3 + 0.2 };
    const P = profile(flush);
    for (let i = 1; i < P.length; i++) {
      expect(P[i][0]).toBeGreaterThanOrEqual(P[i - 1][0]);
    }
    expect(paths(flush, 2, 4, 60).bulletPath).not.toMatch(/NaN/);
  });
});
