import { CredentialKind, MotivationUploadKind } from '@prisma/client';
import { VAULTABLE, vaultKindFor } from './vault-adoption.service';
import { CREDENTIAL_TO_UPLOAD } from './motivation-credentials';
import { NEVER_REUSABLE } from './motivation-library';

// ────────────────────────────────────────────────────────────────────
// THE GOOD STANDING LETTER COULD NOT REACH THE DOCUMENT CENTRE.
//
// Operator, item 2 of twelve, 2026-08-24: "Letter of good standing not in
// Document Centre so can't pull anything from there or save it once it's been
// uploaded in the Motivation Centre."
//
// The save half was VAULTABLE: a letter photographed on an application had no
// route into the vault at all, and because the caller is a swallowed
// `void ... .catch()`, it failed without even a log line. Three other kinds
// were in the same state — a competency certificate and both association
// documents could all be PULLED from the Centre and none could be SAVED to it.
//
// ⚠️ AND ADDING THEM TO VAULTABLE ALONE WOULD HAVE FAILED SILENTLY FOREVER.
// vaultKindFor falls back to `kind as unknown as CredentialKind`, and there is
// no GOOD_STANDING_LETTER or ASSOCIATION_CARD member of CredentialKind — the
// association kinds were folded into DEDICATED_DISCIPLINE. Prisma would reject
// the create and the swallowed caller would never say so. That is the exact
// "adopted into a hole" failure the map's own comment describes, and it is
// what this file exists to prevent recurring.
// ────────────────────────────────────────────────────────────────────

const CREDENTIAL_KINDS = new Set<string>(Object.keys(CredentialKind));

