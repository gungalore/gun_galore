import type { StructurePlan } from './motivation-structure';
import {
  LINES_PER_PAGE,
  WORDS_PER_LINE,
  WORDS_PER_PAGE,
  estimatedFill,
  sectionFloor,
  sectionWordCounts,
  thinSectionNotes,
} from './motivation-fill';

// ────────────────────────────────────────────────────────────────────
// KEEPING THE PAGES FULL — the measure, not the padding.
//
// Operator, 2026-10-15: "sometimes it writes just one sentence on a page and
// the rest is empty ... can it add content to where the page is at least 50%
// full?" These pin the geometry estimate and the thin-section detector.
// ────────────────────────────────────────────────────────────────────

const plan = {
  seed: 0,
  opening: 'purpose_first',
  closing: 'declaration',
  cadence: 'plain',
  sections: [
    { id: 'introduction', heading: '1. What I am applying for', paragraphs: 1 },
    { id: 'personal_circumstances', heading: '2. My circumstances', paragraphs: 3 },
    { id: 'conclusion', heading: '12. Conclusion', paragraphs: 1 },
  ],
} as unknown as StructurePlan;

describe('the geometry estimate', () => {
  it('reads a plausible page from the layout constants', () => {
    // A4 body, ~175 mm column, ~250 mm tall. Sanity bands, not exact numbers:
    // the number only has to tell a paragraph from a sentence.
    expect(LINES_PER_PAGE).toBeGreaterThan(25);
    expect(LINES_PER_PAGE).toBeLessThan(55);
    expect(WORDS_PER_LINE).toBeGreaterThan(8);
    expect(WORDS_PER_LINE).toBeLessThan(25);
    expect(WORDS_PER_PAGE).toBeGreaterThan(300);
    expect(WORDS_PER_PAGE).toBeLessThan(800);
  });

  it('turns words into a fraction of a page', () => {
    expect(estimatedFill(0)).toBe(0);
    expect(estimatedFill(WORDS_PER_PAGE)).toBeCloseTo(1, 5);
    expect(estimatedFill(WORDS_PER_PAGE / 2)).toBeCloseTo(0.5, 5);
  });
});

describe('the per-section floor', () => {
  it('floors a long-form section above a short-by-design one', () => {
    expect(sectionFloor('personal_circumstances')).toBeGreaterThan(
      sectionFloor('introduction'),
    );
    expect(sectionFloor('conclusion')).toBeLessThan(sectionFloor('the_threat'));
  });
});

describe('counting words per section', () => {
  const text = [
    '1. What I am applying for',
    'I apply for this firearm.',
    '',
    '2. My circumstances',
    'I live on a smallholding well outside town and the work takes me away.',
    '',
    '12. Conclusion',
    'I ask the Registrar to grant it.',
  ].join('\n');

  it('counts each section between its heading and the next', () => {
    const counts = sectionWordCounts(text, [
      '1. What I am applying for',
      '2. My circumstances',
      '12. Conclusion',
    ]);
    const by = new Map(counts.map((c) => [c.heading, c.words]));
    expect(by.get('1. What I am applying for')).toBe(5);
    expect(by.get('2. My circumstances')).toBe(14);
    expect(by.get('12. Conclusion')).toBe(7);
  });
});

describe('the thin-section detector', () => {
  it('flags a one-sentence section but not a full one', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
    const text = [
      '1. What I am applying for',
      'I apply for this firearm licence today.', // 7 words — short-by-design floor (40)
      '',
      '2. My circumstances',
      words(200), // over the long-form floor
      '',
      '12. Conclusion',
      words(60), // over the short floor
    ].join('\n');

    const notes = thinSectionNotes(text, plan, 'S16_DEDICATED_SPORT');
    expect(notes.join(' ')).toContain('1. What I am applying for');
    expect(notes.join(' ')).not.toContain('2. My circumstances');
    expect(notes.join(' ')).toMatch(/not padding/);
  });
});
