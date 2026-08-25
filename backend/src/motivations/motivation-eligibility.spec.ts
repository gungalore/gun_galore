import { MotivationLicenceType } from '@prisma/client';
import {
  applicationBlockers,
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
    expect(requiredEndorsement(PISTOL)).toBe('handgun-sl');
    expect(requiredEndorsement({ firearm_type: 'Handgun', firearm_action: 'Revolver' })).toBe(
      'handgun-nsl',
    );
  });

  it('⚠️ says nothing until the applicant has said enough', () => {
    // A blocker on an unanswered box would refuse somebody for a question they
    // have not reached yet.
    expect(requiredEndorsement({})).toBeNull();
    expect(requiredEndorsement({ firearm_type: 'Rifle' })).toBeNull();
    expect(requiredEndorsement({ firearm_action: 'Bolt action' })).toBeNull();
  });

  it('⚠️ refuses to resolve a COMBINATION gun', () => {
    // Rifle and shotgun barrels: no single endorsement covers it, so picking
    // one would be half an answer on a signed application.
    expect(
      requiredEndorsement({ firearm_type: 'Combination', firearm_action: 'Break action' }),
    ).toBeNull();
  });
});

describe('what a section will not permit', () => {
  it('⚠️ BLOCKS a self-loading rifle under section 13', () => {
    const out = applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, SL_RIFLE);
    expect(out.map((b) => b.code)).toContain('section-forbids-firearm');
    expect(out[0].message).toMatch(/rifle or carbine cannot be licensed/i);
    // It must say what WOULD work, not only what does not.
    expect(out[0].message).toMatch(/different section/i);
  });

  it('blocks a bolt-action rifle under section 13 too — it is the TYPE', () => {
    const out = applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, BOLT_RIFLE);
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
    expect(applicationBlockers(MotivationLicenceType.S13_SELF_DEFENCE, PISTOL)).toEqual([]);
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
      const out = applicationBlockers(MotivationLicenceType.S15_OCCASIONAL_HUNTER, f);
      expect(out.map((b) => b.code)).toContain('section-forbids-firearm');
    }
    expect(
      applicationBlockers(MotivationLicenceType.S15_OCCASIONAL_HUNTER, BOLT_RIFLE),
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
    expect(applicationBlockers(MotivationLicenceType.S24_RENEWAL, SL_RIFLE)).toEqual([]);
  });
});

describe('whether the competency covers it', () => {
  const RIFLE_SL_LABEL =
    'Rifle or carbine — self-loading (includes pistol calibre carbine)';
  const RIFLE_MO_LABEL =
    'Rifle or carbine — manually operated (bolt / lever / pump / single shot)';

  it('⚠️ BLOCKS when the endorsement held is the wrong one', () => {
    const out = applicationBlockers(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      ...SL_RIFLE,
      competency_for: RIFLE_MO_LABEL,
    });
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
    const out = applicationBlockers(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      ...SL_RIFLE,
      competency_for: RIFLE_MO_LABEL,
    });
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
