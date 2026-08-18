import {
  MotivationStyle,
  STYLE_COMBINATIONS,
  STYLE_FONTS,
  STYLE_FORMATS,
  STYLE_LEADINGS,
  STYLE_PALETTES,
  styleFor,
} from './motivation-style';

// This is the visual half of the anti-template work, so what matters is that
// the axes really are independent, that the look is reproducible from the
// stored seed, and that nothing here ever produces a document that looks like a
// brochure instead of something somebody typed at home.

describe('the floors the operator set', () => {
  it('meets or beats every one', () => {
    // 10 colours, 10 fonts, 3 spacings, 5 formats were the minimums.
    expect(STYLE_FONTS.length).toBeGreaterThanOrEqual(10);
    expect(STYLE_PALETTES.length).toBeGreaterThanOrEqual(10);
    expect(STYLE_LEADINGS.length).toBeGreaterThanOrEqual(3);
    expect(STYLE_FORMATS.length).toBeGreaterThanOrEqual(5);
    expect(STYLE_COMBINATIONS).toBeGreaterThan(2000);
  });

  it('has no duplicate keys on any axis', () => {
    for (const axis of [STYLE_FONTS, STYLE_PALETTES, STYLE_LEADINGS, STYLE_FORMATS]) {
      const keys = axis.map((a: { key: string }) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('the palettes stay sober', () => {
  const hex = /^#[0-9A-Fa-f]{6}$/;

  it('are all real six-digit hex', () => {
    // A malformed value would reach pdfkit and either throw or silently paint
    // black, and a hand-typed palette is exactly where a typo hides.
    for (const p of STYLE_PALETTES) {
      for (const v of [p.heading, p.body, p.rule, p.muted]) expect(v).toMatch(hex);
    }
  });

  it('never uses a bright or saturated ink for heading or body', () => {
    // This document is handed to the Registrar. The widest gap between any two
    // palettes should be black ink versus dark blue ink, and no wider.
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const p of STYLE_PALETTES) {
      for (const v of [p.heading, p.body]) {
        const [r, g, b] = rgb(v);
        const max = Math.max(r, g, b);
        expect(max).toBeLessThan(90); // dark
        expect(max - Math.min(r, g, b)).toBeLessThan(60); // low saturation
      }
    }
  });

  it('keeps the body darker than the heading, never the other way round', () => {
    const lum = (h: string) =>
      [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    for (const p of STYLE_PALETTES) {
      expect(lum(p.body)).toBeLessThanOrEqual(lum(p.heading));
      expect(lum(p.muted)).toBeGreaterThan(lum(p.body));
    }
  });
});

describe('the fonts', () => {
  it('are either a vendored file or a pdfkit built-in, never neither', () => {
    for (const f of STYLE_FONTS) {
      if (f.file === null) expect(f.builtin).toBeDefined();
      else expect(typeof f.file).toBe('string');
    }
  });

  it('does not offer a monospaced face', () => {
    // A monospaced motivation reads as a printout rather than a letter.
    const names = STYLE_FONTS.map((f) => f.name.toLowerCase()).join(' ');
    expect(names).not.toContain('courier');
    expect(names).not.toContain('mono');
  });

  it('offers both serif and sans, so the stack does not all look alike', () => {
    expect(STYLE_FONTS.some((f) => f.serif)).toBe(true);
    expect(STYLE_FONTS.some((f) => !f.serif)).toBe(true);
  });
});

describe('styleFor', () => {
  it('is reproducible — the same seed gives the same document, forever', () => {
    // Motivation.variantSeed is stored precisely so a re-render years later
    // comes out identical. If this ever changes, old documents change too.
    const a = styleFor(123456);
    const b = styleFor(123456);
    expect(a.signature).toBe(b.signature);
    // Pinned to the ACTUAL value. Its job is to fail loudly if `mix` is ever
    // changed: that would silently restyle every document already issued, and
    // a re-download would not match the copy the applicant already printed.
    expect(styleFor(1).signature).toBe('helvetica/sepia/normal/formal-centred');
  });

  it('moves the axes INDEPENDENTLY', () => {
    // The whole point. If every axis were `seed % n` on the same number they
    // would advance in lockstep and thirteen fonts would mean thirteen looks.
    const seen = {
      font: new Set<string>(),
      palette: new Set<string>(),
      leading: new Set<string>(),
      format: new Set<string>(),
      signature: new Set<string>(),
    };
    for (let seed = 0; seed < 4000; seed++) {
      const s = styleFor(seed);
      seen.font.add(s.font.key);
      seen.palette.add(s.palette.key);
      seen.leading.add(s.leading.key);
      seen.format.add(s.format.key);
      seen.signature.add(s.signature);
    }
    expect(seen.font.size).toBe(STYLE_FONTS.length);
    expect(seen.palette.size).toBe(STYLE_PALETTES.length);
    expect(seen.leading.size).toBe(STYLE_LEADINGS.length);
    expect(seen.format.size).toBe(STYLE_FORMATS.length);
    // Over 4000 seeds an independent draw should reach most of the space.
    expect(seen.signature.size).toBeGreaterThan(STYLE_COMBINATIONS * 0.65);
  });

  it('spreads each axis roughly evenly rather than favouring one value', () => {
    // A biased hash would quietly make one font the "house" font, which is the
    // failure this module exists to prevent.
    const counts = new Map<string, number>();
    const N = 13000;
    for (let seed = 0; seed < N; seed++) {
      const k = styleFor(seed).font.key;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const expected = N / STYLE_FONTS.length;
    for (const [, n] of counts) {
      expect(n).toBeGreaterThan(expected * 0.75);
      expect(n).toBeLessThan(expected * 1.25);
    }
  });

  it('survives a seed at the edges without throwing or going negative', () => {
    for (const seed of [0, 1, 2 ** 31 - 1, 2 ** 32 - 1, -1]) {
      const s: MotivationStyle = styleFor(seed);
      expect(s.font).toBeDefined();
      expect(s.palette).toBeDefined();
      expect(s.signature.split('/')).toHaveLength(4);
    }
  });
});
