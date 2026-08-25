import { derivedExpiryFor } from './licence-centre.service';

// ────────────────────────────────────────────────────────────────────
// THE DOCUMENT CENTRE WAS TELLING MEMBERS A DATE THE STATUTE DOES NOT GIVE.
//
// It prefilled "your competency lapses five years after it was issued
// (section 10(2))" and told them to "check it against your certificate".
// Both halves were wrong:
//
//   - s10(2) AS AMENDED (Act 28 of 2006, commenced 10 January 2011) says a
//     competency remains valid for the same period as the LICENCE it relates
//     to. It has no independent lifespan and rolls forward with every grant
//     or renewal in that firearm type. Five-from-issue is only the fallback
//     for a type holding no licence (SA Firearm Competency Reference §5.2).
//     The old wording cited the section that says the opposite.
//
//   - A competency certificate does not PRINT an expiry date (§5.2, §8), so
//     "check it against your certificate" sends somebody looking for
//     something that is not there. §9 calls out that guidance by name.
//
// And the real date cannot be computed here: the derivation is PER FIREARM
// TYPE and a vault licence row does not record its firearm's type. So the
// fallback is offered only where it is genuinely the rule, and withheld
// otherwise — a manufactured deadline on a field the member is asked to
// CONFIRM is worse than a blank one.
// ────────────────────────────────────────────────────────────────────

const ISSUED = '2020-03-01';

describe('the competency date the Document Centre offers', () => {
  it('offers five-from-issue to a member with NO licence on file', () => {
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.on).toBe('2025-03-01');
  });

  it('⚠️ OFFERS NOTHING once a licence is held — it would be a guess', () => {
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, true);
    expect(out).toBeNull();
  });

  it('⚠️ never cites section 10(2) for the five years', () => {
    // ⚠️ THE ONE CASE WHERE s10(2) IS SILENT. As amended it ties a competency
    // to "the licence to which the competency certificate relates" — and here
    // the member holds none, so the provision supplies no period at all. The
    // shipped copy cited it anyway, as the authority for five years.
    //
    // The five years is real and is what we run on: the operator confirmed it
    // with their DFO on 2026-08-25. It is simply not statute, and reference
    // v3 §5.3.1 is explicit — "never present it to a user as the legal
    // position". So it may be stated; it may not be dressed in a section
    // number.
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.why ?? '').not.toMatch(/section 10|s10\(2\)|Firearms Control Act/i);
  });

  it('⚠️ does not claim the certificate prints no date', () => {
    // ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE, and reference v3 withdrew the
    // claim it was enforcing. v2 said flatly "a competency certificate does
    // not carry an expiry date... never parse one", and this spec held the
    // copy to saying so. v3 §5.2: SAPS's own SAPS 271 form, §F.1.6 and §F.1.7,
    // requires the applicant to enter the competency's date of issue AND its
    // expiry date, and certificates issued before 10 January 2011 carry a
    // printed five-year expiry on their face.
    //
    // The true position is narrower: a printed date is advisory input, never
    // determinative, because s10(2) decoupled validity from the certificate.
    // Telling a member their card has no date is simply false for many of
    // them, and invites them to distrust everything else on the screen.
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.why ?? '').not.toMatch(/does not print|no expiry date on|there isn.t one/i);
    // Still no instruction to go and read the card, for the amended reason.
    expect(out?.why ?? '').not.toMatch(/check it against your certificate/i);
  });

  it('says WHY, so the member can tell a derivation from a reading', () => {
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.why).toMatch(/no firearm licence on file/i);
    // The rolling behaviour, however it is worded — the operator's DFO put it
    // as "it renews with the latest firearm license obtained".
    expect(out?.why).toMatch(/renewal/i);
    expect(out?.why).toMatch(/follows that licence/i);
  });

  it('stays out of the way when the document printed its own date', () => {
    expect(
      derivedExpiryFor('COMPETENCY_CERTIFICATE', '2030-01-01', ISSUED, false),
    ).toBeNull();
  });

  it('needs an issue date to work from', () => {
    expect(derivedExpiryFor('COMPETENCY_CERTIFICATE', null, null, false)).toBeNull();
  });

  it('⚠️ never guesses for a LICENCE or for dedicated status', () => {
    // Licence validity runs off section 27 and varies by section; dedicated
    // status is set by the association. Both would be inventing a deadline.
    expect(derivedExpiryFor('FIREARM_LICENCE', null, ISSUED, false)).toBeNull();
    expect(derivedExpiryFor('DEDICATED_DISCIPLINE', null, ISSUED, false)).toBeNull();
  });
});
