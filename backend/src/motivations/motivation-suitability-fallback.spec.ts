import { purposeFallback } from './motivation-suitability-fallback';

// ────────────────────────────────────────────────────────────────────
// THE 5.2 SHEET WHEN THE RESEARCH IS ABSENT.
//
// MO000100 printed five bullets, all third person — "the applicant is alone",
// "during the applicant's work", "a combination he can keep" — on a page the
// applicant signs, immediately after eight sections written in the first
// person. And they filled one column of two.
// ────────────────────────────────────────────────────────────────────

const NOTES = [
  'Communal access: a shared entrance.',
  'The daily commute: a regular route.',
  'The driveway gate: a vehicle stopped at a gate.',
  'A home at night: a break-in at night.',
];

const all = (purpose: Parameters<typeof purposeFallback>[0]) =>
  purposeFallback(purpose).join('\n');

describe('purposeFallback', () => {
  it('⚠️ IS FIRST PERSON THROUGHOUT', () => {
    const text = all({
      purposeKind: 'self_defence',
      purposeNotes: NOTES,
      suitabilityLabel: 'Why 6.35mm Browning suits this purpose',
      firearmLine: 'CZ 6.35mm Browning, serial 81815',
    });
    // The third person is what shipped, and it is the whole defect: a document
    // signed by the applicant may not refer to "the applicant" or to "he".
    expect(text).not.toMatch(/\bthe applicant\b/i);
    expect(text).not.toMatch(/\bthe applicant's\b/i);
    expect(text).not.toMatch(/\b(he|his|him)\b/i);
    expect(text).toMatch(/\bI am alone\b/);
  });

  it('⚠️ FILLS THE SHEET: enough bullets to close two columns', () => {
    for (const kind of ['self_defence', 'hunting', 'sport'] as const) {
      const bullets = purposeFallback({
        purposeKind: kind,
        purposeNotes: NOTES,
        suitabilityLabel: 'Why 6.35mm Browning suits this purpose',
        firearmLine: 'CZ 6.35mm Browning, serial 81815',
      });
      // Five bullets filled one column and a third of the other; the page then
      // reads as one that ran out of things to say.
      expect(bullets.length).toBeGreaterThanOrEqual(6);
      for (const b of bullets) expect(b.startsWith('- ')).toBe(true);
    }
  });

  it('names the exhibits the pack actually prints', () => {
    const text = all({
      purposeKind: 'self_defence',
      purposeNotes: NOTES,
      suitabilityLabel: 'Why 9mm Parabellum suits this purpose',
      firearmLine: 'Glock 19, serial ABC123',
    });
    expect(text).toContain('Communal access');
    expect(text).toContain('The driveway gate');
  });

  it('⚠️ MAKES NO AMMUNITION-AVAILABILITY CLAIM', () => {
    // A dimension sheet proves the cartridge is standardised; it proves
    // nothing about what a dealer stocks, and 6.35mm Browning disproves the
    // claim outright.
    const text = all({
      purposeKind: 'self_defence',
      purposeNotes: NOTES,
      suitabilityLabel: 'Why 6.35mm Browning suits this purpose',
      firearmLine: 'CZ 6.35mm Browning, serial 81815',
    });
    expect(text).not.toMatch(/readily available/i);
    expect(text).not.toMatch(/common service calibre/i);
    expect(text).not.toMatch(/in stock/i);
  });

  it('⚠️ RECITES NO DIMENSION, VELOCITY OR ENERGY FIGURE', () => {
    const text = all({
      purposeKind: 'self_defence',
      purposeNotes: NOTES,
      suitabilityLabel: 'Why 6.35mm Browning suits this purpose',
      firearmLine: 'CZ 6.35mm Browning, serial 81815',
    });
    // The calibre's own name carries its bore diameter ("6.35mm"); that is the
    // firearm's name, not a specification. Everything else is refused.
    const withoutTheName = text.replace(/6\.35mm Browning/gi, 'the cartridge');
    expect(withoutTheName).not.toMatch(
      /\d+(\.\d+)?\s*(mm|bar|m\/s|joule|ft-lb)/i,
    );
  });

  it('knows a shotgun cannot be carried on the person', () => {
    const text = all({
      purposeKind: 'self_defence',
      purposeNotes: NOTES,
      suitabilityLabel: 'Why 12 Gauge suits this purpose',
      firearmLine: 'Remington 870, serial SHOT1',
    });
    // The "carried on the person" line is the strongest sentence for a handgun
    // and false for a shotgun, which section 13 also admits.
    expect(text).not.toMatch(/carry on my person/);
    expect(text).toMatch(/kept at hand where that risk occurs/);
    // ⚠️ A GAUGE IS NOT A DISTANCE ARGUMENT. The rifle half once applied to
    // every long gun and told a section 14 applicant their rifle was "too long
    // to work in a doorway".
    expect(text).not.toMatch(/at distances a handgun cannot be used/);
  });

  it('⚠️ argues the RIFLE by the ground outside the house, not against itself', () => {
    const text = all({
      purposeKind: 'self_defence',
      purposeNotes: NOTES,
      suitabilityLabel: 'Why .223 Remington suits this purpose',
      firearmLine: 'Nordiske Precision .223 Remington, serial ZA2226548',
    });
    // The reason for a rifle in a section 14 application is the distance and
    // the open ground, and the page has to say so.
    expect(text).toMatch(/open ground/);
    expect(text).toMatch(/at distances a handgun cannot be used at/);
    // ⚠️ THIS SENTENCE ARGUED AGAINST THE APPLICANT'S OWN FIREARM.
    expect(text).not.toMatch(/too long to work in a doorway/);
    expect(text).not.toMatch(/at the short distance at which those encounters/);
  });
});
