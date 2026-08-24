import { templateCatalogue } from './motivation-templates';
import {
  DEFAULT_SCHEME,
  FORMAT_FEATURES,
  FORMAT_KEYS,
  SCHEMES,
  SCHEME_KEYS,
  asFormat,
  asScheme,
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

  it('offers exactly what the renderer can draw', () => {
    // \u26a0\ufe0f ONE FORMAT, ELEVEN SCHEMES. It was five colourways x three formats;
    // the operator withdrew the two shorter formats on 2026-08-21 ("only
    // comprehensive stays") and the palette became the ten schemes from the
    // design handoff. On 2026-08-24 the house scheme joined them at the head
    // of the list — the site's own near-black and red — and became the default.
    expect(cat.formats.map((f) => f.key)).toEqual(FORMAT_KEYS);
    expect(cat.formats).toHaveLength(1);
    expect(cat.colours.map((c) => c.key)).toEqual(SCHEME_KEYS);
    expect(cat.colours).toHaveLength(SCHEME_KEYS.length);
    expect(cat.colours[0].key).toBe('alloutdoor');
  });

  it('serves the renderer’s own hex values, not a copy of them', () => {
    // ⚠️ THE FAILURE THIS PREVENTS: somebody adjusts an ink in
    // motivation-pdf.service.ts, the picker goes on showing the old one, and
    // a member pays for a colour they were shown and did not get.
    for (const c of cat.colours) {
      const { key, name, ...colours } = c;
      expect(colours).toEqual(SCHEMES[key]);
      expect(name).toBeTruthy();
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
    expect(cat.defaults.colourway).toBe(asScheme(undefined));
    expect(cat.defaults.colourway).toBe(DEFAULT_SCHEME);
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

  it('opens the scheme list on the handoff default', () => {
    // The picker shows these in order, so the one it opens on has to be first.
    expect(cat.colours[0].key).toBe(DEFAULT_SCHEME);
  });

  it('carries all nine scheme variables, none of them blank', () => {
    // The preview draws a gradient banner, a footer strip and wash panels from
    // these. A missing one renders as transparent rather than as an error.
    // `accent` joined them on 2026-08-24 and is the one the preview most needs
    // to show: it is the only saturated colour a member will see on the page.
    for (const c of cat.colours) {
      for (const k of ['deep','deep2','ink','sub','mut','band','hair','wash','accent'] as const) {
        expect(c[k]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
