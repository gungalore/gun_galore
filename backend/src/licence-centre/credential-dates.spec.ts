import { CredentialKind } from '@prisma/client';
import {
  NO_VISION_KINDS,
  defaultsToNeverExpires,
  isPhotograph,
} from './credential-kinds';
import { expiryState } from './licence-dates';

// WHO DECIDES WHETHER A DOCUMENT EXPIRES.
//
// ⚠️ NOT THE KIND, AND THAT IS THE WHOLE POINT OF THESE TESTS. The first
// version of this module answered it from a hard-coded list of kinds that
// "never run out", with IDENTITY_DOCUMENT on it and a database CHECK enforcing
// it. A passport is an identity document and it expires — so a member filing
// one would have hit a database error with no way round it. The member holds
// the paper; the member ticks the box.

const now = new Date('2026-08-23T00:00:00Z');
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe('the expiry state a card shows', () => {
  it('is no-expiry when the member ticked the box', () => {
    expect(expiryState(null, null, now, true)).toBe('no-expiry');
  });

  it('is no-expiry even before anything else is confirmed', () => {
    // ⚠️ THE TICK IS ITSELF THE ANSWER. Leaving a ticked row amber would ask
    // somebody to go and confirm a date they have just told us does not exist.
    expect(expiryState(null, null, now, true)).toBe('no-expiry');
    expect(expiryState(null, day('2026-08-01'), now, true)).toBe('no-expiry');
  });

  it('is unknown — NOT no-expiry — when nobody has looked yet', () => {
    // A blank, unticked expiry is outstanding work. A ticked one is settled.
    // Collapsing the two loses the difference the member needs to see.
    expect(expiryState(null, null, now, false)).toBe('unknown');
  });

  it('never prints "in date" over something with no date', () => {
    expect(expiryState(null, null, now, true)).not.toBe('valid');
  });

  it('still grades a real date normally', () => {
    const confirmed = day('2026-01-01');
    expect(expiryState(day('2030-01-01'), confirmed, now, false)).toBe('valid');
    expect(expiryState(day('2026-10-01'), confirmed, now, false)).toBe(
      'expiring',
    );
    expect(expiryState(day('2026-01-01'), confirmed, now, false)).toBe(
      'expired',
    );
  });

  it('defaults to the old behaviour when the flag is not passed', () => {
    // The parameter is optional so every existing caller keeps working.
    expect(expiryState(null, null, now)).toBe('unknown');
  });
});

describe('which documents are worth a vision call', () => {
  it('skips only the photographs of a thing', () => {
    // Nothing is printed on a gun safe. The call would come back empty, and an
    // empty reading flags the row "we could not read anything off that one" —
    // telling a member something is wrong with a photograph that is fine.
    expect([...NO_VISION_KINDS].sort()).toEqual(
      [
        'SAFE_INSTALLATION',
        'SAFE_PHOTO_AJAR',
        'SAFE_PHOTO_BOLTS',
        'SAFE_PHOTO_CLOSED',
      ].sort(),
    );
  });

  it('READS the ID copies and proofs of address, dates and all', () => {
    // Operator, 2026-08-22: "Lets claude vison search on the document for
    // issue and expiry of the docuemnt and autofill it." These carry printing.
    for (const k of [
      CredentialKind.IDENTITY_DOCUMENT,
      CredentialKind.ADDRESS_CONFIRMATION,
      CredentialKind.EMPLOYMENT_CONFIRMATION,
      CredentialKind.SHOOTING_ACTIVITY_LOG,
      CredentialKind.FIREARM_LICENCE,
    ]) {
      expect(isPhotograph(k)).toBe(false);
    }
  });
});

describe('when the never-expires box starts already ticked', () => {
  it('only where we never looked at all', () => {
    for (const k of NO_VISION_KINDS) expect(defaultsToNeverExpires(k)).toBe(true);
  });

  it('NOT on an ID document, because a passport is one', () => {
    // ⚠️ THE CASE THAT BROKE THE FIRST DESIGN. A green barcoded book does not
    // expire; a passport does; both are IDENTITY_DOCUMENT. Pre-ticking would
    // be us answering for them, and answering wrong half the time.
    expect(defaultsToNeverExpires(CredentialKind.IDENTITY_DOCUMENT)).toBe(false);
  });

  it('NOT on anything else we actually read', () => {
    for (const k of Object.values(CredentialKind)) {
      if (isPhotograph(k)) continue;
      expect(defaultsToNeverExpires(k)).toBe(false);
    }
  });
});
