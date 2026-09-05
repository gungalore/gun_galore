// backend/src/licence-centre/marker-classification.spec.ts
//
// The existing marker classifier, against 18 REAL Textract responses.
//
// common/document-markers.ts already answers "which document is this?", and
// its own spec exercises it against document text. These fixtures are a
// different kind of evidence: actual AnalyzeDocument responses from the live
// box, for the operator's own papers — seven firearm licences, three SAPS 524
// competency certificates, four SAPFTC statements of results, three training
// certificates from three providers, and a green ID book.
//
// They are here because the Document Centre now feeds Textract's output into
// that classifier, and text that has been through a real OCR is not the same
// text a person types into a fixture. Line order differs, spacing differs,
// and words come back split ("CARB" as "CA RB").
//
// This also pins UPLOAD_TO_CREDENTIAL, which is the seam between the two kind
// vocabularies — the classifier answers in MotivationUploadKind and the
// Document Centre files in CredentialKind.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readMarkers } from '../common/document-markers';
import { UPLOAD_TO_CREDENTIAL } from './upload-to-credential';

const DIR = join(__dirname, '__fixtures__', 'textract');

const textOf = (doc: string): string =>
  (
    JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8')) as {
      Blocks: { BlockType: string; Text?: string }[];
    }
  ).Blocks.filter((b) => b.BlockType === 'LINE')
    .map((b) => b.Text ?? '')
    .join('\n');

/** What each scan is, established by reading the extracted text. */
const EXPECTED: Record<string, string> = {
  doc01: 'PROFICIENCY',
  doc02: 'PROFICIENCY',
  doc03: 'FIREARM_LICENCE',
  doc04: 'FIREARM_LICENCE',
  doc05: 'FIREARM_LICENCE',
  doc06: 'FIREARM_LICENCE',
  doc07: 'FIREARM_LICENCE',
  doc08: 'FIREARM_LICENCE',
  doc09: 'FIREARM_LICENCE',
  doc10: 'PROFICIENCY',
  doc11: 'PROFICIENCY',
  doc12: 'COMPETENCY_CERTIFICATE',
  doc13: 'COMPETENCY_CERTIFICATE',
  doc14: 'PROFICIENCY',
  doc15: 'COMPETENCY_CERTIFICATE',
  doc16: 'PROFICIENCY',
  doc17: 'PROFICIENCY',
  doc18: 'IDENTITY_DOCUMENT',
};

const classify = (doc: string): string | null => {
  const hit = readMarkers(textOf(doc));
  return hit ? (UPLOAD_TO_CREDENTIAL[hit.kind] ?? null) : null;
};

describe('real Textract output classifies correctly', () => {
  it.each(Object.keys(EXPECTED))('%s', (doc) => {
    expect(classify(doc)).toBe(EXPECTED[doc]);
  });

  it('every fixture is accounted for', () => {
    const fixtures = readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
    expect(fixtures.sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('the seam between the two kind vocabularies', () => {
  it('maps every kind the markers can decide', () => {
    // A gap here is silent: the classifier answers confidently, the mapping
    // yields undefined, and the document falls through to the model as if
    // nothing had been recognised — paying for a call that was not needed.
    for (const doc of ['doc03', 'doc12', 'doc02', 'doc18']) {
      const hit = readMarkers(textOf(doc));
      expect(hit).not.toBeNull();
      expect(UPLOAD_TO_CREDENTIAL[hit!.kind]).toBeDefined();
    }
  });

  it('leaves the per-person documents unmapped, on purpose', () => {
    // Proof of address and letters of good standing vary per person, so the
    // markers do not decide them and this map must not pretend otherwise.
    // Operator, 2026-08-29: "I need the AI to interpret these documents."
    expect(UPLOAD_TO_CREDENTIAL['PROOF_OF_ADDRESS' as never]).toBeUndefined();
    expect(UPLOAD_TO_CREDENTIAL['GOOD_STANDING_LETTER' as never]).toBeUndefined();
  });
});
