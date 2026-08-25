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

  it('⚠️ says the certificate prints no date, and never sends them to look', () => {
    // ⚠️ THIS ASSERTION HAS NOW BEEN FLIPPED TWICE, AND v5 SETTLES IT WITH
    // EVIDENCE. It began asserting that our copy says a competency prints no
    // expiry (v2). Reference v3 called that overstated — reasoning from SAPS
    // 271 §F.1.6/F.1.7 asking the applicant for the competency's expiry date
    // that the field must exist somewhere — and the assertion was inverted to
    // match. v4 then examined three genuine SAPS 524 certificates, from 2022,
    // 2024 and 2025, and found NO EXPIRY FIELD: not blank, absent from the
    // form. §5.2 reverses v3's correction outright.
    //
    // The lesson is in the reasoning, not the outcome: an inference from one
    // SAPS form about what another SAPS form contains is worth nothing, and
    // SAPS forms routinely disagree with each other — the 271 also prints a
    // business-licence period table repealed in 2011.
    //
    // So the copy tells the member there is no date on the card, and does not
    // send them to look for one. §9: any guidance saying "check the expiry on
    // your card" is wrong.
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.why ?? '').toMatch(/does not print a date/i);
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
