import { CredentialKind } from '@prisma/client';
import {
  NO_VISION_KINDS,
  defaultsToNeverExpires,
  isPhotograph,
  settledByNature,
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
        'SAFE_PHOTOGRAPHS',
        // The four retired ones stay on the list. Nothing new can be filed
        // under them, but a row that slipped through the deploy must not get a
        // vision call spent on a photograph of a gun safe and come back amber
        // for having read nothing.
        'SAFE_INSTALLATION',
        'SAFE_PHOTO_AJAR',
        'SAFE_PHOTO_BOLTS',
        'SAFE_PHOTO_CLOSED',
        // Evidence, for a different reason than the photographs beside it.
        // There is no fixed set of fields to read off an evidence item, so a
        // field extraction would come back empty on every one of them and flag
        // them amber. ⚠️ This governs FIELD EXTRACTION ONLY. Evidence is still
        // LOOKED AT — classifyEvidence() sends it to vision and asks which
        // container it belongs to. See credential-kinds.ts.
        'EVIDENCE',
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

  it('ON an ID document and a proficiency — neither runs out', () => {
    // Operator, 2026-08-28: "proficiencies never expires, only competencies"
    // and "ID document also never expires".
    //
    // ⚠️ THIS REVERSES A TESTED, DEFENDED DECISION — READ BEFORE CHANGING IT
    // BACK. The assertion here used to be `false`, and its comment called the
    // ID "THE CASE THAT BROKE THE FIRST DESIGN": a green barcoded book does
    // not expire, a passport does, and both are IDENTITY_DOCUMENT, so
    // pre-ticking was "us answering for them, and answering wrong half the
    // time."
    //
    // That reasoning is still sound and the edge is still real. What changed
    // is whose call it is: the operator says the Centre's ID documents do not
    // expire, and this is the SA ID book and card it actually collects. The
    // tick remains EDITABLE and the confirm step still shows it, so somebody
    // filing a passport unticks it in one tap — which is the escape hatch the
    // original objection was really asking for.
    expect(defaultsToNeverExpires(CredentialKind.IDENTITY_DOCUMENT)).toBe(true);
    expect(defaultsToNeverExpires(CredentialKind.PROFICIENCY)).toBe(true);
  });

  it('NOT on a competency, which is the one thing that DOES lapse', () => {
    // s10(2) of the Firearms Control Act: a competency certificate lapses.
    // Everything else on this list is here because it does not.
    expect(
      defaultsToNeverExpires(CredentialKind.COMPETENCY_CERTIFICATE),
    ).toBe(false);
  });

  it('NOT on anything else we actually read', () => {
    const exempt = new Set<CredentialKind>([
      CredentialKind.IDENTITY_DOCUMENT,
      CredentialKind.PROFICIENCY,
    ]);
    for (const k of Object.values(CredentialKind)) {
      if (isPhotograph(k) || exempt.has(k)) continue;
      expect(defaultsToNeverExpires(k)).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// TICKED IS NOT THE SAME AS SETTLED.
//
// `neverExpires` says what the answer is; `dateSource` says somebody stands
// behind it. Everything downstream reads the SECOND one — the auto-attach
// candidate query takes rows where `confirmedAt` or `dateSource` is set — so a
// safe photograph carrying only the tick was never a candidate, and could
// never reach an application by itself. On production, three of the four safe
// photographs on file were in exactly that state.
//
// Operator, 2026-09-09: "the safe pictures should automatically be set that
// the date never expires."
// ────────────────────────────────────────────────────────────────────

describe('documents whose date question answers itself', () => {
  it('settles every photograph, ticked AND armed', () => {
    for (const k of NO_VISION_KINDS) {
      const out = settledByNature(k);
      expect(out).not.toBeNull();
      expect(out!.neverExpires).toBe(true);
      // The half that was missing. Without it the row reads as a date nobody
      // has answered, and the auto-attach skips it.
      expect(out!.dateSource).toBe('none');
      expect(out!.dateSourceNote).toMatch(/never expiring/i);
    }
  });

  it('⚠️ WRITES NO EXPIRY DATE — the CHECK constraint forbids one', () => {
    // `Credential_never_expires_has_no_date` refuses a standing tick beside a
    // date. A caller merging these columns over a row that carries one has to
    // clear the date or drop the tick; these columns must never supply one.
    expect(
      Object.keys(settledByNature(CredentialKind.SAFE_PHOTOGRAPHS)!),
    ).not.toContain('expiresOn');
  });

  it('fits the column', () => {
    // dateSource is VarChar(16).
    for (const k of [
      CredentialKind.SAFE_PHOTOGRAPHS,
      CredentialKind.PROFICIENCY,
    ]) {
      expect(settledByNature(k)!.dateSource.length).toBeLessThanOrEqual(16);
    }
  });

  it('⚠️ SETTLES A PROFICIENCY TOO, AND THE OPERATOR SAID SO FIRST', () => {
    // Operator, 2026-08-28: "proficiencies never expires, only competencies".
    //
    // ⚠️ THIS IS THE SAME GAP AS THE PHOTOGRAPHS, ONE KIND OVER, AND IT WAS
    // FOUND IN PRODUCTION RATHER THAN REASONED ABOUT. The tick already started
    // ON for a proficiency (NEVER_EXPIRES) but no provenance was ever written
    // with it, so the row sat at `dateSource: null` — which the Document Centre
    // reads as a document nobody has answered for. On 2026-09-25 the four
    // statements of results on production were the entire contents of "we were
    // not sure what type these documents are", on rows we had categorised
    // confidently, and none of them could be auto-attached to an application.
    const out = settledByNature(CredentialKind.PROFICIENCY);
    expect(out).not.toBeNull();
    expect(out!.neverExpires).toBe(true);
    expect(out!.dateSource).toBe('none');
    // The member's words, and true of the document rather than of the kind's
    // name: what does not run out is the proficiency.
    expect(out!.dateSourceNote).toMatch(/proficiency does not run out/i);
  });

  it('⚠️ ANSWERS FOR NOBODY ELSE, and that is the line', () => {
    // The warning at the top of credential-kinds.ts is about kinds where only
    // the member can see the answer: a green barcoded ID does not expire and a
    // passport does, and both are IDENTITY_DOCUMENT. A photograph of a gun
    // safe is not that case — there is provably nothing printed on it, which
    // is why no vision call is spent on one. Neither is a proficiency: there is
    // no statement of results that lapses, so the kind really does carry one
    // answer.
    for (const k of [
      CredentialKind.IDENTITY_DOCUMENT,
      CredentialKind.COMPETENCY_CERTIFICATE,
      CredentialKind.FIREARM_LICENCE,
    ]) {
      expect(settledByNature(k)).toBeNull();
    }
    // Including the one that STARTS ticked for a different reason: the tick is
    // a default the member can change, and settling the date would take that
    // decision away from them — because for an ID document we would be
    // answering a question the kind cannot answer.
    expect(defaultsToNeverExpires(CredentialKind.IDENTITY_DOCUMENT)).toBe(true);
    expect(settledByNature(CredentialKind.IDENTITY_DOCUMENT)).toBeNull();
  });
});

describe('⚠️ WHAT A SETTLED KIND IS NOT', () => {
  it('is NOT "nothing printed to read" — only a photograph is that', () => {
    // ⚠️ THE TWO QUESTIONS THIS FILE'S FLAGS SEPARATE. `isPhotograph` decides
    // whether a vision call is worth spending; `settledByNature` decides
    // whether the expiry question has an answer already. A statement of
    // results is settled AND readable: it carries the course, the unit
    // standards and an issue date, and VaultAdoptionService.datesFor reads that
    // issue date on its way past. Collapsing the two would have thrown it away.
    expect(isPhotograph(CredentialKind.PROFICIENCY)).toBe(false);
    expect(settledByNature(CredentialKind.PROFICIENCY)).not.toBeNull();
    // And the reverse pairing, which is what the early return actually keys on:
    // a photograph is settled because it is unreadable, not because of its name.
    expect(isPhotograph(CredentialKind.SAFE_PHOTOGRAPHS)).toBe(true);
  });
});
