import { MotivationExtractService } from './motivation-extract.service';

// ⚠️ WHY A LIBRARY PICK USED TO LOOK BROKEN.
//
// A motivation upload carrying no extraction is flagged "suspect" — the amber
// "we could not read anything this document carries" state — because for a
// photograph that reliably means the wrong line was picked. A document copied
// out of the Licence Centre had never been read AS a motivation upload, so
// every library pick came back amber, telling the member something was wrong
// with a certificate they had just chosen by name off a list.
//
// The fix copies the vault's own reading across, filtered to the keys this
// upload kind actually answers. These pin the filter, because it is the part
// that decides whether a wrong value reaches a signed form.
describe('what a vault reading may fill on a motivation', () => {
  it('lets the competency number across', () => {
    expect(
      MotivationExtractService.wantedFor('COMPETENCY_CERTIFICATE'),
    ).toContain('competency_number');
  });

  it('⚠️ KEEPS OUT KEYS THE REGISTRY HAS NO BOX FOR', () => {
    // The vault reads holder_name and covers off a competency certificate.
    // Neither is an answer on a motivation, and proposing them would offer
    // values for fields that do not exist.
    const wanted = MotivationExtractService.wantedFor('COMPETENCY_CERTIFICATE');
    expect(wanted).not.toContain('holder_name');
    expect(wanted).not.toContain('covers');
  });

  it('⚠️ DOES NOT TREAT covers AS competency_for', () => {
    // They read like the same thing. competency_for is a MULTI field
    // constrained to Handgun / Rifle / Shotgun; the vault's `covers` is free
    // text off a photograph. Aliasing them would put an unmatchable value in
    // a constrained box on a form somebody signs — so the exact-match filter
    // is what stops it, and this is the test that says so out loud.
    const wanted = MotivationExtractService.wantedFor('COMPETENCY_CERTIFICATE');
    expect(wanted).toContain('competency_for');
    expect(wanted).not.toContain('covers');
  });

  it('returns nothing for a kind that is never read', () => {
    // A photograph of a safe carries no fields. canExtract agrees, which is
    // what keeps those rows out of the amber state entirely.
    expect(MotivationExtractService.wantedFor('SAFE_PHOTO_CLOSED')).toHaveLength(0);
    expect(MotivationExtractService.canExtract('SAFE_PHOTO_CLOSED')).toBe(false);
  });
});
