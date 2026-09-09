import { MotivationLicenceType } from '@prisma/client';
import {
  applicationBlockers,
  endorsementNeed,
  requiredEndorsement,
} from './motivation-eligibility';

// ────────────────────────────────────────────────────────────────────
// THE RULES EXISTED AND NOTHING ASKED THEM ANYTHING.
//
// Operator's routing spec §3 / §6.1: enforce the hard constraints before
// routing starts, and "block the generator with a specific message. Do not
// silently continue."
//
// sectionAllows() was written and fully tested during the competency work and
// had ZERO CALLERS. So somebody could describe a self-loading rifle, pick
// section 13, and be walked all the way to a finished pack for an application
// the Act does not permit — discovering it from the Registrar months later,
// after the fee and the fingerprints.
// ────────────────────────────────────────────────────────────────────

const SL_RIFLE = {
  firearm_type: 'Rifle',
  firearm_action: 'Semi-automatic (self-loading)',
};
const BOLT_RIFLE = { firearm_type: 'Rifle', firearm_action: 'Bolt action' };
const SL_SHOTGUN = {
  firearm_type: 'Shotgun',
  firearm_action: 'Semi-automatic (self-loading)',
};
const PISTOL = {
  firearm_type: 'Handgun',
  firearm_action: 'Semi-automatic (self-loading)',
};

describe('which endorsement a firearm needs', () => {
  it('reads type and action together', () => {
    expect(requiredEndorsement(SL_RIFLE)).toBe('rifle-sl');
    expect(requiredEndorsement(BOLT_RIFLE)).toBe('rifle-mo');
    expect(requiredEndorsement(PISTOL)).toBe('handgun');
    // ⚠️ A REVOLVER AND A PISTOL ARE THE SAME COMPETENCY. §2.2 and §12 #3:
    // there is no separate unit standard for a self-loading handgun — 119649
    // covers handguns whole — so the action changes nothing here. It still
    // matters for SECTION eligibility, which is why it is carried separately;
    // see firearmShape.
    expect(
      requiredEndorsement({
        firearm_type: 'Handgun',
        firearm_action: 'Revolver',
      }),
    ).toBe('handgun');
  });

  it('⚠️ says nothing until the applicant has said enough', () => {
    // A blocker on an unanswered box would refuse somebody for a question they
    // have not reached yet.
    expect(requiredEndorsement({})).toBeNull();
    expect(requiredEndorsement({ firearm_type: 'Rifle' })).toBeNull();
    expect(requiredEndorsement({ firearm_action: 'Bolt action' })).toBeNull();
  });

  it('⚠️ needs the ACTION only for a rifle', () => {
    // §2.2 and §12 #3: one unit standard for handguns (119649), one for
    // shotguns (119652). The action cannot change either answer, so demanding
    // it withheld a certificate we already held — from every renewal above
    // all, because a licence card does not print an action and
    // licence-renewal.ts therefore cannot seed one.
    expect(requiredEndorsement({ firearm_type: 'Handgun' })).toBe('handgun');
    expect(requiredEndorsement({ firearm_type: 'Shotgun' })).toBe('shotgun');
    // The one place it genuinely selects: 119651 manual against 119650
    // self-loading.
    expect(endorsementNeed({ firearm_type: 'Rifle' })).toEqual({
      kind: 'unknown',
    });
  });

  it('⚠️ refuses to resolve a COMBINATION gun', () => {
    // Rifle and shotgun barrels: no single endorsement covers it, so picking
    // one would be half an answer on a signed application. `requiredEndorsement`
    // is the NARROW view and still says null...
    expect(
      requiredEndorsement({
        firearm_type: 'Combination',
        firearm_action: 'Break action',
      }),
    ).toBeNull();
  });

  it('⚠️ but null is no longer ONE answer — endorsementNeed tells them apart', () => {
    // The whole fail-open: three different situations all answered null, and
    // every caller read them as "not yet", so a certificate chosen for an
    // earlier answer stayed on the form for the life of the application.
    expect(endorsementNeed({})).toEqual({ kind: 'unknown' });
    expect(
      endorsementNeed({
        firearm_type: 'Combination',
        firearm_action: 'Break action',
      }),
    ).toEqual({ kind: 'several', endorsements: ['rifle-mo', 'shotgun'] });
    expect(
      endorsementNeed({
        firearm_type: 'Combination',
        firearm_action: 'Semi-automatic (self-loading)',
      }),
    ).toEqual({ kind: 'several', endorsements: ['rifle-sl', 'shotgun'] });
    // Only reachable by registry drift — a type choice renamed without this
    // following it, or a legacy value in an old draft. It is a decision, not a
    // silence: whatever certificate is on the form was chosen for something
    // else.
    expect(
      endorsementNeed({
        firearm_type: 'Trebuchet',
        firearm_action: 'Bolt action',
      }),
    ).toEqual({ kind: 'unmappable' });
  });
});

