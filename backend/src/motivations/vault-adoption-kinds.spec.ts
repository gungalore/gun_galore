import { CredentialKind, MotivationUploadKind } from '@prisma/client';
import { VAULTABLE, vaultKindFor } from './vault-adoption.service';

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