describe('every vaultable kind can actually be filed', () => {
  it('⚠️ resolves to a REAL CredentialKind — no kind may fall through the cast', () => {
    const broken: string[] = [];
    for (const kind of VAULTABLE) {
      const filed = vaultKindFor(kind);
      if (!CREDENTIAL_KINDS.has(filed)) broken.push(`${kind} -> ${filed}`);
    }
    expect(broken).toEqual([]);
  });

  it('admits the four kinds the operator could not save', () => {
    expect(VAULTABLE.has(MotivationUploadKind.GOOD_STANDING_LETTER)).toBe(true);
    expect(VAULTABLE.has(MotivationUploadKind.COMPETENCY_CERTIFICATE)).toBe(true);
    expect(VAULTABLE.has(MotivationUploadKind.ASSOCIATION_CARD)).toBe(true);
  });

  it('files the association documents under the live folded kind', () => {
    expect(vaultKindFor(MotivationUploadKind.GOOD_STANDING_LETTER)).toBe(
      CredentialKind.DEDICATED_DISCIPLINE,
    );
    expect(vaultKindFor(MotivationUploadKind.ASSOCIATION_CARD)).toBe(
      CredentialKind.DEDICATED_DISCIPLINE,
    );
  });

  it('leaves identity-named kinds alone', () => {
    expect(vaultKindFor(MotivationUploadKind.COMPETENCY_CERTIFICATE)).toBe(
      CredentialKind.COMPETENCY_CERTIFICATE,
    );
    expect(vaultKindFor(MotivationUploadKind.IDENTITY_DOCUMENT)).toBe(
      CredentialKind.IDENTITY_DOCUMENT,
    );
  });

  it('still folds the retired safe kinds forward', () => {
    expect(vaultKindFor(MotivationUploadKind.SAFE_PHOTO_CLOSED)).toBe(
      CredentialKind.SAFE_PHOTOGRAPHS,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// PULLABLE AND SAVABLE MUST BE THE SAME LIST.
//
// ⚠️ THIS BUG CLASS HAS NOW SHIPPED TWICE. On 2026-08-24 four kinds — the good
// standing letter, the competency certificate and the two association
// documents — could be PULLED out of the Centre onto an application and never
// SAVED back to it. On 2026-08-29 the same was true of the statement of
// results and the firearm licence, which had been pullable since the module
// was written.
//
// It is invisible from either end. The pull works, so the Centre looks wired;
// the save is a swallowed `void ... .catch()`, so the failure has no log line.
// The member simply finds, two years later, that a document they gave us is
// gone.
//
// Asserted rather than watched for.
// ────────────────────────────────────────────────────────────────────

describe('⚠️ every document the Centre can lend, it can also keep', () => {
  /**
   * Kinds the Centre may hand to an application without keeping a copy.
   *
   * ⚠️ AN ENTRY HERE IS A DECISION, NOT A BACKLOG ITEM. Adding one silently
   * loses that document at the end of the retention clock, so each needs a
   * reason that survives a member asking where their paperwork went.
   */
  const LEND_ONLY: Partial<Record<CredentialKind, string>> = {
    // Retired kinds. Rows filed before the consolidation still map forward so
    // an old document answers a new application, but nothing new is ever
    // FILED under them — so there is nothing to save back.
    DEDICATED_STATUS: 'retired 2026-08-20, maps forward only',
    DEDICATED_HUNTER: 'retired 2026-08-20, maps forward only',
    GOOD_STANDING: 'retired 2026-08-20, maps forward only',
    // ⚠️ A DECISION, NOT AN OVERSIGHT, AND vault-adoption.service.spec.ts
    // ASSERTS IT FROM THE OTHER SIDE. A licence is tied to one firearm, and
    // the Licence Centre is how a member's own licences reach the vault —
    // adopting them from an application too would file a second row for a
    // licence the Centre already holds. So it is lent and not kept, on
    // purpose. Revisit only with the operator.
    FIREARM_LICENCE: 'tied to one firearm; the Licence Centre owns this route',
  };

  it('has no kind that can be lent but not kept', () => {
    const unkeepable: string[] = [];
    for (const [credential, uploads] of Object.entries(CREDENTIAL_TO_UPLOAD)) {
      if (!uploads.length) continue; // nothing to lend
      if (credential in LEND_ONLY) continue;
      for (const u of uploads) {
        if (!VAULTABLE.has(u)) unkeepable.push(`${credential} -> ${u}`);
      }
    }
    // Named, not counted: the failure has to say WHICH document is lost.
    expect(unkeepable).toEqual([]);
  });

  it('⚠️ NEVER FILES A DOCUMENT UNDER A KIND THE DATABASE REJECTS', () => {
    // vaultKindFor ends in `kind as unknown as CredentialKind`. That cast is
    // invisible to the compiler and to Prisma's types, and a kind whose name
    // does not happen to exist in CredentialKind reaches the database as a
    // value its enum does not contain. The create is rejected, the caller
    // swallows it, and the document is silently never kept.
    //
    // Both kinds added on 2026-08-29 land here: CredentialKind has no
    // PROFICIENCY_CERTIFICATE and no CURRENT_LICENCE.
    const real = new Set(Object.values(CredentialKind));
    const bogus: string[] = [];
    for (const kind of VAULTABLE) {
      const filed = vaultKindFor(kind);
      if (!real.has(filed)) bogus.push(`${kind} -> ${filed}`);
    }
    expect(bogus).toEqual([]);
  });

  it('files the statement of results under the name the database uses', () => {
    expect(vaultKindFor(MotivationUploadKind.PROFICIENCY_CERTIFICATE)).toBe(
      CredentialKind.PROFICIENCY,
    );
  });

  it('⚠️ KEEPS THE STATEMENT OF RESULTS, WHICH NEVER EXPIRES', () => {
    // The worst document to lose. The operator holds 117705 on a 2014 handgun
    // statement and must file that same page again for every future
    // application; losing it means asking a training provider to reprint a
    // course passed a decade ago.
    expect(VAULTABLE.has(MotivationUploadKind.PROFICIENCY_CERTIFICATE)).toBe(true);
  });

  it('does not start keeping anything the library calls single-use', () => {
    // VAULTABLE and NEVER_REUSABLE must not overlap: a document that cannot be
    // offered to another application has no business in a permanent library.
    for (const kind of VAULTABLE) {
      expect({ kind, singleUse: NEVER_REUSABLE.has(kind) }).toEqual({
        kind,
        singleUse: false,
      });
    }
  });
});
