import { CredentialKind } from '@prisma/client';
import { CLASSIFY_USER } from './licence-centre-extract.service';

// ⚠️ A CATEGORY THE ENUM KNOWS AND THE PROMPT DOES NOT is a document that
// files itself as OTHER on every upload — silently, with no error anywhere,
// and the member correcting us by hand each time. GOOD_STANDING shipped that
// way: added to the enum, the vault menu, the extractor's field list and the
// motivation requirements, and left out of the one prompt that decides what a
// photograph IS.
describe('the classifier prompt', () => {
  it('names every credential kind the database can hold', () => {
    for (const kind of Object.values(CredentialKind)) {
      expect(CLASSIFY_USER).toContain(kind);
    }
  });

  it('⚠️ SEPARATES THE ASSOCIATION DOCUMENTS, which share a letterhead', () => {
    // A status certificate, a sworn letter of good standing and a per-firearm
    // endorsement all arrive from the same association looking alike. Without
    // the distinction spelled out, the letter gets filed as the certificate
    // and the vault chases the wrong expiry date — which is the one job it
    // exists to do.
    expect(CLASSIFY_USER).toMatch(/same letterhead/i);
    expect(CLASSIFY_USER).toMatch(/commissioner of oaths/i);
    expect(CLASSIFY_USER).toMatch(/ENDORSING ONE SPECIFIC FIREARM/);
  });

  it('keeps OTHER an explicit, respectable answer', () => {
    // A guess dressed as certainty is worse than "unsorted": the member is
    // asked to confirm either way, and only one of the two tells them to look.
    expect(CLASSIFY_USER).toMatch(/OTHER - anything else, or you cannot tell/);
  });
});
