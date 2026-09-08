import {
  canDraw,
  cartridgeDrawing,
  completeDims,
  profile,
  type DrawingDims,
} from './motivation-cartridge-drawing';

// ────────────────────────────────────────────────────────────────────
// THE DRAWING IN THE PACK.
//
// Operator, 2026-09-09: "you can render the cartridge in 3D with the main
// measurements and make it half a page with half a page description", then
// "that drawing does not look like a cartridge".
//
// ⚠️ THE PROFILE IS A PORT OF frontend/lib/bench/geometry.ts. The shape a
// member sees on The Bench and the shape printed in their pack must be the
// same shape, and the backend cannot import the frontend's lib. These
// assertions pin the vertex list so the two cannot drift in silence.
//
// ⚠️ EVERY SHEET BELOW IS A REAL ONE, NULLS AND ALL. The first attempt was
// tested against invented figures in which the extractor groove had the same
// diameter as the case body — so there was no groove, the head drew as a plain
// cylinder, and the tests passed. Fixtures that cannot fail are worse than no
// fixtures.
// ────────────────────────────────────────────────────────────────────

/** Rimless, tapered, no shoulder. P2, L1, L2 and H1 are not printed. */
const LUGER = {
  R: 1.27, R1: 9.96, E: 2.98, E1: 8.79, P1: 9.93, P2: null,
  L1: null, L2: null, L3: 19.15, L6: 29.69, H1: null, H2: 9.65, G1: 9.03,
};

/** Rimmed, straight-walled. No extractor groove is printed either. */
const SPECIAL = {
  R: 1.5, R1: 11.18, E: null, E1: null, P1: 9.63, P2: null,
  L1: null, L2: null, L3: 29.34, L6: 39.37, H1: null, H2: 9.63, G1: 9.12,
};

/** Bottlenecked. All thirteen letters printed. */
const REMINGTON = {
  R: 1.14, R1: 9.6, E: 3.13, E1: 8.43, P1: 9.58, P2: 9.0,
  L1: 36.52, L2: 39.55, L3: 44.7, L6: 57.4, H1: 6.43, H2: 6.43, G1: 5.7,
};

const dims = (sheet: Record<string, number | null>): DrawingDims =>
  completeDims(sheet)!.dims;

describe('completing a sheet', () => {
  it('⚠️ DRAWS THE TWO CARTRIDGES A SELF-DEFENCE APPLICANT ACTUALLY USES', () => {
    // Requiring all thirteen letters refused 9 mm Luger and .38 Special —
    // 83 of the 215 sheets held — because a case with no shoulder does not
    // print one.
    expect(completeDims(LUGER)).not.toBeNull();
    expect(completeDims(SPECIAL)).not.toBeNull();
    expect(completeDims(REMINGTON)).not.toBeNull();
  });

  it('refuses a sheet missing a figure it cannot stand in for', () => {
    expect(completeDims(null)).toBeNull();
    expect(completeDims({})).toBeNull();
    expect(completeDims({ ...LUGER, G1: null })).toBeNull();
    expect(completeDims({ ...LUGER, L6: Number.NaN })).toBeNull();
    // A tip that is not past the mouth is not a cartridge.
    expect(completeDims({ ...LUGER, L6: 19.15 })).toBeNull();
  });

  it('collapses an absent shoulder onto the mouth rather than inventing one', () => {
    const D = dims(LUGER);
    expect(D.L1).toBe(D.L3);
    expect(D.L2).toBe(D.L3);
    expect(D.P2).toBe(D.H2);
    expect(D.H1).toBe(D.H2);
    // And leaves a real shoulder exactly as printed.
    expect(dims(REMINGTON).L1).toBe(36.52);
    expect(dims(REMINGTON).P2).toBe(9.0);
  });

  it('⚠️ HOLDS THE GROOVE CLEAR OF THE RIM, or the head draws as a bow tie', () => {
    // profile() reads a vertex at E − 0.9. On a rimmed case with no groove, E
    // derived as R = 1.5 puts it at 0.6 — BEHIND the rim vertex at 1.5 — and
    // the outline runs backwards over itself. Nothing throws.
    const D = dims(SPECIAL);
    expect(D.E).toBeGreaterThanOrEqual(D.R + 0.9);
    expect(D.E1).toBe(D.P1);
  });

  it('reports which letters it had to fill in', () => {
    expect([...completeDims(LUGER)!.derived].sort()).toEqual([
      'H1',
      'L1',
      'L2',
      'P2',
    ]);
    expect([...completeDims(REMINGTON)!.derived]).toEqual([]);
  });

  it('canDraw still answers for a full set', () => {
    expect(canDraw(null)).toBe(false);
    expect(canDraw({})).toBe(false);
    expect(canDraw(dims(LUGER))).toBe(true);
  });
});