describe('what a section will not permit', () => {
  it('⚠️ BLOCKS a self-loading rifle under section 13', () => {
    const out = applicationBlockers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      SL_RIFLE,
    );
    expect(out.map((b) => b.code)).toContain('section-forbids-firearm');
    expect(out[0].message).toMatch(/rifle or carbine cannot be licensed/i);
    // It must say what WOULD work, not only what does not.
    expect(out[0].message).toMatch(/different section/i);
  });

  it('blocks a bolt-action rifle under section 13 too — it is the TYPE', () => {
    const out = applicationBlockers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      BOLT_RIFLE,
    );
    expect(out.map((b) => b.code)).toContain('section-forbids-firearm');
  });

  it('⚠️ BLOCKS a semi-automatic shotgun under section 13', () => {
    // ⚠️ THIS TEST ASSERTED THE OPPOSITE. It read "ALLOWS a self-loading
    // shotgun under section 13 — the exception", and the wizard told
    // applicants so. s13(1)(a) of the Act: "shotgun which is NOT FULLY OR
    // SEMI-AUTOMATIC". A semi-automatic shotgun is a restricted firearm under
    // s14(1)(a). Reference v3 §12 #1 lists this as the correction that "could
    // cause real harm".
    const out = applicationBlockers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      SL_SHOTGUN,
    );
    expect(out.map((b) => b.code)).toContain('section-forbids-firearm');
    // And it must name the way through, not just the refusal.
    expect(out[0].message).toMatch(/section 14/i);
  });

  it('allows a pistol under section 13, semi-automatic or not', () => {
    // s13(1)(b) excludes only the FULLY automatic handgun.
    expect(
      applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, PISTOL),
    ).toEqual([]);
  });

  it('⚠️ ALLOWS a semi-automatic pistol under section 15', () => {
    // ⚠️ THE SAME BUG POINTING THE OTHER WAY, AND THIS ONE REFUSED LAWFUL
    // APPLICATIONS. The rule was "section 15 excludes self-loading firearms",
    // applied to every firearm. s15(1) draws the line per type: "(a) handgun
    // which is not fully automatic; (b) rifle or shotgun which is not fully
    // or semi-automatic". A semi-automatic pistol under s15 is ordinary.
    expect(
      applicationBlockers(MotivationLicenceType.S15_OCCASIONAL_HUNTER, PISTOL),
    ).toEqual([]);
  });

  it('blocks a semi-automatic RIFLE or SHOTGUN under section 15', () => {
    for (const f of [SL_RIFLE, SL_SHOTGUN]) {
      const out = applicationBlockers(
        MotivationLicenceType.S15_OCCASIONAL_HUNTER,
        f,
      );
      expect(out.map((b) => b.code)).toContain('section-forbids-firearm');
    }
    expect(
      applicationBlockers(
        MotivationLicenceType.S15_OCCASIONAL_HUNTER,
        BOLT_RIFLE,
      ),
    ).toEqual([]);
  });

  it('lets section 16 take the self-loading rifle, which is the whole route', () => {
    for (const t of [
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      MotivationLicenceType.S16_DEDICATED_SPORT,
    ]) {
      expect(applicationBlockers(t, SL_RIFLE)).toEqual([]);
    }
  });

  it('⚠️ NEVER blocks a renewal on the section rule', () => {
    // A renewal inherits the section of the licence being renewed, and we do
    // not hold that as a structured value. Guessing would refuse a perfectly
    // good renewal.
    expect(
      applicationBlockers(MotivationLicenceType.S24_RENEWAL, SL_RIFLE),
    ).toEqual([]);
  });
});

