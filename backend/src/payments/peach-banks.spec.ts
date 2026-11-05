import {
  normaliseBankName,
  universalBranchCodeFor,
  evaluateBanvMatches,
} from './peach-banks';

describe('peach-banks', () => {
  it('maps friendly SA bank names to the Peach enum', () => {
    expect(normaliseBankName('FNB')).toBe('FNB');
    expect(normaliseBankName('Standard Bank')).toBe('STANDARD BANK');
    expect(normaliseBankName('Capitec')).toBe('CAPITEC BANK');
    expect(normaliseBankName('Investec')).toBe('INVESTEC BANK LIMITED');
  });

  it('returns null for an unrecognised bank rather than guessing', () => {
    expect(normaliseBankName('Bank of Nowhere')).toBeNull();
    expect(normaliseBankName(null)).toBeNull();
  });

  it('resolves universal branch codes and refuses unknown ones', () => {
    expect(universalBranchCodeFor('FNB')).toBe('250655');
    expect(universalBranchCodeFor('ABSA')).toBe('632005');
    expect(universalBranchCodeFor('YWBN MUTUAL BANK')).toBeNull();
  });

  it('passes BANV only on account + ID ownership + open + accepts credits', () => {
    expect(
      evaluateBanvMatches({
        accountNumber: 'positive',
        idNumber: 'positive',
        accountOpen: 'positive',
        accountAcceptsCredits: 'positive',
        initials: 'negative',
        lastName: 'negative',
      }),
    ).toBe('passed');
    expect(
      evaluateBanvMatches({
        accountNumber: 'positive',
        idNumber: 'negative',
        accountOpen: 'positive',
      }),
    ).toBe('mismatch');
  });
});
