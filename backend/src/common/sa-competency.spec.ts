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

  it('⚠️ gives a muzzle loader TEN years, not five — s10(3)', () => {
    // ⚠️ THE NUMBER IS THE POINT, AND THIS TEST USED TO ASSERT ONLY THE
    // WORDING. It passed happily while the code gave five years, because it
    // checked \"needs no licence\" and the basis label and never the date.
    // Five was invented: v2 of the reference omitted the period, and s10(3)
    // — added by s9(c) of Act 28 of 2006 — says ten.
    //
    // It is not a symmetrical error. A muzzle loader has no licence layer
    // beneath it, so calling a live competency lapsed makes lawful possession
    // look unlawful, and calling a lapsed one live hides a real lapse under
    // which possession IS unlawful.
    const out = deriveExpiry({
      category: 'muzzle-loader',
      issuedOn: issued,
      licences: [
        { section: 'S16', category: 'rifle-carbine', expiresOn: new Date('2040-01-01T00:00:00Z') },
      ],
    });
    expect(out.on?.getUTCFullYear()).toBe(issued.getUTCFullYear() + 10);
    // A statutory period, not our five-year no-licence assumption.
    expect(out.basis).toBe('statute');
    // And a rifle licence in the bag does not reach it.
    expect(out.why).toMatch(/needs no licence/i);
  });

  it('the no-licence fallback is five years and cites no statute', () => {
    // ⚠️ s10(2) SUPPLIES NO PERIOD HERE, so nothing may claim it does. The
    // Document Centre shipped copy citing "section 10(2) of the Firearms
    // Control Act, as amended" as the authority for five years — in the one
    // case where s10(2) is silent. The rule is the operator's, confirmed with
    // their DFO on 2026-08-25, and must be stated as such.
    const out = deriveExpiry({ category: 'handgun', issuedOn: issued, licences: [] });
    expect(out.on?.getUTCFullYear()).toBe(issued.getUTCFullYear() + 5);
    expect(out.basis).toBe('fallback');
    expect(out.why).not.toMatch(/section 10|s10|Firearms Control Act/i);
  });
});

describe('what a section will allow — §7.1', () => {
  it('refuses a rifle or carbine under section 13', () => {
    expect(sectionAllows('S13', 'rifle-carbine', true).ok).toBe(false);
    expect(sectionAllows('S13', 'rifle-carbine', false).ok).toBe(false);
  });

  it('⚠️ REFUSES a semi-automatic shotgun under section 13', () => {
    // ⚠️ THIS TEST ASSERTED THE OPPOSITE, AND SAID SO IN CAPITALS. It read
    // "ALLOWS a SELF-LOADING SHOTGUN under section 13 — the exception", on the
    // strength of v2 of the reference. v3 §12 #1 lists that as the error that
    // "could cause real harm", and the Act settles it in one line:
    //
    //   s13(1): "A firearm in respect of which a licence may be issued in
    //   terms of this section is any— (a) shotgun which is NOT FULLY OR
    //   SEMI-AUTOMATIC; or (b) handgun which is not fully automatic."
    //
    // A semi-automatic shotgun is expressly a restricted firearm under
    // s14(1)(a). Sending an applicant to s13 with one wastes an application
    // at best.
    expect(sectionAllows('S13', 'shotgun', true).ok).toBe(false);
    // The non-semi-automatic shotgun is exactly what s13(1)(a) is for.
    expect(sectionAllows('S13', 'shotgun', false).ok).toBe(true);
  });

  it('⚠️ ALLOWS a semi-automatic pistol under section 15', () => {
    // ⚠️ THE OTHER HALF OF THE SAME BUG, POINTING THE OTHER WAY. The rule was
    // "section 15 excludes self-loading firearms", applied to everything. The
    // Act draws the line per firearm type:
    //
    //   s15(1): "(a) handgun which is not fully automatic; (b) rifle or
    //   shotgun which is NOT FULLY OR SEMI-AUTOMATIC".
    //
    // Semi-automatic is excluded for RIFLES AND SHOTGUNS ONLY. A semi-
    // automatic pistol under s15 is ordinary and lawful, and we refused it.
    expect(sectionAllows('S15', 'handgun', true).ok).toBe(true);
    expect(sectionAllows('S15', 'rifle-carbine', true).ok).toBe(false);
    expect(sectionAllows('S15', 'shotgun', true).ok).toBe(false);
    expect(sectionAllows('S15', 'rifle-carbine', false).ok).toBe(true);
  });

  it('lets section 16 take a self-loading rifle, which is the whole route', () => {
    expect(sectionAllows('S16', 'rifle-carbine', true).ok).toBe(true);
  });

  it('⚠️ refuses a muzzle loader under EVERY section, not just 13', () => {
    // s3(2): a muzzle loading firearm takes no licence at all — the competency
    // on its own is what allows possession. Only the s13 branch caught this;
    // every other section fell out of the bottom of the function and returned
    // ok, so the wizard would have walked somebody through a licence
    // application for a firearm that cannot be licensed.
    for (const section of ['S13', 'S14', 'S15', 'S16', 'S16A'] as const) {
      expect(sectionAllows(section, 'muzzle-loader', false).ok).toBe(false);
    }
  });

  it('blocks nothing on an unstated action', () => {
    // ⚠️ null IS NOT false. An applicant who has not said whether their
    // shotgun is semi-automatic has not told us it is a s13 problem, and
    // guessing would refuse a lawful application — the exact failure the s15
    // rule above produced for four months.
    expect(sectionAllows('S13', 'shotgun', null).ok).toBe(true);
    expect(sectionAllows('S15', 'rifle-carbine', null).ok).toBe(true);
  });

  it('does not pretend to screen s14, s16 or s16A beyond the muzzle loader', () => {
    // Deliberate. s14(1)(b) admits anything the Minister declares restricted,
    // and s16(1)(b) and (c) overlap on the semi-automatic shotgun with a
    // five-shot limit we do not hold a magazine capacity to test. Refusing on
    // a guess would be the same class of error as the two above.
    expect(sectionAllows('S14', 'shotgun', false).ok).toBe(true);
    expect(sectionAllows('S16', 'shotgun', true).ok).toBe(true);
    expect(sectionAllows('S16A', 'handgun', true).ok).toBe(true);
  });
});