describe('whether the competency covers it', () => {
  const RIFLE_SL_LABEL =
    'Rifle or carbine — self-loading (includes pistol calibre carbine)';
  const RIFLE_MO_LABEL =
    'Rifle or carbine — manually operated (bolt / lever / pump / single shot)';

  it('⚠️ BLOCKS when the endorsement held is the wrong one', () => {
    const out = applicationBlockers(
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      {
        ...SL_RIFLE,
        competency_for: RIFLE_MO_LABEL,
      },
    );
    expect(out.map((b) => b.code)).toContain('competency-missing-endorsement');
    // It names the endorsement they actually need.
    expect(out[0].message).toContain('self-loading');
  });

  it('passes when the endorsement held covers it', () => {
    expect(
      applicationBlockers(MotivationLicenceType.S16_DEDICATED_HUNTER, {
        ...SL_RIFLE,
        competency_for: RIFLE_SL_LABEL,
      }),
    ).toEqual([]);
  });

  it('handles several endorsements on one certificate', () => {
    expect(
      applicationBlockers(MotivationLicenceType.S16_DEDICATED_HUNTER, {
        ...SL_RIFLE,
        competency_for: `${RIFLE_MO_LABEL}, ${RIFLE_SL_LABEL}`,
      }),
    ).toEqual([]);
  });

  it('⚠️ says NOTHING when the competency has not been read yet', () => {
    // Empty means we have not read the certificate, not that they lack the
    // endorsement. Refusing on absence would block every applicant who has not
    // yet uploaded.
    expect(
      applicationBlockers(MotivationLicenceType.S16_DEDICATED_HUNTER, SL_RIFLE),
    ).toEqual([]);
  });

  it('points at the field the applicant should look at', () => {
    const out = applicationBlockers(
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      {
        ...SL_RIFLE,
        competency_for: RIFLE_MO_LABEL,
      },
    );
    expect(out[0].field).toBe('competency_for');
  });

  it('can raise BOTH blockers at once', () => {
    // A self-loading rifle under s13, held on a manually-operated endorsement:
    // two independent problems, and hiding one behind the other would send
    // somebody round twice.
    const out = applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, {
      ...SL_RIFLE,
      competency_for: RIFLE_MO_LABEL,
    });
    expect(out).toHaveLength(2);
  });
});

describe('⚠️ the blocker must never fire on an unread competency', () => {
  // Operator, 2026-09-07, driving a fresh section 13 on production: a member
  // who holds exactly the right handgun competency was told it does not cover
  // his handgun, because the box had been filled from the WRONG certificate
  // before the application knew which firearm it was for. The upstream fix is
  // in the vault offer; these pin the half that lives here — silence is the
  // only thing an unusable `competency_for` may produce.
  const PISTOL_ANSWERS = {
    firearm_type: 'Handgun',
    firearm_action: 'Semi-automatic (self-loading)',
  };
  const S13 = MotivationLicenceType.S13_SELF_DEFENCE;

  it('says nothing for an empty, blank or whitespace-only answer', () => {
    for (const competency_for of ['', '   ', ',', ' , ,']) {
      expect(
        applicationBlockers(S13, { ...PISTOL_ANSWERS, competency_for }),
      ).toEqual([]);
    }
  });

  it('says nothing when NOTHING in the answer resolves to an endorsement', () => {
    // Wording we cannot read is not evidence that they lack the endorsement.
    // Refusing on it would refuse a member for our own parser.
    expect(
      applicationBlockers(S13, {
        ...PISTOL_ANSWERS,
        competency_for: 'whatever the clerk wrote here',
      }),
    ).toEqual([]);
  });

  it('names BOTH what is missing and what the certificate covers', () => {
    const out = applicationBlockers(
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      {
        firearm_type: 'Rifle',
        firearm_action: 'Semi-automatic (self-loading)',
        competency_for:
          'Rifle or carbine — manually operated (bolt / lever / pump / single shot)',
      },
    );
    expect(out[0].message).toContain('self-loading');
    expect(out[0].message).toContain('manually operated');
    // ⚠️ AND NEVER AN EMPTY PAIR OF QUOTES. `It needs ""` tells a member
    // nothing at all, and it is one registry rename away.
    expect(out[0].message).not.toContain('""');
  });
});

describe('⚠️ a firearm we cannot map does not silence every OTHER check', () => {
  // applicationBlockers used to open with
  // `if (!requiredEndorsement(answers)) return out;`, so a combination gun —
  // or a renamed type — skipped the section rule as well, which has nothing to
  // do with competency.
  it('still applies the section rule to a firearm with no single endorsement', () => {
    // A firearm type this registry cannot map, under a section that would
    // refuse the shape anyway. The endorsement half goes quiet; the section
    // half must not.
    const out = applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, {
      firearm_type: 'Rifle',
      firearm_action: 'Bolt action',
      competency_for: 'Handgun',
    });
    expect(out.map((b) => b.code)).toEqual(
      expect.arrayContaining(['section-forbids-firearm']),
    );
  });
});