describe('the profile', () => {
  for (const [name, sheet] of [
    ['9 mm Luger', LUGER],
    ['.38 Special', SPECIAL],
    ['.223 Remington', REMINGTON],
  ] as const) {
    it(`${name} runs head to tip without folding`, () => {
      const D = dims(sheet);
      const P = profile(D);
      expect(P[0]).toEqual([0, 0]);
      expect(P[P.length - 1]).toEqual([D.L6, 0]);
      // Monotonic along the axis: a silhouette that goes backwards is a fold.
      for (let i = 1; i < P.length; i++) {
        expect(P[i][0]).toBeGreaterThanOrEqual(P[i - 1][0]);
      }
      // And never crosses the axis.
      for (const p of P) expect(p[1]).toBeGreaterThanOrEqual(0);
    });
  }

  it('⚠️ CLAMPS THE SHANK, or a short pistol case draws a nose pointing backwards', () => {
    // On a round where L6 − L3 is under 6 mm an unclamped 6 mm shank runs PAST
    // the tip, the ogive length goes negative and the silhouette folds. It
    // does not fail — it draws a cartridge that does not exist.
    const D = dims({ ...LUGER, L6: 20.0 });
    const P = profile(D);
    for (let i = 1; i < P.length; i++) {
      expect(P[i][0]).toBeGreaterThanOrEqual(P[i - 1][0]);
    }
    expect(P[P.length - 1][0]).toBe(20.0);
  });
});

describe('the drawing', () => {
  const luger = completeDims(LUGER)!;
  const d = cartridgeDrawing(
    luger.dims,
    { name: '9 mm Luger', pmaxBar: 2350 },
    { derived: luger.derived },
  );

  it('is a standalone SVG sized in millimetres of paper', () => {
    expect(d.svg.startsWith('<svg')).toBe(true);
    expect(d.svg).toContain('width="166mm"');
    expect(d.svg).toContain('viewBox="0 0 166');
    expect(d.widthMm).toBe(166);
    expect(d.heightMm).toBeGreaterThan(40);
  });

  it('⚠️ CARRIES NO LETTERING, because the rasteriser has no fonts to trust', () => {
    // librsvg has no system-ui: it falls back to whatever fontconfig offers
    // and sets the dimensions of a firearms application in a typewriter face,
    // differently in development and on the box.
    expect(d.svg).not.toContain('<text');
    expect(d.svg).not.toContain('font');
    expect(d.texts.length).toBeGreaterThan(4);
  });

  it('⚠️ ANCHORS THE SHADING IN USER SPACE, which is the whole of the "3D"', () => {
    // A gradient in the default object-bounding-box units restarts inside each
    // polygon, so the two halves take a full sweep each and the cartridge is
    // lit from two directions with a seam down the axis.
    expect(d.svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(d.svg).toContain('url(#caseBrass)');
    // The case and the seated bullet are different metals.
    expect(d.svg).toContain('url(#jacket)');
  });

  it('dimensions the case and the overall length from the sheet', () => {
    const labels = d.texts.map((t) => t.text);
    expect(labels).toContain('case 19.15 mm');
    expect(labels).toContain('overall 29.69 mm');
  });

  it('calls out the diameters the sheet printed', () => {
    const labels = d.texts.map((t) => t.text);
    expect(labels).toContain('Ø9.96'); // R1, the rim
    expect(labels).toContain('Ø8.79'); // E1, the extractor groove
    expect(labels).toContain('Ø9.03'); // G1, the bullet
  });

  it('⚠️ NEVER DIMENSIONS A LETTER THE SHEET DID NOT PRINT', () => {
    // A .38 Special has no extractor groove, so a groove diameter beside it
    // states a measurement of a feature that does not exist — and it would be
    // the body diameter, printed twice.
    const s = completeDims(SPECIAL)!;
    const sd = cartridgeDrawing(
      s.dims,
      { name: '.38 Special' },
      { derived: s.derived },
    );
    const labels = sd.texts.map((t) => t.text);
    expect(labels).toContain('Ø11.18');
    expect(labels).toContain('Ø9.12');
    // Ø9.63 is the body AND the mouth: called out once, not twice.
    expect(labels.filter((l) => l === 'Ø9.63')).toHaveLength(1);
  });

  it('⚠️ NAMES NO SOURCE — the Bench copyright boundary', () => {
    const all = (d.svg + d.texts.map((t) => t.text).join(' ')).toLowerCase();
    for (const w of ['c.i.p', 'cip', 'saami', 'manual', 'published', 'source']) {
      expect(all).not.toContain(w);
    }
  });

  it('captions with the name and the pressure ceiling', () => {
    const cap = d.texts.find((t) => t.role === 'caption')!;
    expect(cap.text).toContain('9 mm Luger');
    expect(cap.text).toContain('2350 bar');
  });

  it('omits the pressure line when the sheet has none', () => {
    const bare = cartridgeDrawing(luger.dims, { name: '9 mm Luger' });
    const cap = bare.texts.find((t) => t.role === 'caption')!;
    expect(cap.text).not.toContain('maximum average pressure');
  });

  it('keeps every label inside the drawing it is measured for', () => {
    for (const t of d.texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(d.widthMm);
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThanOrEqual(d.heightMm);
    }
  });
});
