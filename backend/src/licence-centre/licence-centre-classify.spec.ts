import { CredentialKind } from '@prisma/client';
import { CLASSIFY_USER } from './licence-centre-extract.service';

/** Kinds that survive only for rows filed before the consolidation. */
const RETIRED = new Set<string>([
  'DEDICATED_STATUS',
  'DEDICATED_HUNTER',
  'PROFESSIONAL_HUNTER',
  'GOOD_STANDING',
]);

// ⚠️ A CATEGORY THE ENUM KNOWS AND THE PROMPT DOES NOT is a document that
// files itself as OTHER on every upload — silently, with no error anywhere,
// and the member correcting us by hand each time. GOOD_STANDING shipped that
// way: added to the enum, the vault menu, the extractor's field list and the
// motivation requirements, and left out of the one prompt that decides what a
// photograph IS.
describe('the classifier prompt', () => {
  it('names every kind a document can still be filed as', () => {
    // ⚠️ THE RETIRED FOUR ARE DELIBERATELY ABSENT. Postgres cannot drop an
    // enum value, so DEDICATED_STATUS, DEDICATED_HUNTER, PROFESSIONAL_HUNTER
    // and GOOD_STANDING are still in CredentialKind — but offering them here
    // would invite the classifier to file a document outside every query that
    // now looks for DEDICATED_DISCIPLINE.
    for (const kind of Object.values(CredentialKind)) {
      if (RETIRED.has(kind)) {
        // The option lines all read "<KIND> - description", so the absence of
        // that exact form is what proves the kind is not on the menu.
        expect(CLASSIFY_USER).not.toContain(`${kind} -`);
        continue;
      }
      expect(CLASSIFY_USER).toContain(kind);
    }
  });

  it('⚠️ MAKES THE ASSOCIATION DOCUMENTS ONE CATEGORY, not four', () => {
    // THIS REVERSES A DELIBERATE EARLIER DECISION. The four were separated
    // because a status certificate, a sworn letter and a PH registration are
    // different papers — true, and it did not matter, because the SPLIT MADE
    // THE CLASSIFIER GUESS. On a certificate from a body accredited for both
    // hunting and sport it guessed from the letterhead and filed the
    // operator's sport-shooter status as DEDICATED_HUNTER: the wrong status
    // on a section 16 application.
    //
    // One category removes the guess. Which discipline it awards, and whether
    // the member is in good standing, are read off the document afterwards.
    expect(CLASSIFY_USER).toMatch(/DEDICATED_DISCIPLINE/);
    expect(CLASSIFY_USER).toMatch(/DO NOT TRY TO TELL THEM APART/i);
    // And it must say so for each of the papers it now absorbs, or a member
    // watching us file their letter of good standing as "dedicated
    // discipline" has no way to know that is correct.
    expect(CLASSIFY_USER).toMatch(/letter of good standing/i);
    expect(CLASSIFY_USER).toMatch(/professional hunter/i);
    expect(CLASSIFY_USER).toMatch(/membership certificate/i);
  });

  it('says a member may hold several, from different associations', () => {
    expect(CLASSIFY_USER).toMatch(/several of these from different/i);
  });

  it('keeps OTHER an explicit, respectable answer', () => {
    // A guess dressed as certainty is worse than "unsorted": the member is
    // asked to confirm either way, and only one of the two tells them to look.
    expect(CLASSIFY_USER).toMatch(/OTHER - anything else, or you cannot tell/);
  });
});