describe('⚠️ a combination gun, on the competency rule', () => {
  // The reference (§4.2) calls COMB "rifle and shotgun barrels" and offers it
  // as a SAPS 271 §E.1 type. What it does NOT say anywhere — nor the Act, nor
  // the Regulations — is that BOTH endorsements are required; §2.2 is explicit
  // that the whole endorsement system is SAPS administrative practice
  // "[ACT — by absence]". So the line sits at "covers neither barrel", which is
  // wrong on any reading, and the stricter rule waits for a DFO.
  const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
  const COMB = {
    firearm_type: 'Combination',
    firearm_action: 'Break action',
  };

  it('blocks when the certificate covers NEITHER barrel', () => {
    const out = applicationBlockers(S13, {
      ...COMB,
      competency_for: 'Handgun',
    });
    expect(out.map((b) => b.code)).toContain('competency-missing-endorsement');
  });

  it('⚠️ does NOT block when it covers one of the two', () => {
    for (const competency_for of [
      'Rifle or carbine — manually operated (bolt / lever / pump / single shot)',
      'Shotgun',
    ]) {
      expect(
        applicationBlockers(S13, { ...COMB, competency_for }).map(
          (b) => b.code,
        ),
      ).not.toContain('competency-missing-endorsement');
    }
  });
});

describe('⚠️ the blocker never invites the member to silence it', () => {
  // `competency_for` is the blocker's ONLY input and it is SAPS 271 item 1.4 —
  // a declaration the applicant signs. The message used to end "add it to your
  // Document Centre or tick it above", which is an instruction to make a
  // compliance warning disappear by declaring something that may not be true.
  const out = applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, {
    firearm_type: 'Handgun',
    firearm_action: 'Semi-automatic (self-loading)',
    competency_for: 'Shotgun',
  });

  it('points at a real certificate and at the DFO, never at the tickbox', () => {
    expect(out[0].message).not.toMatch(/tick/i);
    expect(out[0].message).toContain('Document Centre');
    expect(out[0].message).toContain('DFO');
  });

  it('quotes both halves the same way, and never an empty pair', () => {
    expect(out[0].message).toContain('"Handgun"');
    expect(out[0].message).toContain('"Shotgun"');
    expect(out[0].message).not.toContain('""');
  });
});

// ────────────────────────────────────────────────────────────────────
// SECTION 6(2): NO LICENCE WHILE THE COMPETENCY HAS LAPSED.
//
// MO000071, section 7: "competency certificate C9882094 … remains valid until
// 2026-08-26", in a document dated 9 September 2026. It was written, graded 94
// and rendered — telling the Registrar, in the applicant's own voice, that the
// certificate behind the application had expired a fortnight earlier.
// ────────────────────────────────────────────────────────────────────
describe('a competency that has run out', () => {
  const AT = new Date('2026-09-09T06:00:00Z');
  const codes = (answers: Record<string, string>) =>
    applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, answers, AT).map(
      (b) => b.code,
    );

  it('blocks generation and names the date', () => {
    const out = applicationBlockers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      { competency_expiry: '2026-08-26' },
      AT,
    );
    const b = out.find((x) => x.code === 'competency-expired')!;
    expect(b).toBeDefined();
    expect(b.field).toBe('competency_expiry');
    expect(b.message).toContain('26 August 2026');
    // ⚠️ AND IT TELLS THEM THE WORK IS KEPT. A refusal that reads as "start
    // again" is how somebody abandons an application they had finished.
    expect(b.message).toContain('kept');
  });

  it('says nothing on the day it expires', () => {
    // A certificate is valid THROUGH its expiry date; refusing somebody a day
    // early is a wrong "no" on the strength of an off-by-one.
    expect(codes({ competency_expiry: '2026-09-09' })).not.toContain(
      'competency-expired',
    );
  });

  it('says nothing while it is still current', () => {
    expect(codes({ competency_expiry: '2027-01-31' })).not.toContain(
      'competency-expired',
    );
  });

  it('⚠️ SAYS NOTHING WHEN THERE IS NO READABLE DATE', () => {
    // This file's own rule: we do not refuse somebody for a box they have not
    // reached yet, and a date we cannot parse is not a date that has passed.
    for (const v of ['', '   ', 'unknown', '26/08/2026', 'not on the card']) {
      expect(codes({ competency_expiry: v })).not.toContain('competency-expired');
    }
    expect(codes({})).not.toContain('competency-expired');
  });

  it('reaches the same verdict whenever it is re-checked', () => {
    // The clock is injected for the same reason sa-id.ts injects one: a pack
    // re-verified months later must grade as it was built.
    expect(
      applicationBlockers(
        MotivationLicenceType.S13_SELF_DEFENCE,
        { competency_expiry: '2026-08-26' },
        new Date('2026-08-01T00:00:00Z'),
      ).map((b) => b.code),
    ).not.toContain('competency-expired');
  });
});
