import { CredentialKind } from '@prisma/client';
import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { LicenceCentreTextractService } from './licence-centre-textract.service';

// ────────────────────────────────────────────────────────────────────
// THE TWO DATES A DOCUMENT CAN GIVE US, AND WHAT WE DO WITH THEM.
//
// Both cases below were live in production and neither had a test.
//
// The Document Centre is about to start WRITING these dates and arming a
// reminder off them, instead of asking the member to confirm each one —
// operator, 2026-08-25: "insert it. No further user interaction required."
// That removes the human who would have noticed. These two are the
// difference between automating a good answer and automating a wrong one.
// ────────────────────────────────────────────────────────────────────

type Parse = (
  text: string,
  kind: CredentialKind,
  alsoCovers?: readonly CredentialKind[],
) => {
  expiresOn: string | null;
  issuedOn: string | null;
  details: Record<string, string>;
  lowConfidence: string[];
};

const svc = new LicenceCentreExtractService(new LicenceCentreTextractService());
// Private by design; reaching it keeps the test honest about where the defect
// was rather than mocking the model around it.
const parse = (svc as unknown as { parse: Parse }).parse.bind(svc);

const model = (fields: { key: string; value: string; confidence?: string }[]) =>
  JSON.stringify({ fields });

describe('a date read off a document', () => {
  it('⚠️ never lands an expiry in the ISSUE date of a competency', () => {
    // ⚠️ THE BUG, AND IT WAS MINE, SHIPPED THE SAME DAY. A competency
    // certificate prints no expiry, so the parser was told to ignore one if
    // the model volunteered it. It was written as:
    //
    //     if (key === 'expires_on' && kind !== 'COMPETENCY_CERTIFICATE') {
    //       out.expiresOn = value;
    //     } else out.issuedOn = value;
    //
    // For a competency the condition is false, so an EXPIRY fell into the
    // else and was written to issuedOn — overwriting the one date the
    // certificate does print. That date is what the five-year no-licence rule
    // counts from, so a member with no licence in a category would have had
    // their competency dated five years from a number the model invented.
    const out = parse(
      model([
        { key: 'issued_on', value: '2025-06-06' },
        { key: 'expires_on', value: '2030-06-06' },
      ]),
      CredentialKind.COMPETENCY_CERTIFICATE,
    );
    expect(out.issuedOn).toBe('2025-06-06');
    expect(out.expiresOn).toBeNull();
  });

  it('drops a read expiry on a proficiency and an ID — neither runs out', () => {
    // Operator, 2026-08-28: "proficiencies never expires, only competencies"
    // and "ID document also never expires".
    //
    // ⚠️ THE TICK ALONE WOULD NOT HAVE BEEN ENOUGH. A date reaches the row by
    // TWO routes: the never-expires default, and whatever vision reads off the
    // page. Vision is asked for expires_on on every kind it runs on, so
    // without this drop a misread number still lands in Credential.expiresOn
    // — and the member is then asked to confirm a date they cannot check
    // against a card that does not print one.
    //
    // The issue date SURVIVES, which is the whole point of dropping rather
    // than redirecting: see the competency bug above.
    for (const kind of [
      CredentialKind.PROFICIENCY,
      CredentialKind.IDENTITY_DOCUMENT,
    ]) {
      const out = parse(
        model([
          { key: 'issued_on', value: '2021-03-04' },
          { key: 'expires_on', value: '2031-03-04' },
        ]),
        kind,
      );
      expect(out.expiresOn).toBeNull();
      expect(out.issuedOn).toBe('2021-03-04');
    }
  });

  it('still takes both dates off a firearm licence', () => {
    const out = parse(
      model([
        { key: 'issued_on', value: '2025-09-22' },
        { key: 'expires_on', value: '2035-09-21' },
      ]),
      CredentialKind.FIREARM_LICENCE,
    );
    expect(out.issuedOn).toBe('2025-09-22');
    expect(out.expiresOn).toBe('2035-09-21');
  });

  it('⚠️ records that the model was unsure ABOUT A DATE', () => {
    // ⚠️ THE ANSWER WAS THROWN AWAY EVERY TIME. The date branch returned
    // before the confidence capture at the foot of the loop, so lowConfidence
    // could never contain expires_on or issued_on — the two fields where it
    // matters most. Nothing could gate on "was the model sure?", which makes
    // "only insert a date we are confident of" unimplementable rather than
    // merely unimplemented.
    const out = parse(
      model([{ key: 'expires_on', value: '2035-09-21', confidence: 'low' }]),
      CredentialKind.FIREARM_LICENCE,
    );
    expect(out.expiresOn).toBe('2035-09-21');
    expect(out.lowConfidence).toContain('expires_on');
  });

  it('leaves a confidently-read date unflagged', () => {
    const out = parse(
      model([{ key: 'expires_on', value: '2035-09-21', confidence: 'high' }]),
      CredentialKind.FIREARM_LICENCE,
    );
    expect(out.lowConfidence).not.toContain('expires_on');
  });

  it('drops a date it cannot parse rather than guessing at one', () => {
    // "About March 2026" is a plausible thing for a model to return off a
    // smudged card, and it is not a date.
    const out = parse(
      model([{ key: 'expires_on', value: 'about March 2026' }]),
      CredentialKind.FIREARM_LICENCE,
    );
    expect(out.expiresOn).toBeNull();
  });
});
