import { repointAnnexureRefs } from './motivation-annexure-refs';

const PACK = [
  { letter: 'A', label: 'Copy of the applicant’s identity document' },
  { letter: 'D', label: 'Photographs of the safe' },
  { letter: 'E', label: 'Existing firearm licence(s)' },
  { letter: 'F', label: 'Association membership proof' },
];

describe('repointAnnexureRefs', () => {
  // The exact MO000057 fault: membership proof was lettered F by the time the
  // pack printed, but the body still said E.
  it('corrects the letter when the title moved', () => {
    const text =
      'I am a member of SA Hunters (Refer to Annexure E: Association membership proof).';
    expect(repointAnnexureRefs(text, PACK)).toBe(
      'I am a member of SA Hunters (Refer to Annexure F: Association membership proof).',
    );
  });

  it('leaves a citation alone when its letter is already right', () => {
    const text = '(Refer to Annexure D: Photographs of the safe)';
    expect(repointAnnexureRefs(text, PACK)).toBe(text);
  });

  it('matches the title despite case and a trailing full stop', () => {
    const text = '(refer to annexure B: photographs of the safe.)';
    expect(repointAnnexureRefs(text, PACK)).toBe(
      '(Refer to Annexure D: Photographs of the safe)',
    );
  });

  // ⚠️ A title this pack does not carry must be left exactly as written: the
  // re-pointer corrects a known pair, it never invents an annexure.
  it('leaves a citation whose title is not in the pack untouched', () => {
    const text = '(Refer to Annexure C: Endorsement letter)';
    expect(repointAnnexureRefs(text, PACK)).toBe(text);
  });

  it('leaves a bare letter with no title untouched', () => {
    const text = '(Refer to Annexure E)';
    expect(repointAnnexureRefs(text, PACK)).toBe(text);
  });

  it('rewrites every citation in the document, not just the first', () => {
    const text =
      '(Refer to Annexure E: Association membership proof) and again (Refer to Annexure E: Association membership proof).';
    expect(repointAnnexureRefs(text, PACK)).toBe(
      '(Refer to Annexure F: Association membership proof) and again (Refer to Annexure F: Association membership proof).',
    );
  });

  it('returns the text unchanged when there are no annexures', () => {
    const text = '(Refer to Annexure E: Association membership proof)';
    expect(repointAnnexureRefs(text, [])).toBe(text);
  });
});
