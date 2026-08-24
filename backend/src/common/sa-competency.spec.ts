import {
  ENDORSEMENTS,
  deriveExpiry,
  endorsementFromLabel,
  parseEndorsements,
  sectionAllows,
} from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// The rules from the operator-supplied SA Firearm Competency Reference.
// Section marks (§n) below are that document's.
// ────────────────────────────────────────────────────────────────────

describe('reading the endorsements off a certificate', () => {
  it('⚠️ distributes a single action prefix across every type — §4.7', () => {
    // The reference's own worked example, and the reason it exists: the S/L
    // prefix governs the whole block, so this is self-loading rifle/carbine
    // AND self-loading shotgun. Reading it as "a rifle, and some shotgun"
    // would understate what the holder may possess.
    expect(parseEndorsements('S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN')).toEqual([
      'shotgun-sl',
      'rifle-sl',
    ]);
  });

  it('⚠️ files a pistol calibre carbine as a RIFLE, never a handgun — §4.7', () => {
    // It fires a handgun cartridge and is classified by barrel and overall
    // length. Calling it a handgun would tell somebody their handgun
    // competency covers a firearm it does not.
    const out = parseEndorsements('S/L PIST CAL CARB');
    expect(out).toContain('rifle-sl');
    expect(out).not.toContain('handgun-sl');
  });

  it('keeps N/S/L and S/L apart', () => {
    expect(parseEndorsements('N/S/L HG')).toEqual(['handgun-nsl']);
    expect(parseEndorsements('S/L HG')).toEqual(['handgun-sl']);
  });

  it('reads the written-out forms as well as the abbreviations', () => {
    expect(parseEndorsements('Handgun, self-loading')).toEqual(['handgun-sl']);
    expect(parseEndorsements('Rifle or carbine, manually operated')).toEqual([
      'rifle-mo',
    ]);
    expect(parseEndorsements('MANUALLY OPERATED SHOTGUN')).toEqual(['shotgun-mo']);
  });

  it('reads several clauses, each with its own action', () => {
    const out = parseEndorsements('N/S/L HG, M/O RIFLE/CARB');
    expect(out).toEqual(['handgun-nsl', 'rifle-mo']);
  });

  it('⚠️ REFUSES TO GUESS when no action is stated', () => {
    // "RIFLE" alone does not say whether it is self-loading, and the two
    // differ in what may be licensed under which section (§7.1). Returning
    // nothing sends the applicant to the tick boxes; guessing sends them to a
    // refusal.
    expect(parseEndorsements('RIFLE')).toEqual([]);
    expect(parseEndorsements('HANDGUN')).toEqual([]);
  });

  it('takes a muzzle loader without an action, because it has none', () => {
    expect(parseEndorsements('MUZZLE LOADING FIREARM')).toEqual(['muzzle-loader']);
    expect(parseEndorsements('M/L')).toEqual(['muzzle-loader']);
  });

  it('returns registry order, so one card always reads the same', () => {
    const a = parseEndorsements('S/L HG, M/O RIFLE');
    const b = parseEndorsements('M/O RIFLE, S/L HG');
    expect(a).toEqual(b);
  });

  it('says nothing about an empty or unreadable block', () => {
    expect(parseEndorsements('')).toEqual([]);
    expect(parseEndorsements('   ')).toEqual([]);
    expect(parseEndorsements('$$$ ????')).toEqual([]);
  });

  it('round-trips every label', () => {
    for (const e of ENDORSEMENTS) {
      expect(endorsementFromLabel(e.label)).toBe(e.value);
    }
  });
});

