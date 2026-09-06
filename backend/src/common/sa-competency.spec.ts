import {
  ENDORSEMENTS,
  deriveCertificateExpiry,
  deriveExpiry,
  endorsementDisplay,
  endorsementFromLabel,
  normaliseCompetencyForAnswer,
  parseEndorsements,
  sectionAllows,
} from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// The rules from the operator-supplied SA Firearm Competency Reference.
// Section marks (§n) below are that document's.
// ────────────────────────────────────────────────────────────────────

describe('reading the endorsements off a certificate', () => {
  it('⚠️ reads the compound block off a REAL certificate — §4.7', () => {
    // ⚠️ THIS STRING IS NOT FROM THE REFERENCE. It is copied off the
    // operator's own SAPS 524 issued 2025-06-06. A conformance review flagged
    // the trailing "/SHOTGUN" as invented, because §4.7's printed example
    // stops at PIST CAL CARB — the real card carries the tail. Do not
    // "correct" it back to the document's shorter version.
    //
    // The S/L prefix governs the block, so the rifle side is self-loading.
    // The shotgun is now just SHOTGUN: §2.2 removes the self-loading shotgun
    // endorsement entirely, there being no unit standard for one.
    expect(parseEndorsements('S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN')).toEqual([
      'rifle-sl',
      'shotgun',
    ]);
  });

  it('⚠️ files a pistol calibre carbine as a RIFLE, never a handgun — §4.7', () => {
    // It fires a handgun cartridge and is classified by barrel and overall
    // length. Calling it a handgun would tell somebody their handgun
    // competency covers a firearm it does not.
    const out = parseEndorsements('S/L PIST CAL CARB');
    expect(out).toContain('rifle-sl');
    expect(out).not.toContain('handgun');
  });

  it('⚠️ treats N/S/L HG and S/L HG as the same handgun competency', () => {
    // §2.2 and §12 #3: there is no separate unit standard for a self-loading
    // handgun — 119649 covers handguns whole. Where a card prints the action
    // anyway it is data-capture convention, and §2.2 says to read it as such.
    expect(parseEndorsements('N/S/L HG')).toEqual(['handgun']);
    expect(parseEndorsements('S/L HG')).toEqual(['handgun']);
    // Same for the shotgun, which v2 also split.
    expect(parseEndorsements('M/O SG')).toEqual(['shotgun']);
    expect(parseEndorsements('S/L SG')).toEqual(['shotgun']);
  });

  it('reads the written-out forms as well as the abbreviations', () => {
    expect(parseEndorsements('Handgun, self-loading')).toEqual(['handgun']);
    expect(parseEndorsements('Rifle or carbine, manually operated')).toEqual([
      'rifle-mo',
    ]);
    expect(parseEndorsements('MANUALLY OPERATED SHOTGUN')).toEqual(['shotgun']);
  });

  it('⚠️ reads the operator\'s three real certificates', () => {
    // ⚠️ TWO OF THESE THREE PARSED TO NOTHING before the §2.2 collapse, and
    // this is the case the operator reported: "Seems like sometimes they will
    // add the full word too." SAPS writes the type line either way, and the
    // handgun card carries no action at all — because there is none to carry.
    // The parser refused every category without a stated action, so a
    // perfectly clear certificate read as unreadable.
    expect(
      parseEndorsements('COMPETENCY TO POSSESS A FIREARM HANDGUN'),
    ).toEqual(['handgun']);
    expect(
      parseEndorsements('COMPETENCY TO POSSESS A FIREARM MANUALLY OPERATED RIFLE'),
    ).toEqual(['rifle-mo']);
    expect(
      parseEndorsements(
        'COMPETENCY TO POSSESS A FIREARM S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN',
      ),
    ).toEqual(['rifle-sl', 'shotgun']);
  });

  it('reads several clauses, each with its own action', () => {
    const out = parseEndorsements('N/S/L HG, M/O RIFLE/CARB');
    expect(out).toEqual(['handgun', 'rifle-mo']);
  });

  it('⚠️ STILL REFUSES TO GUESS a rifle with no action stated', () => {
    // Narrowed, not removed. "RIFLE" alone does not say whether it is
    // self-loading, 119651 and 119650 are different unit standards, and s13,
    // s15 and s16 each treat a semi-automatic rifle differently. Returning
    // nothing sends the applicant to the tick boxes; guessing sends them to a
    // refusal.
    expect(parseEndorsements('RIFLE')).toEqual([]);
    expect(parseEndorsements('RIFLE OR CARBINE')).toEqual([]);
    // But HANDGUN alone is now complete, because nothing is left to guess at.
    expect(parseEndorsements('HANDGUN')).toEqual(['handgun']);
    expect(parseEndorsements('SHOTGUN')).toEqual(['shotgun']);
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

// ─────────────────────────────────────────────────────────────────────
// WHAT THE MEMBER SEES, AND WHAT SURVIVES A CHANGE TO IT.
// ─────────────────────────────────────────────────────────────────────

describe('how an endorsement is shown', () => {
  it('names it the way the operator asked', () => {
    // Operator, 2026-08-25: "list it as 'Competency - Semi-auto Rifle' if the
    // code was S/L Rifle for example".
    expect(endorsementDisplay('rifle-sl')).toBe('Competency - Semi-auto Rifle');
    expect(endorsementDisplay('rifle-mo')).toBe('Competency - Manual Rifle');
    expect(endorsementDisplay('handgun')).toBe('Competency - Handgun');
    expect(endorsementDisplay('shotgun')).toBe('Competency - Shotgun');
    expect(endorsementDisplay('muzzle-loader')).toBe('Competency - Muzzle Loader');
  });

  it('⚠️ keeps the shown wording out of the stored wording', () => {
    // They are different columns for a reason: `label` is what lands in a
    // member's saved answers, `display` is chrome. If the two were one field,
    // rewording the Document Centre would silently invalidate every stored
    // answer and the field validator would bin the whole key.
    for (const e of ENDORSEMENTS) expect(e.display).not.toBe(e.label);
  });

  it('⚠️ no label or display string contains a comma', () => {
    // competency_for is a multi field stored COMMA-JOINED, and four code paths
    // split on the comma. A label carrying its own comma cannot survive a
    // round trip — this shipped once, as "(bolt, lever, pump, single shot)".
    for (const e of ENDORSEMENTS) {
      expect(e.label).not.toContain(',');
      expect(e.display).not.toContain(',');
    }
  });
});

describe('answers stored under the old seven endorsements', () => {
  it('⚠️ still resolve, or the cover warning silently stops firing', () => {
    // The failure this prevents is silent in the worst way: the eligibility
    // check resolves each stored label, DROPS what it cannot resolve, and only
    // warns if something survived. An all-stale answer therefore reads as "we
    // have not seen the certificate yet" rather than as an error.
    expect(endorsementFromLabel('Handgun \u2014 self-loading (pistol)')).toBe(
      'handgun',
    );
    expect(endorsementFromLabel('Handgun \u2014 non-self-loading (revolver)')).toBe(
      'handgun',
    );
    expect(endorsementFromLabel('Shotgun \u2014 self-loading')).toBe('shotgun');
  });

  it('collapses the two old handgun answers into one', () => {
    const out = normaliseCompetencyForAnswer(
      'Handgun \u2014 self-loading (pistol), Handgun \u2014 non-self-loading (revolver)',
    );
    expect(out).toBe('Handgun');
  });

  it('⚠️ keeps wording it cannot read rather than deleting it', () => {
    // An unreadable part is still the member's answer. Dropping it here would
    // quietly delete something they typed or ticked.
    const out = normaliseCompetencyForAnswer('Handgun, Something we never offered');
    expect(out).toContain('Something we never offered');
  });

  it('leaves the muzzle loader answer exactly as it was', () => {
    expect(normaliseCompetencyForAnswer('Muzzle loading firearm')).toBe(
      'Muzzle loading firearm',
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// ONE CERTIFICATE, ONE DATE — AND WHAT THAT DATE IS HIDING.
//
// deriveCertificateExpiry takes the MAX across every category a certificate
// covers, on the operator's DFO advice, and the note on the function records
// exactly what that trades: taking the latest can only ever push a date OUT,
// so if a category on a certificate does in fact lapse on its own, this hides
// it — and a reminder that never fires is the silent failure this product
// exists to prevent.
//
// The date does not change. What changes is that the member is now TOLD which
// half of their certificate is standing on the other half's licence.
// ────────────────────────────────────────────────────────────────────

describe('the certificate-wide expiry — §5.3 and the DFO reading', () => {
  const ISSUED = new Date('2020-03-01T00:00:00Z');

  it('⚠️ names the side of the certificate with no licence behind it', () => {
    // The operator's real case: a 2025 certificate covering a semi-automatic
    // rifle AND a shotgun, four rifle licences, no shotgun licence.
    const out = deriveCertificateExpiry({
      endorsements: ['rifle-sl', 'shotgun'],
      issuedOn: ISSUED,
      licences: [
        { category: 'rifle-carbine', expiresOn: new Date('2035-09-21T00:00:00Z') },
      ],
    });
    expect(out.on?.toISOString().slice(0, 10)).toBe('2035-09-21');
    expect(out.why).toMatch(/shotgun side of this certificate/i);
    expect(out.why).toMatch(/no licence behind it/i);
    // The member's own word for it, not 'rifle-carbine'.
    expect(out.why).not.toMatch(/rifle-carbine|rifle-sl/);
  });

  it('says nothing about bare sides when every side has a licence', () => {
    const out = deriveCertificateExpiry({
      endorsements: ['rifle-sl', 'shotgun'],
      issuedOn: ISSUED,
      licences: [
        { category: 'rifle-carbine', expiresOn: new Date('2035-09-21T00:00:00Z') },
        { category: 'shotgun', expiresOn: new Date('2029-06-15T00:00:00Z') },
      ],
    });
    expect(out.why).not.toMatch(/no licence behind it/i);
  });

  it('lists several bare sides in one sentence', () => {
    const out = deriveCertificateExpiry({
      endorsements: ['handgun', 'rifle-mo', 'shotgun'],
      issuedOn: ISSUED,
      licences: [
        { category: 'handgun', expiresOn: new Date('2031-01-01T00:00:00Z') },
      ],
    });
    expect(out.why).toMatch(/rifle and shotgun side/i);
  });

  it('⚠️ never dresses an unreadable certificate up as a date', () => {
    // The certificate is the only thing that says which categories it covers.
    // Without that, the licences the member holds tell us nothing about it —
    // and this is the verdict licence-centre.service.ts used to talk over.
    const out = deriveCertificateExpiry({
      endorsements: [],
      issuedOn: ISSUED,
      licences: [
        { category: 'handgun', expiresOn: new Date('2033-09-30T00:00:00Z') },
      ],
    });
    expect(out.on).toBeNull();
    expect(out.basis).toBe('unknown');
    expect(out.why).toMatch(/could not read which firearms/i);
  });

  it('⚠️ the five years is stated as ours, and cites no section', () => {
    // The endorsements ARE read here — handgun — and no handgun licence backs
    // them, so this is the one case where the five years genuinely applies.
    // Reference §5.3.1: it is the REPEALED s10(2), surviving as habit, and it
    // must never be presented to a member as the legal position.
    const out = deriveCertificateExpiry({
      endorsements: ['handgun'],
      issuedOn: ISSUED,
      licences: [
        // A rifle licence says nothing about a handgun certificate.
        { category: 'rifle-carbine', expiresOn: new Date('2040-01-01T00:00:00Z') },
      ],
    });
    expect(out.basis).toBe('fallback');
    expect(out.on?.toISOString().slice(0, 10)).toBe('2025-03-01');
    expect(out.why).not.toMatch(/section 10|s10\(2\)|Firearms Control Act/i);
    // And it must not send them looking for a date the form does not carry
    // (§5.2: three genuine SAPS 524s, no expiry field on any of them).
    expect(out.why).toMatch(/does not print a date/i);
    expect(out.why).not.toMatch(/check it against your certificate/i);
  });

  it('⚠️ rolls 29 February forward rather than inventing a day', () => {
    // This used to be pinned against competencyLapses in licence-dates.ts.
    // That function is gone; the arithmetic lives in plusYears, and 29
    // February + 5 has no 29 February to land on — JavaScript gives 1 March,
    // which is a real date and worth knowing rather than discovering.
    const out = deriveCertificateExpiry({
      endorsements: ['handgun'],
      issuedOn: new Date('2024-02-29T00:00:00Z'),
      licences: [],
    });
    expect(out.on?.toISOString().slice(0, 10)).toBe('2029-03-01');
  });
});
