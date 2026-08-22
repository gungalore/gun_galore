import { MotivationLicenceType } from '@prisma/client';
import { AS_AT, renderStatute, statutoryTextFor } from './motivation-statute';

// THE WORDS OF THE ACT.
//
// This file is quoted verbatim into a document somebody SIGNS and files with
// the Registrar, so these tests are about transcription fidelity, not about
// behaviour. A wrong subsection here is a false statement about the law in a
// sworn application.

describe('every licence type has its section', () => {
  it.each(Object.values(MotivationLicenceType))('%s', (t) => {
    const text = statutoryTextFor(t);
    expect(text.length).toBeGreaterThan(200);
    // Every section opens with its own number and heading.
    expect(text).toMatch(/^\d+\. Licence|^\d+\. Renewal/);
  });

  it('maps both section 16 types to the same section', () => {
    // A dedicated hunter and a dedicated sports person apply under one
    // section; the difference is which status the association certifies.
    expect(statutoryTextFor(MotivationLicenceType.S16_DEDICATED_HUNTER)).toBe(
      statutoryTextFor(MotivationLicenceType.S16_DEDICATED_SPORT),
    );
  });

  it('gives a renewal section 24, not the original licence section', () => {
    // ⚠️ A RENEWAL IS JUDGED ON s24(3) — "has continued to comply with the
    // requirements for the licence" — so s24 governs, whatever section the
    // firearm was first licensed under.
    const t = statutoryTextFor(MotivationLicenceType.S24_RENEWAL);
    expect(t).toContain('24. Renewal of firearm licences');
    expect(t).toContain('at least 90 days before the date of expiry');
  });
});

describe('the amendments are in, and that is the whole point', () => {
  it('carries the SUBSTITUTED s16(1)(c), not the as-enacted wording', () => {
    // ⚠️ s16(1)(c) was substituted by s4 of Act 43 of 2003. The original
    // wording has not been the law since 2003, and a bundled "as enacted" text
    // — which is what most sources are — would quote it confidently and
    // wrongly.
    expect(statutoryTextFor(MotivationLicenceType.S16_DEDICATED_SPORT)).toContain(
      'semi-automatic shotgun manufactured to fire no more than five shots in succession',
    );
  });

  it('records how current the transcription is', () => {
    // There is no feed. If the Act is amended again this file is wrong until
    // somebody updates it, so the prompt is told the vintage rather than left
    // to assume.
    expect(AS_AT).toMatch(/2013/);
    expect(renderStatute(MotivationLicenceType.S13_SELF_DEFENCE)).toContain(AS_AT);
  });
});

describe('the section 13 elements a self-defence motivation must answer', () => {
  it('carries both limbs of s13(2)', () => {
    // These two are the whole test the Registrar applies, and the second is
    // the one applicants forget: needing a firearm is not enough, the need
    // must not be reasonably satisfiable another way.
    const t = statutoryTextFor(MotivationLicenceType.S13_SELF_DEFENCE);
    expect(t).toContain('needs a firearm for self-defence');
    expect(t).toContain(
      'cannot reasonably satisfy that need by means other than the possession of a firearm',
    );
  });

  it('carries the one-licence cap', () => {
    expect(statutoryTextFor(MotivationLicenceType.S13_SELF_DEFENCE)).toContain(
      'No person may hold more than one licence',
    );
  });
});

describe('what the block tells the writer', () => {
  const block = renderStatute(MotivationLicenceType.S16_DEDICATED_SPORT);

  it('delimits the text so nothing else can pass as law', () => {
    expect(block).toContain('<statutory-text>');
    expect(block).toContain('</statutory-text>');
  });

  it('forbids quoting more than is applied', () => {
    // Reproducing the whole section because it is available is padding under
    // rule 7, and the corpus we studied does exactly that in places.
    expect(block).toMatch(/QUOTE ONLY WHAT YOU APPLY/);
  });

  it('forbids reaching for anything else in the Act', () => {
    // The temptation is the storage section, the competency section, the
    // general application regulation. None of them are here, and a remembered
    // Act in a signed application is a false statement about the law.
    expect(block).toMatch(/NOTHING ELSE FROM THE ACT/);
  });

  it('carries no page furniture from the source PDF', () => {
    // The transcription came out of a PDF whose every page carries "Prepared
    // by:" and "Page 28 of 112". Either would be quoted straight into a
    // signed application.
    for (const t of Object.values(MotivationLicenceType)) {
      expect(statutoryTextFor(t)).not.toMatch(/Prepared by|Page \d+ of \d+/);
    }
  });

  it('carries no amendment annotations either', () => {
    // The source annotates inline — "(Section 16(1)(c) substituted by section
    // 4 of Act 43 of 2003)". Useful to a lawyer reading the Act, wrong inside
    // a quotation in somebody's application.
    for (const t of Object.values(MotivationLicenceType)) {
      expect(statutoryTextFor(t)).not.toMatch(/substituted by section|inserted by section/);
      expect(statutoryTextFor(t)).not.toMatch(/Commencement date of section/);
    }
  });
});
