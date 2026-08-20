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
  firearm_serial: 'BR009252',
  firearm_calibre: '5.56 x 45 MM NATO',
  existing_firearm_1_barrel_serial: 'ZA2226548',
};

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
