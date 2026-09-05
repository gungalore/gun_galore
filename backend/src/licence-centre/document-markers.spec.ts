// backend/src/licence-centre/document-markers.spec.ts
//
// The marker table, run against all 18 real documents it was derived from.
//
// These are the operator's own papers, put through Textract on the live box:
// seven firearm licences, three SAPS 524 competency certificates, four SAPFTC
// statements of results, three training certificates from three different
// providers, and a green ID book. If a change to the table breaks the filing
// of any of them, that is a regression on documents we know exist.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { classifyByMarkers } from './document-markers';

const DIR = join(__dirname, '__fixtures__', 'textract');

const lines = (doc: string): string[] =>
  (
    JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8')) as {
      Blocks: { BlockType: string; Text?: string }[];
    }
  ).Blocks.filter((b) => b.BlockType === 'LINE').map((b) => b.Text ?? '');

/** What each scan actually is, established by reading the extracted text. */
const EXPECTED: Record<string, { kind: string; variant: string }> = {
  doc01: { kind: 'PROFICIENCY', variant: 'training-certificate' },
  doc02: { kind: 'PROFICIENCY', variant: 'sapftc-statement-of-results' },
  doc03: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc04: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc05: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc06: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc07: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc08: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc09: { kind: 'FIREARM_LICENCE', variant: 'saps-licence-card' },
  doc10: { kind: 'PROFICIENCY', variant: 'training-certificate' },
  doc11: { kind: 'PROFICIENCY', variant: 'training-certificate' },
  doc12: { kind: 'COMPETENCY_CERTIFICATE', variant: 'saps-524' },
  doc13: { kind: 'COMPETENCY_CERTIFICATE', variant: 'saps-524' },
  doc14: { kind: 'PROFICIENCY', variant: 'sapftc-statement-of-results' },
  doc15: { kind: 'COMPETENCY_CERTIFICATE', variant: 'saps-524' },
  doc16: { kind: 'PROFICIENCY', variant: 'sapftc-statement-of-results' },
  doc17: { kind: 'PROFICIENCY', variant: 'sapftc-statement-of-results' },
  doc18: { kind: 'IDENTITY_DOCUMENT', variant: 'sa-green-book' },
};

describe('classifyByMarkers — every real document files correctly', () => {
  it.each(Object.keys(EXPECTED))('%s', (doc) => {
    const result = classifyByMarkers(lines(doc));
    expect(result).not.toBeNull();
    expect(result?.kind).toBe(EXPECTED[doc].kind);
  });

  it('files all 18 without a single unrecognised document', () => {
    const unrecognised = Object.keys(EXPECTED).filter(
      (d) => classifyByMarkers(lines(d)) === null,
    );
    expect(unrecognised).toEqual([]);
  });
});

describe('the table refuses to guess', () => {
  it('returns null on a document it has never seen', () => {
    // A proof of address. Nothing in the table describes one, and the correct
    // answer is "I do not know" so the Claude fallback gets it — NOT the
    // nearest-scoring kind, which would file a municipal bill as a firearm
    // licence and put it on an application.
    expect(
      classifyByMarkers([
        'CITY OF JOHANNESBURG',
        'MUNICIPAL ACCOUNT',
        'ACCOUNT NUMBER 123456',
        'AMOUNT DUE',
      ]),
    ).toBeNull();
  });

  it('returns null on a photograph with no text', () => {
    // A safe photograph. Textract returns nothing useful and that is not a
    // failure — it is a picture of a steel box.
    expect(classifyByMarkers([])).toBeNull();
  });

  it('does not let shared vocabulary carry a decision', () => {
    // "IDENTITY NUMBER" is on a competency certificate AND an ID card, and
    // "SOUTH AFRICAN POLICE SERVICE" is on every SAPS form. Neither, alone,
    // is a document.
    expect(
      classifyByMarkers(['IDENTITY NUMBER', 'SOUTH AFRICAN POLICE SERVICE']),
    ).toBeNull();
  });
});

describe('decisiveness gates auto-filing', () => {
  it('a real licence is decisive', () => {
    const r = classifyByMarkers(lines('doc03'));
    expect(r?.decisive).toBe(true);
  });

  it('reports what actually matched, so a misfile can be traced', () => {
    const r = classifyByMarkers(lines('doc12'));
    expect(r?.matched).toEqual(expect.arrayContaining(['SAPS 524']));
  });

  it('two rules for the SAME kind are not rivals', () => {
    // The ID card and the green book are both IDENTITY_DOCUMENT. Scoring them
    // against each other would make every identity document look ambiguous
    // and send all of them for review.
    const r = classifyByMarkers([
      'REPUBLIC OF SOUTH AFRICA',
      'NATIONAL IDENTITY CARD',
      'COUNTRY OF BIRTH',
      'NATIONALITY',
    ]);
    expect(r?.kind).toBe('IDENTITY_DOCUMENT');
    expect(r?.decisive).toBe(true);
  });
});
