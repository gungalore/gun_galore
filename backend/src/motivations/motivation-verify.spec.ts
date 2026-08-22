import { citedAnnexures, packConsistency } from './motivation-verify';

// The checks that must never be probabilistic: the serial IS the firearm, a
// cited annexure letter IS a promise about the pack, the ID IS the applicant.

const ANNEXURES = [
  { letter: 'A', label: 'Copy of ID' },
  { letter: 'D', label: 'Address confirmation' },
  { letter: 'K', label: 'Membership certificates' },
];

const ANSWERS = {
  id_number: '8905125220089',
  firearm_make: 'Barrett',
  firearm_serial: 'BR009252',
  firearm_calibre: '5.56 x 45 MM NATO',
  existing_firearm_1_barrel_serial: 'ZA2226548',
};

// The clock is pinned so the date checks read the same in a year's time. The
// ID above puts the applicant's birth date at 12 May 1989.
const AS_AT = new Date('2026-08-22T09:00:00Z');

const CLEAN = `
My identity number is 890512 5220 089. (Refer to Annexure A: Copy of ID)
I apply for a Barrett in 5,56x45mm NATO, Serial Number: BR009252.
My address is confirmed. (Refer to Annexure D: Address Confirmation)
I already own a rifle, Serial No: ZA2226548, licensed to me.
(Refer to Annexure K: Membership Certificates)
`;

describe('citedAnnexures', () => {
  it('finds every letter, once, sorted', () => {
    expect(citedAnnexures(CLEAN)).toEqual(['A', 'D', 'K']);
  });
});

describe('packConsistency', () => {
  it('passes a clean document, across formatting differences', () => {
    // The ID has spaces in the doc and none in the answer; the calibre swaps
    // a comma for a point and drops spaces. Identity is letters and digits,
    // not furniture.
    expect(packConsistency(CLEAN, ANSWERS, ANNEXURES)).toEqual([]);
  });

  it('⚠️ catches a citation to an annexure the pack does not have', () => {
    const doc = CLEAN + '\n(Refer to Annexure Q: Imagined Document)';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES);
    expect(issues.some((i) => i.includes('Annexure Q'))).toBe(true);
  });

  it('⚠️ catches a missing serial', () => {
    const doc = CLEAN.replace('BR009252', 'the firearm');
    const issues = packConsistency(doc, ANSWERS, ANNEXURES);
    expect(issues.some((i) => i.includes('BR009252'))).toBe(true);
  });

  it('⚠️ catches an INVENTED serial presented as the applied-for firearm', () => {
    const doc = CLEAN + '\nSerial Number: XX999111 is the rifle I seek.';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES);
    expect(issues.some((i) => i.includes('XX999111'))).toBe(true);
  });

  it('does NOT flag an owned firearm’s serial', () => {
    // ZA2226548 appears as "Serial No: ..." and belongs to existing_firearm_1.
    expect(packConsistency(CLEAN, ANSWERS, ANNEXURES)).toEqual([]);
  });

  it('catches a missing ID number', () => {
    const doc = CLEAN.replace('890512 5220 089', 'as stated');
    const issues = packConsistency(doc, ANSWERS, ANNEXURES);
    expect(issues.some((i) => i.toLowerCase().includes('id number'))).toBe(true);
  });

  it('checks NOTHING that was never answered', () => {
    // A pack with no serial cannot fail the serial check — absence of an
    // answer is the wizard's business, not this module's.
    expect(packConsistency('A short document.', {}, [])).toEqual([]);
  });
});

// ⚠️ The two defects below are IN the approved corpus. SAPS passed both. They
// must never leave this pipeline.

