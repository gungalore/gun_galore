import { CredentialKind } from '@prisma/client';
import { WANTED, currentKind, userPrompt } from './licence-centre-extract.service';

// ────────────────────────────────────────────────────────────────────
// READING AN ASSOCIATION DOCUMENT.
//
// Two facts on these papers reach a SAPS 271 and nothing else can supply
// them: WHICH dedicated status the document awards (item 55's whole premise —
// a hunting association cannot evidence a dedicated sport shooter), and the
// date the membership is VALID UNTIL (item 60). Both are read here or not at
// all, and a prompt is the one part of a reader nothing type-checks.
// ────────────────────────────────────────────────────────────────────

describe('the discipline is asked for, because nothing else records it', () => {
  it('wants status_type on the kind every association document is filed as', () => {
    // ⚠️ WANTED IS BOTH THE QUESTION AND THE FILTER. A key missing here is
    // never asked for AND is discarded if the model volunteers it — so this
    // one line is the difference between knowing a certificate is a dedicated
    // HUNTER's and filling a dedicated SPORT SHOOTER's application from it.
    expect(WANTED[CredentialKind.DEDICATED_DISCIPLINE]).toContain('status_type');
  });

  it('names the four answers it will accept, in the reader’s own words', () => {
    const p = userPrompt(CredentialKind.DEDICATED_DISCIPLINE);
    expect(p).toContain('status_type');
    expect(p).toMatch(/dedicated sport shooter/i);
    expect(p).toMatch(/dedicated hunter/i);
    expect(p).toMatch(/professional hunter/i);
  });
});

describe('the letter of good standing’s "valid until" date', () => {
  // ⚠️ THE GUIDANCE WENT MISSING IN A CONSOLIDATION AND NOTHING NOTICED.
  // GOOD_STANDING's own label still says a letter "shows ... the date the
  // status was issued and the date it is valid until" — but RETIRED_KINDS
  // normalises GOOD_STANDING forward to DEDICATED_DISCIPLINE at classify
  // time, so that sentence has not been put to a model since 2026-08-20.
  // Meanwhile `association_expiry` on the motivation registry tells the
  // member "photograph the letter and we will read it for you". A reader
  // never told where the date is on the page is how that promise goes unkept,
  // and item 60 reaches a DFO blank.
  it('is a kind nobody files under any more, so its wording never runs', () => {
    expect(currentKind(CredentialKind.GOOD_STANDING)).toBe(
      CredentialKind.DEDICATED_DISCIPLINE,
    );
  });

  it('⚠️ so the kind that IS filed says where the date is', () => {
    const p = userPrompt(CredentialKind.DEDICATED_DISCIPLINE);
    expect(p).toMatch(/letter of good standing/i);
    expect(p).toMatch(/valid until/i);
    // Named as the key the parser actually accepts. A prompt naming a key
    // outside wantedFor(kind) + issued_on + expires_on has its answer binned
    // silently on the way back — the mistake that once cost the competency
    // certificate its entire date of issue.
    expect(p).toContain('expires_on');
  });

  it('does not ask for an expiry as a DETAIL, which would be a second date', () => {
    // The expiry lives in the Credential.expiresOn COLUMN, off the `expires_on`
    // channel every kind is asked for. A details key for the same date would
    // give one document two expiries free to disagree — and only one of them
    // is what the renewal sweep reads.
    for (const key of WANTED[CredentialKind.DEDICATED_DISCIPLINE]) {
      expect(key).not.toMatch(/expir|valid_until/i);
    }
  });
});
