import {
  calibreCandidates,
  calibreKey,
  cartridgeFacts,
  type CartridgeRow,
} from './motivation-cartridge';

// ────────────────────────────────────────────────────────────────────
// THE CARTRIDGE BLOCK.
//
// Operator, 2026-09-09: "why arent we pulling in the dimension sheet of the
// cartridge its using from The Bench? And describing the cartridge and how it
// would suffice for a self defence round?"
//
// ⚠️ WHAT IS BEING PROTECTED IS A PARAGRAPH ON A SIGNED DOCUMENT. MO000071
// recited "115 to 147 grains" and "3 to 5 foot-pounds" from memory; the sheet
// carries neither, and a Registrar can correct an applicant on both.
// ────────────────────────────────────────────────────────────────────

const luger: CartridgeRow = {
  name: '9 mm Luger',
  type: 'Handgun',
  origin: 'Germany',
  year: 1902,
  caseLengthMm: 19.15,
  maxLengthMm: 29.69,
  pmaxBar: 2350,
  dims: { L3: 19.15, L6: 29.69, bF: 8.82, bZ: 9.02, bN: 6, pmaxBar: 2350 },
};

describe('matching what a licence card prints', () => {
  it('⚠️ READS THE CARD’S OWN WORDING, WHICH IS NOT THE REFERENCE FILE’S', () => {
    // The card prints "9MM PAR ( 9X19MM )"; the sheet is filed under
    // "9 mm Luger". Case, spaces and punctuation are noise on both sides.
    expect(calibreKey('9MM PAR ( 9X19MM )')).toBe('9MMPAR9X19MM');
    expect(calibreKey('9 mm Luger')).toBe('9MMLUGER');
  });

  it('⚠️ OFFERS THE BRACKETED NAME AS ITS OWN CANDIDATE', () => {
    // "9MM PAR ( 9X19MM )" carries two names for one cartridge and a sheet may
    // be filed under either. 9x19 is the likelier of the two.
    const c = calibreCandidates('9MM PAR ( 9X19MM )');
    expect(c).toContain('9X19MM');
    expect(c).toContain('9MMPAR');
  });

  it('expands the abbreviations a card uses and a reference file does not', () => {
    expect(calibreCandidates('.223 REM')).toContain('223REMINGTON');
    expect(calibreCandidates('.30-06 SPRG')).toContain('3006SPRINGFIELD');
    expect(calibreCandidates('.45-70 GOVT')).toContain('4570GOVERNMENT');
  });

  it('says nothing about an empty calibre', () => {
    expect(calibreCandidates('')).toEqual([]);
    expect(calibreCandidates('  ')).toEqual([]);
  });
});

describe('the block', () => {
  it('carries the measurements we hold', () => {
    const out = cartridgeFacts(luger) ?? '';
    expect(out).toContain('9 mm Luger');
    expect(out).toContain('Case length: 19.15 mm');
    expect(out).toContain('Bore diameter: 8.82 mm');
    expect(out).toContain('Maximum average pressure: 2350 bar');
  });

  it('⚠️ FORBIDS EVERY FIGURE THE SHEET DOES NOT CARRY', () => {
    // The two sections this replaces were built entirely out of recalled
    // ballistics. The instruction has to be in the block, beside the numbers.
    const out = cartridgeFacts(luger) ?? '';
    expect(out).toContain('do NOT add velocity, energy, stopping power');
    expect(out).toContain('grain weights');
  });

  it('⚠️ AND NAMES NO SOURCE, which is the Bench copyright boundary', () => {
    // CLAUDE.md: "nothing on any Bench surface may name where a figure comes
    // from — no manual, no CIP, no SAAMI, no published". bench.service.ts
    // enforces the same list.
    const out = (cartridgeFacts(luger) ?? '').toLowerCase();
    for (const w of ['c.i.p', 'cip', 'saami', 'manual', 'published']) {
      expect(out).not.toContain(w);
    }
    expect(out).toContain('do not name where these figures come from');
  });

  it('⚠️ REFUSES A ROW TOO THIN TO BE A SHEET', () => {
    // A name and nothing else is an invitation to fill the rest from memory,
    // which is the failure this whole block exists to remove.
    expect(cartridgeFacts({ name: '9 mm Luger' })).toBeNull();
    expect(cartridgeFacts(null)).toBeNull();
  });

  it('omits a field the sheet does not carry rather than estimating it', () => {
    const out =
      cartridgeFacts({
        name: '9 mm Luger',
        caseLengthMm: 19.15,
        maxLengthMm: 29.69,
        pmaxBar: 2350,
      }) ?? '';
    expect(out).toContain('Case length: 19.15 mm');
    expect(out).not.toContain('Bore diameter');
    expect(out).not.toContain('Grooves');
  });
});