describe('packConsistency — impossible dates', () => {
  it('⚠️ catches a date from before the applicant was born', () => {
    // The corpus, verbatim: "member in good standing with KSSC since
    // 11 July 1905".
    const doc =
      CLEAN + '\nI am a member in good standing with KSSC since 11 July 1905.';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES, AS_AT);
    expect(issues.some((i) => i.includes('11 July 1905'))).toBe(true);
  });

  it('catches the same date written as figures', () => {
    const doc = CLEAN + '\nMy competency certificate was issued on 11/07/1905.';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES, AS_AT);
    // Both readings — 11 July and 7 November — land in 1905.
    expect(issues.some((i) => i.includes('11/07/1905'))).toBe(true);
  });

  it('does NOT condemn a numeric date that has one possible reading', () => {
    // 05/12/1989 is 5 December 1989 to a South African and 12 May 1989 to an
    // American. One of those is after the applicant's birth, so the date
    // stands: ambiguity must never cost a customer their document.
    const doc = CLEAN + '\nMy competency certificate was issued on 05/12/1989.';
    expect(packConsistency(doc, ANSWERS, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('catches a future date the applicant never gave', () => {
    const doc = CLEAN + '\nI was granted dedicated status on 14 March 2031.';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES, AS_AT);
    expect(issues.some((i) => i.includes('14 March 2031'))).toBe(true);
  });

  it('does NOT flag a future date the applicant DID give', () => {
    // Competency and licence expiry are answers, and both are in the future.
    const answers = { ...ANSWERS, competency_expiry: '2031-03-14' };
    const doc =
      CLEAN + '\nMy competency certificate is valid until 14 March 2031.';
    expect(packConsistency(doc, answers, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('does NOT read a statutory citation as a date', () => {
    // "Act 60 of 2000" and "section 86" are the commonest numbers in these
    // documents. A date here is day, month and year or it is nothing.
    const doc =
      CLEAN +
      '\nMy safe complies with section 86 of the Firearms Control Act 60 of 2000.';
    expect(packConsistency(doc, ANSWERS, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('does NOT flag a date that is a fact about the law, not the applicant', () => {
    // A 21-year-old applicant genuinely postdates the Act's commencement.
    const answers = { id_number: '0503145220081' };
    const doc =
      'My identity number is 050314 5220 081.\n' +
      'The Firearms Control Act 60 of 2000 came into operation on 1 July 2004.';
    expect(packConsistency(doc, answers, [], AS_AT)).toEqual([]);
  });

  it('still catches a bulleted date, which cites no statute to hide behind', () => {
    const doc = CLEAN + '\nMembership: KSSC since 11 July 1905.';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES, AS_AT);
    expect(issues.some((i) => i.includes('11 July 1905'))).toBe(true);
  });

  it('checks no dates without a readable ID number', () => {
    const doc = 'I have been a member since 11 July 1905.';
    expect(packConsistency(doc, {}, [], AS_AT)).toEqual([]);
  });
});

describe('packConsistency — template rot', () => {
  // The corpus, verbatim in shape: a brand essay for a firearm the applicant
  // is not applying for, left behind by a dealer's template.
  const ROT = `
History of CZ
CZ was established in 1936 at Uhersky Brod. CZ has armed the Czech forces
ever since, and the CZ 75 changed handgun design for good.
`;

  it('⚠️ catches a brand essay for a firearm nobody in the pack owns', () => {
    const issues = packConsistency(CLEAN + ROT, ANSWERS, ANNEXURES, AS_AT);
    expect(issues.some((i) => i.includes('CZ'))).toBe(true);
  });

  it('catches the heading on its own, before any repetition', () => {
    // "History of CZ" with a single sentence under it is still a template's
    // essay. The heading is the tell.
    const doc = CLEAN + '\nHistory of CZ\nThe firm was established in 1936.\n';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES, AS_AT);
    expect(issues.some((i) => i.includes('CZ'))).toBe(true);
  });

  it('catches body text that will not stop naming another marque', () => {
    const doc =
      CLEAN +
      '\nThe Steyr is the finest rifle made. A Steyr shoots flat, a Steyr ' +
      'lasts a lifetime, a Steyr holds its value and the Steyr action is ' +
      'the smoothest in production.';
    const issues = packConsistency(doc, ANSWERS, ANNEXURES, AS_AT);
    expect(issues.some((i) => i.includes('Steyr'))).toBe(true);
  });

  it('does NOT flag research prose that argues against a rival', () => {
    // Three mentions in one breath is how a comparison actually reads.
    const doc =
      CLEAN +
      '\nThe Production division is dominated by the Glock 17. The Glock ' +
      'trigger is lighter than mine, and Glock pistols fill the national squad.';
    expect(packConsistency(doc, ANSWERS, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('does NOT flag a make the applicant already holds', () => {
    // The comparison section legitimately argues against the applicant's own
    // firearms, at length.
    const answers = { ...ANSWERS, existing_firearm_2_make: 'CZ' };
    expect(packConsistency(CLEAN + ROT, answers, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('does NOT flag a make the applicant named anywhere in their answers', () => {
    const answers = {
      ...ANSWERS,
      hunting_history: 'I learned to shoot on my father’s CZ 550 in the Karoo.',
    };
    expect(packConsistency(CLEAN + ROT, answers, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('does NOT mistake a cartridge name for a manufacturer', () => {
    // Half the famous cartridges carry a maker's name.
    const doc =
      CLEAN +
      '\nI weighed the .308 Winchester, the .270 Winchester and the .300 Winchester Magnum before settling on this calibre.';
    expect(packConsistency(doc, ANSWERS, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('does NOT flag a passing mention of another marque', () => {
    // "The division is dominated by the Glock 17" is argument, not rot.
    const doc =
      CLEAN +
      '\nThe division is dominated by the Glock 17, which I do not shoot.';
    expect(packConsistency(doc, ANSWERS, ANNEXURES, AS_AT)).toEqual([]);
  });

  it('checks no makes when the applicant never named one', () => {
    const answers = { ...ANSWERS, firearm_make: '' };
    expect(packConsistency(CLEAN + ROT, answers, ANNEXURES, AS_AT)).toEqual([]);
  });
});
