import { templateCatalogue } from './motivation-templates';
import {
  COLOURWAYS,
  COLOURWAY_KEYS,
  FORMAT_FEATURES,
  FORMAT_KEYS,
  asColourway,
  asFormat,
} from './motivation-pdf.service';

// ────────────────────────────────────────────────────────────────────
// THE CATALOGUE IS A VIEW OVER THE RENDERER, NOT A SECOND COPY OF IT.
//
// The whole risk this file guards is one failure: a member picks a colour in
// the picker, pays, and the PDF arrives in a different one. That happens the
// moment the catalogue holds its own idea of what "forest" means, so what is
// tested here is mostly IDENTITY — that every value the picker shows came out
// of the module that actually draws the document.
// ────────────────────────────────────────────────────────────────────

describe('the template catalogue', () => {
  const cat = templateCatalogue();

  it('offers exactly the fifteen the renderer can draw', () => {
    // 5 colourways x 3 formats. Operator, 2026-08-19.
    expect(cat.formats.map((f) => f.key)).toEqual(FORMAT_KEYS);
    expect(cat.colours.map((c) => c.key)).toEqual(COLOURWAY_KEYS);
    expect(cat.formats.length * cat.colours.length).toBe(15);
  });

  it('serves the renderer’s own hex values, not a copy of them', () => {
    // ⚠️ THE FAILURE THIS PREVENTS: somebody adjusts an ink in
    // motivation-pdf.service.ts, the picker goes on showing the old one, and
    // a member pays for a colour they were shown and did not get.
    for (const c of cat.colours) {
      expect({ ink: c.ink, tint: c.tint, rule: c.rule }).toEqual(COLOURWAYS[c.key]);
    }
  });

  it('serves the renderer’s own section sets', () => {
    // The preview draws its blocks from these flags, so a mismatch means the
    // mock page shows a table the PDF will not contain.
    for (const f of cat.formats) {
      expect(f.features).toEqual(FORMAT_FEATURES[f.key]);
    }
  });

  it('opens on the same default the renderer falls back to', () => {
    // ⚠️ asFormat/asColourway fall back for an unrecognised value, so a
    // catalogue advertising a different default would show a member a
    // selection their document does not actually have — on every pack written
    // before they touched the picker.
    expect(cat.defaults.format).toBe(asFormat(undefined));
    expect(cat.defaults.colourway).toBe(asColourway(undefined));
  });

  it('describes structure and never strength', () => {
    // ⚠️ THE STANDING RULE ON EVERY SURFACE OF THIS PRODUCT. "Comprehensive"
    // adds SECTIONS. It does not add a better argument or a better chance, and
    // saying otherwise would be both an outcome claim and false — the same
    // facts make the same case at any length.
    const text = JSON.stringify(cat).toLowerCase();
    for (const banned of [
      'chance',
      'approv',
      'success',
      'likely',
      'guarantee',
      'strongest',
      'best result',
      'more persuasive',
      'improves',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('gives every format something to say for itself', () => {
    for (const f of cat.formats) {
      expect(f.name).toBeTruthy();
      expect(f.blurb).toBeTruthy();
      expect(f.lengthHint).toBeTruthy();
      expect(f.includes.length).toBeGreaterThan(1);
    }
    for (const c of cat.colours) expect(c.name).toBeTruthy();
  });

  it('orders the formats shortest to longest', () => {
    // The rail is scanned left to right as "how much", so the order has to
    // agree with that reading. Counted by how many optional blocks each set
    // switches on.
    const weight = (f: (typeof cat.formats)[number]) =>
      Object.values(f.features).filter(Boolean).length;
    const weights = cat.formats.map(weight);
    expect([...weights].sort((a, b) => a - b)).toEqual(weights);
  });
});
