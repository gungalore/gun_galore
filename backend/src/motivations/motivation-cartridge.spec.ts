import {
  calibreCandidates,
  calibreKey,
  cartridgeFacts,
  findCartridge,
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

// ────────────────────────────────────────────────────────────────────
// FINDING THE CARTRIDGE.
//
// ⚠️ THESE ROWS ARE THE STORED NAMES, VERBATIM. The sheets are filed as
// "357 Mag." and "308 Winchester" — one abbreviated, one not — and 9 mm Luger's
// only mention of 9×19 is buried inside a slashed alias. A fixture that tidied
// those up would test a database we do not have.
const HELD = [
  { name: '357 Mag.', slug: '357magnum', aliases: [{ printed: '.357 Mag.' }, { printed: '357 Magnum Rifle' }] },
  { name: '357 Maximum', slug: '357maximum', aliases: [{ printed: '.357 Maximum' }] },
  { name: '357 SIG', slug: '357sig', aliases: [{ printed: '357 Sig' }] },
  { name: '38 Special', slug: '38special', aliases: [{ printed: '.38 Spec.' }, { printed: '.38 Special + P' }] },
  { name: '40 S&W', slug: '40sw', aliases: [{ printed: '.40 S&W' }] },
  { name: '45 Auto', slug: '45auto', aliases: [{ printed: '.45 A.C.P.' }, { printed: '45 Automatic' }] },
  { name: '9 mm Browning court', slug: '9browningcourt', aliases: [{ printed: '.380 ACP' }, { printed: '380 Automatic (9mm Kurz)' }] },
  { name: '9 mm Luger', slug: '9luger', aliases: [{ printed: '9 MM LUGER' }, { printed: '9 mm Luger / 9x19 mm' }] },
  { name: '9 mm Makarov', slug: '9makarov', aliases: [] },
  { name: '308 Winchester', slug: '308winchester', aliases: [{ printed: '.308 Win.' }] },
  { name: '223 Remington', slug: '223remington', aliases: [{ printed: '.223 Rem.' }] },
];

const found = (q: string) => findCartridge(HELD, q)?.name ?? null;

describe('finding the cartridge a member typed', () => {
  it('takes an exact name, slug or alias', () => {
    expect(found('9 mm Luger')).toBe('9 mm Luger');
    expect(found('9luger')).toBe('9 mm Luger');
    expect(found('.38 Spec.')).toBe('38 Special');
    expect(found('.40 S&W')).toBe('40 S&W');
  });

  it('⚠️ CONTRACTS AS WELL AS EXPANDS, or ".357 Magnum" matches nothing', () => {
    // The sheet is filed as "357 Mag.". Expanding MAG → Magnum only ever
    // helped the rounds already filed under the long name, and ".357 Magnum"
    // — which is how the round is actually written — resolved to nothing.
    expect(found('.357 Magnum')).toBe('357 Mag.');
    expect(found('357 Mag')).toBe('357 Mag.');
  });

  it('⚠️ KNOWS PARABELLUM IS LUGER, which is a standards fact and not a guess', () => {
    // One round, two published names, and a member writes whichever is on the
    // box. Nothing in that list narrows an ambiguous name to a likely one.
    expect(found('9mm Parabellum')).toBe('9 mm Luger');
    expect(found('9mm PAR')).toBe('9 mm Luger');
    expect(found('9MM PAR ( 9X19MM )')).toBe('9 mm Luger');
    expect(found('9x19')).toBe('9 mm Luger');
    expect(found('.45 ACP')).toBe('45 Auto');
  });

  it('resolves an unambiguous abbreviation by prefix', () => {
    expect(found('.308 Win')).toBe('308 Winchester');
    expect(found('.223 Rem')).toBe('223 Remington');
  });

  it('⚠️ REFUSES AN AMBIGUOUS FAMILY, and that is the safety argument', () => {
    // "9mm" touches 9 mm Luger, 9 mm Makarov and 9 mm Browning court. A pack
    // goes out with no drawing rather than with another cartridge's dimensions
    // printed under the applicant's signature.
    expect(found('9mm')).toBeNull();
    expect(found('9 mm')).toBeNull();
    // Below four characters a candidate is a calibre family, not a cartridge.
    expect(found('357')).toBeNull();
    expect(found('45')).toBeNull();
  });

  it('answers nothing for a blank or an unheld round', () => {
    expect(found('')).toBeNull();
    expect(found('   ')).toBeNull();
    expect(found('12 gauge')).toBeNull();
    expect(found('.700 Nitro Express')).toBeNull();
  });

  it('⚠️ COUNTS CARTRIDGES, NOT STRINGS, when it tests uniqueness', () => {
    // 9 mm Luger answers to three stored names. Counting the strings would
    // call a match that hits two of them ambiguous and refuse it.
    expect(found('9 mm Luger / 9x19 mm')).toBe('9 mm Luger');
  });
});
