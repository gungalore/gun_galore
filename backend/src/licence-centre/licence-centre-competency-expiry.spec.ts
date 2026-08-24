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

  it('⚠️ never tells anyone to read an expiry off the certificate', () => {
    // The certificate does not print one. §9 names this exact instruction.
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.why ?? '').not.toMatch(/check it against your certificate/i);
    expect(out?.why ?? '').toMatch(/does not print a date/i);
  });

  it('says WHY, so the member can tell a derivation from a reading', () => {
    const out = derivedExpiryFor('COMPETENCY_CERTIFICATE', null, ISSUED, false);
    expect(out?.why).toMatch(/no firearm licence on file/i);
    expect(out?.why).toMatch(/moves out with every renewal/i);
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
