import { CredentialKind, MotivationUploadKind } from '@prisma/client';
import {
  CREDENTIAL_TO_UPLOAD,
  MOTIVATION_KIND_OPTIONS,
  VAULT_COVER_OPTIONS,
  VAULT_KIND_OPTIONS,
} from './document-dictionary';
import { currentKind } from '../../licence-centre/licence-centre-extract.service';
import { CLASSIFIABLE } from '../../motivations/motivation-extract.service';

// ────────────────────────────────────────────────────────────────────
// ONE DICTIONARY, TWO SURFACES — AND THIS PINS THAT IT IS ONE.
//
// The arrays moved into document-dictionary.ts verbatim, so these assertions
// are the proof that nothing drifted in the move: the vault set is exactly the
// live CredentialKinds, and the motivation set mirrors CLASSIFIABLE.
// ────────────────────────────────────────────────────────────────────

describe('the document dictionary', () => {
  it('names only live CredentialKinds, never a retired one', () => {
    const known = Object.values(CredentialKind) as string[];
    for (const o of VAULT_KIND_OPTIONS) {
      expect(known).toContain(o.id);
      // `currentKind` maps a retired kind forward to its live one, so a live
      // kind maps to itself. Filing a new row under a retired kind puts it
      // outside every query that now looks for the live one — see RETIRED_KINDS.
      expect(currentKind(o.id as CredentialKind)).toBe(o.id);
    }
  });

  it('offers the vault cover set as the kind set minus OTHER', () => {
    expect(VAULT_COVER_OPTIONS.map((o) => o.id)).toEqual(
      VAULT_KIND_OPTIONS.filter((o) => o.id !== CredentialKind.OTHER).map(
        (o) => o.id,
      ),
    );
  });

  it('mirrors CLASSIFIABLE, in the same order', () => {
    // ⚠️ THE MIRROR IS THE WHOLE POINT. A kind here and not there is a document
    // the writer files as OTHER on every upload, silently.
    expect(MOTIVATION_KIND_OPTIONS.map((o) => o.id)).toEqual(CLASSIFIABLE);
  });

  it('has no duplicate folder id on either surface', () => {
    for (const set of [VAULT_KIND_OPTIONS, MOTIVATION_KIND_OPTIONS]) {
      const ids = set.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('places a dedicated certificate on the card AND the good-standing row', () => {
    // The placement map moved here with the folders; this is the one row the
    // operator keeps asking about — a valid dedicated certificate answers the
    // section 16 letter of good standing, so it fills both checklist rows.
    expect(CREDENTIAL_TO_UPLOAD[CredentialKind.DEDICATED_DISCIPLINE]).toEqual([
      MotivationUploadKind.ASSOCIATION_CARD,
      MotivationUploadKind.GOOD_STANDING_LETTER,
    ]);
  });

  it('gives every folder a label and a discriminator', () => {
    for (const set of [
      VAULT_KIND_OPTIONS,
      VAULT_COVER_OPTIONS,
      MOTIVATION_KIND_OPTIONS,
    ]) {
      for (const o of set) {
        expect(o.label.trim().length).toBeGreaterThan(0);
        expect(o.hint.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