describe('the derived expiry — §5.2 and §5.3', () => {
  const issued = new Date('2020-03-01T00:00:00Z');

  it('⚠️ follows the LATEST licence in the category, not the certificate', () => {
    // The reference is explicit that competency has no independent lifespan.
    const out = deriveExpiry({
      category: 'handgun',
      issuedOn: issued,
      licences: [
        { section: 'S13', category: 'handgun', expiresOn: new Date('2026-01-01T00:00:00Z') },
        { section: 'S15', category: 'handgun', expiresOn: new Date('2033-01-01T00:00:00Z') },
      ],
    });
    expect(out.basis).toBe('licence');
    expect(out.on?.toISOString().slice(0, 10)).toBe('2033-01-01');
  });

  it('ignores licences in a DIFFERENT category', () => {
    // Each endorsement is computed independently (§5.2) — a ten-year rifle
    // licence must not extend a handgun endorsement.
    const out = deriveExpiry({
      category: 'handgun',
      issuedOn: issued,
      licences: [
        { section: 'S16', category: 'rifle-carbine', expiresOn: new Date('2040-01-01T00:00:00Z') },
      ],
    });
    expect(out.basis).toBe('fallback');
    expect(out.on?.toISOString().slice(0, 10)).toBe('2025-03-01');
  });

  it('falls back to five years from issue when the category holds nothing', () => {
    const out = deriveExpiry({ category: 'shotgun', issuedOn: issued, licences: [] });
    expect(out.basis).toBe('fallback');
    expect(out.on?.toISOString().slice(0, 10)).toBe('2025-03-01');
  });

  it('⚠️ rolls forward when a licence is renewed — the whole point of §5.3', () => {
    const before = deriveExpiry({
      category: 'handgun',
      issuedOn: issued,
      licences: [
        { section: 'S13', category: 'handgun', expiresOn: new Date('2026-01-01T00:00:00Z') },
      ],
    });
    const after = deriveExpiry({
      category: 'handgun',
      issuedOn: issued,
      licences: [
        { section: 'S13', category: 'handgun', expiresOn: new Date('2026-01-01T00:00:00Z') },
        { section: 'S13', category: 'handgun', expiresOn: new Date('2031-01-01T00:00:00Z') },
      ],
    });
    expect(before.on?.getUTCFullYear()).toBe(2026);
    expect(after.on?.getUTCFullYear()).toBe(2031);
  });

  it('reproduces the reference’s worked example, row by row — §5.3', () => {
    const licences: { section: 'S13' | 'S15'; category: 'handgun'; expiresOn: Date }[] = [];
    const at = () =>
      deriveExpiry({ category: 'handgun', issuedOn: issued, licences })
        .on?.getUTCFullYear();

    expect(at()).toBe(2025); // competency issued 2020, nothing licensed
    licences.push({ section: 'S13', category: 'handgun', expiresOn: new Date('2026-01-01T00:00:00Z') });
    expect(at()).toBe(2026);
    licences.push({ section: 'S15', category: 'handgun', expiresOn: new Date('2033-01-01T00:00:00Z') });
    expect(at()).toBe(2033);
    licences.push({ section: 'S13', category: 'handgun', expiresOn: new Date('2031-01-01T00:00:00Z') });
    expect(at()).toBe(2033); // the renewal is not the maximum — unchanged
    licences.push({ section: 'S15', category: 'handgun', expiresOn: new Date('2043-01-01T00:00:00Z') });
    expect(at()).toBe(2043);
  });

  it('says so plainly when it cannot tell', () => {
    const out = deriveExpiry({ category: 'handgun', issuedOn: null, licences: [] });
    expect(out.basis).toBe('unknown');
    expect(out.on).toBeNull();
  });

  it('gives a muzzle loader its own cycle — §5.5', () => {
    const out = deriveExpiry({
      category: 'muzzle-loader',
      issuedOn: issued,
      licences: [
        { section: 'S16', category: 'rifle-carbine', expiresOn: new Date('2040-01-01T00:00:00Z') },
      ],
    });
    expect(out.basis).toBe('fallback');
    expect(out.why).toMatch(/needs no licence/i);
  });
});

describe('what a section will allow — §7.1', () => {
  it('refuses a rifle or carbine under section 13', () => {
    expect(sectionAllows('S13', 'rifle-sl').ok).toBe(false);
    expect(sectionAllows('S13', 'rifle-mo').ok).toBe(false);
  });

  it('⚠️ ALLOWS a SELF-LOADING SHOTGUN under section 13 — the exception', () => {
    // The reference calls this out specifically: it is the one self-loading
    // firearm that section 13 takes. A blanket "no self-loading under S13"
    // rule would wrongly block it.
    expect(sectionAllows('S13', 'shotgun-sl').ok).toBe(true);
    expect(sectionAllows('S13', 'handgun-sl').ok).toBe(true);
  });

  it('excludes every self-loading firearm from section 15', () => {
    expect(sectionAllows('S15', 'rifle-sl').ok).toBe(false);
    expect(sectionAllows('S15', 'shotgun-sl').ok).toBe(false);
    expect(sectionAllows('S15', 'handgun-sl').ok).toBe(false);
    expect(sectionAllows('S15', 'rifle-mo').ok).toBe(true);
  });

  it('lets section 16 take a self-loading rifle, which is the whole route', () => {
    expect(sectionAllows('S16', 'rifle-sl').ok).toBe(true);
  });
});
