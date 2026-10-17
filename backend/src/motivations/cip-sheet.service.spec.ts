import { CipSheetService } from './cip-sheet.service';

// ────────────────────────────────────────────────────────────────────
// THE CARD'S SPELLING IS NOT THE SHEET'S (2026-10-17).
//
// The C.I.P. index files "9 mm Luger" as `9luger` and "6,5 Creedmoor" as
// `65creedmoor`. A SAPS card prints "9MM PAR ( 9X19MM )" and "6.5MM
// CREEDMOOR", and `cartridgeKey` alone reduced those to `9par` and
// `65mmcreedmoor` — no sheet, no dimension page, on the most common calibres
// in the product. `calibreCandidates` is the one list that already knows the
// aliases.
// ────────────────────────────────────────────────────────────────────

describe('C.I.P. lookup accepts the card, not only the reference name', () => {
  const cip = new CipSheetService();

  it('finds 9 mm Luger from the SAPS card spelling', () => {
    for (const printed of [
      '9MM PAR ( 9X19MM )',
      '9mm Parabellum',
      '9x19mm',
      '9 mm Luger',
    ]) {
      expect(cip.lookup(printed)?.name).toBe('9 mm Luger');
    }
  });

  it('finds 6.5 Creedmoor from the card spelling', () => {
    expect(cip.lookup('6.5MM CREEDMOOR')?.name).toBe('6,5 Creedmoor');
    expect(cip.lookup('6,5 Creedmoor')?.name).toBe('6,5 Creedmoor');
  });

  it('finds the .45-70 Government the card prints', () => {
    expect(cip.lookup('.45-70 GOVERNMENT')?.name).toMatch(/45-70/);
  });

  it('finds .30-06 from both the card and the Bench spelling', () => {
    // The card prints ".30-06 SPRINGFIELD"; the Bench row and the C.I.P. index
    // both say "30-06 Spring.". The candidate list has to cross that gap or the
    // cover falls back to a photograph and 5.1 loses its sheet (MO000098).
    expect(cip.lookup('.30-06 SPRINGFIELD')?.name).toBe('30-06 Spring.');
    expect(cip.lookup('30-06 Spring.')?.name).toBe('30-06 Spring.');
  });

  it('still refuses to guess a cartridge it does not hold', () => {
    expect(cip.lookup('6.5 Grendel Wildcat')).toBeNull();
  });
});
