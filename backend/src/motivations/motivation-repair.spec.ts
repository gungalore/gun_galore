import { applyRepairs, repairTargets } from './motivation-repair';

// ────────────────────────────────────────────────────────────────────
// MENDING A SENTENCE INSTEAD OF BINNING A DOCUMENT.
//
// ⚠️ THE DANGEROUS DIRECTION IS REPAIRING TOO MUCH, NOT TOO LITTLE. A refused
// WORD is a slip. A refused CLAIM — a wrong section, an annexure that does not
// exist, a purpose nobody stated — is the writer corrupting facts in a document
// the applicant signs, and section 120(9)(f) makes a false statement an
// offence. Rephrasing one of those would hide it. Most of what is pinned below
// is this returning null.
// ────────────────────────────────────────────────────────────────────

const CATALOGUE =
  'the document says "engage targets", which is catalogue copy rather than a reason';
const COMPARISON =
  'the document says "terminal ballistic" outside any sentence comparing this firearm with one already held, which is catalogue copy rather than a reason';

const TEXT = [
  '6. Firearms already licensed to me',
  'The CZ handgun in 6.35MM BROWNING is licensed under section 16 and is ' +
    'restricted to close-range hand-held use, meaning it cannot engage ' +
    'targets at extended rifle distances.',
].join(String.fromCharCode(10) + String.fromCharCode(10));

describe('what is worth mending', () => {
  it('⚠️ FINDS THE ONE SENTENCE IN A NINE-HUNDRED-WORD DOCUMENT', () => {
    // MO000075's fourth refusal, verbatim: structurally clean, sameness 0.00,
    // and thrown away for two words in one sentence.
    const targets = repairTargets(TEXT, [CATALOGUE]);
    expect(targets).toHaveLength(1);
    expect(targets![0].phrases).toEqual(['engage targets']);
    expect(targets![0].sentence).toContain('cannot engage');
    // Verbatim, so the splice can be an exact swap and never a fuzzy match.
    expect(TEXT).toContain(targets![0].sentence);
  });

  it('gathers two complaints about one sentence into one rewrite', () => {
    const text =
      'Its terminal ballistics prevent it from engaging targets at range.';
    const targets = repairTargets(text, [
      COMPARISON,
      'the document says "engaging targets", which is catalogue copy rather than a reason',
    ]);
    expect(targets).toHaveLength(1);
    expect(targets![0].phrases.sort()).toEqual([
      'engaging targets',
      'terminal ballistic',
    ]);
  });
});

describe('⚠️ WHAT IT REFUSES TO TOUCH', () => {
  it('⚠️ ANY COMPLAINT THAT IS NOT ABOUT A WORD', () => {
    // These are the writer corrupting facts. They must still fail the document
    // to an admin — a pass that "mended" a wrong serial by rephrasing it would
    // be the worst thing in this feature.
    for (const claim of [
      'the document cites Annexure J, and the pack has no Annexure J',
      "the document says the applicant's MARLIN is licensed under section 15, and the card says section 16",
      "the document says the applicant's CZ is for 'hunt', and nothing in the pack states what it is licensed for",
    ]) {
      expect(repairTargets(TEXT, [claim])).toBeNull();
    }
  });

  it('⚠️ A MIXED SET, EVEN IF ONE OF THEM IS ONLY A WORD', () => {
    // All or nothing. Mending the word and failing on the claim would leave a
    // document that reads better and is still wrong.
    expect(
      repairTargets(TEXT, [
        CATALOGUE,
        'the document cites Annexure J, and the pack has no Annexure J',
      ]),
    ).toBeNull();
  });

  it('a phrase the gate saw and this cannot find', () => {
    // Something disagrees between the two. Change nothing.
    expect(
      repairTargets('A clean sentence.', [CATALOGUE]),
    ).toBeNull();
  });

  it('⚠️ A DRAFT THAT NEEDS WHOLESALE REWRITING', () => {
    // Past a handful of sentences the honest answer is that the draft is
    // wrong, and regenerating is what should happen.
    const many = Array.from(
      { length: 6 },
      (_, i) => `Sentence ${i} will engage targets today.`,
    ).join(' ');
    expect(repairTargets(many, [CATALOGUE])).toBeNull();
  });

  it('nothing to do', () => {
    expect(repairTargets(TEXT, [])).toBeNull();
  });
});

describe('⚠️ PUTTING IT BACK', () => {
  it('swaps exactly, and leaves the rest of the document alone', () => {
    const out = applyRepairs(TEXT, [
      {
        original:
          'The CZ handgun in 6.35MM BROWNING is licensed under section 16 and is ' +
          'restricted to close-range hand-held use, meaning it cannot engage ' +
          'targets at extended rifle distances.',
        replacement:
          'The CZ handgun in 6.35MM BROWNING is licensed under section 16 and is ' +
          'restricted to close-range hand-held use, so it cannot be shot at ' +
          'extended rifle distances.',
      },
    ]);
    expect(out).not.toMatch(/engage targets/);
    expect(out).toContain('6. Firearms already licensed to me');
    expect(out).toContain('6.35MM BROWNING');
  });

  it('⚠️ LEAVES A SENTENCE ALONE IF THE ORIGINAL COMES BACK ALTERED', () => {
    // The model is asked to echo the original so this can find it. A fuzzy
    // splice into a document somebody signs is not worth the sentence it
    // saves — and the gate that follows refuses the document anyway.
    const out = applyRepairs(TEXT, [
      { original: 'A sentence that is not in the document.', replacement: 'x' },
    ]);
    expect(out).toBe(TEXT);
  });

  it('ignores an empty replacement rather than deleting the sentence', () => {
    const targets = repairTargets(TEXT, [CATALOGUE])!;
    const out = applyRepairs(TEXT, [
      { original: targets[0].sentence, replacement: '' },
    ]);
    expect(out).toBe(TEXT);
  });
});
