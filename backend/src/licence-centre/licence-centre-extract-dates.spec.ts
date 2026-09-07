import { CredentialKind } from '@prisma/client';
import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { LicenceCentreTextractService } from './licence-centre-textract.service';
import type { LlmService } from '../common/llm/llm.service';

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

// `parse` is pure — it never reaches either reader — so the model stands in
// as an unconfigured stub. It used to be absent from the constructor
// entirely, because the service built its own Anthropic client from the env.
const svc = new LicenceCentreExtractService(
  new LicenceCentreTextractService(),
  { isConfigured: () => false } as unknown as LlmService,
);
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

// ────────────────────────────────────────────────────────────────────
// THE COMPETENCY'S DATE OF ISSUE, WHICH THE VISION PATH ASKED FOR UNDER A
// NAME IT WOULD THEN DISCARD.
//
// Operator's row, 2026-09-06: "Competency issued on: Not on the document —
// Still needed". The obvious reading is wrong and worth recording, because the
// obvious fix would have made things worse: nothing MISFILED the date. It was
// never read.
//
// A SAPS 524 is read by Textract, and on the operator's certificate the boxed
// date came back as seven digits where a date needs eight — boxedDate returns
// null rather than guess, REQUIRED_FOR_AUTOFILL marks the certificate not
// auto-fillable, and it reaches the member. All of that is correct.
//
// What was not correct is the fallback. `parse` accepts only wantedFor(kind)
// plus issued_on and expires_on, and the prompt asked for `date_of_issue` — a
// key on nobody's list. A model doing exactly as it was told had its answer
// binned on the way home, silently, which looks identical to a document it
// could not read.
// ────────────────────────────────────────────────────────────────────

describe('the vision fallback asks for a key it will accept', () => {
  /** A configured model that records what it was asked. */
  function asking(reply: unknown) {
    const complete = jest.fn(async () => ({
      text: JSON.stringify(reply),
    }));
    const textract = new LicenceCentreTextractService();
    // Null: no Textract answer, so read() falls through to the model. That is
    // the path under test — on a real SAPS 524 Textract answers first.
    jest.spyOn(textract, 'analyse').mockResolvedValue(null as never);
    const service = new LicenceCentreExtractService(textract, {
      isConfigured: () => true,
      complete,
    } as unknown as LlmService);
    return { service, complete };
  }

  const asked = (complete: jest.Mock): string =>
    (complete.mock.calls[0][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    }).messages[0].content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

  it('⚠️ names competency_issued, not a key the parser drops', async () => {
    const { service, complete } = asking({ fields: [] });
    await service.read({
      kind: CredentialKind.COMPETENCY_CERTIFICATE,
      bytes: Buffer.from('not really a jpeg'),
      mimeType: 'image/jpeg',
    });
    const prompt = asked(complete);
    expect(prompt).toContain('competency_issued');
    // The name that could never come home. Asking for it costs a whole vision
    // call and returns nothing, which reads as an unreadable certificate.
    expect(prompt).not.toContain('date_of_issue');
  });

  it('takes the date home when the model answers under that key', async () => {
    const { service } = asking({
      fields: [
        { key: 'competency_issued', value: '2016-10-20', confidence: 'high' },
        { key: 'issued_on', value: '2016-10-20', confidence: 'high' },
      ],
    });
    const out = await service.read({
      kind: CredentialKind.COMPETENCY_CERTIFICATE,
      bytes: Buffer.from('not really a jpeg'),
      mimeType: 'image/jpeg',
    });
    // Both, because both are stored and they are the same date: the column
    // drives the expiry derivation, the detail carries onto a motivation.
    expect(out.issuedOn).toBe('2016-10-20');
    expect(out.details.competency_issued).toBe('2016-10-20');
  });

  it('⚠️ holds a DETAIL date to the same standard as a column date', () => {
    // competency_issued is typed `kind: 'date'` in the motivation registry and
    // rendered in a date input, so prose arriving here is a value the wizard
    // cannot show and the member cannot correct without noticing. Only
    // expires_on and issued_on were re-validated; these three are dates too.
    expect(
      parse(
        model([{ key: 'competency_issued', value: '20 OCT 2016' }]),
        CredentialKind.COMPETENCY_CERTIFICATE,
      ).details.competency_issued,
    ).toBeUndefined();
    expect(
      parse(
        model([{ key: 'joined_on', value: 'sometime in 2019' }]),
        CredentialKind.DEDICATED_DISCIPLINE,
      ).details.joined_on,
    ).toBeUndefined();
    // A real one is untouched.
    expect(
      parse(
        model([{ key: 'competency_issued', value: '2016-10-20' }]),
        CredentialKind.COMPETENCY_CERTIFICATE,
      ).details.competency_issued,
    ).toBe('2016-10-20');
  });
});
