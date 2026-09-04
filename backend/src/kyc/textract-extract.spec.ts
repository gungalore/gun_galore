import * as fs from 'fs';
import * as path from 'path';
import {
  documentKind,
  dobFromIdNumber,
  extractIdentity,
  findValue,
  keyValues,
  readDate,
  readIdNumber,
  saIdChecksumValid,
  type TextractResponse,
} from './textract-extract';

// ────────────────────────────────────────────────────────────────────
// SIX REAL DOCUMENTS, NOT SIX INVENTED ONES.
//
// Every fixture here is an actual AnalyzeDocument response from Textract in
// eu-west-1, run against the operator's own papers: two scans of one SAPS 524
// competency certificate, a firearm licence, a training statement of results,
// a green barcoded ID book and a smart ID card. Geometry polygons were
// stripped; nothing else was touched.
//
// That matters because the two failures this module exists to survive were
// BOTH invisible to confidence and would never have occurred to anyone writing
// synthetic fixtures.
// ────────────────────────────────────────────────────────────────────

const load = (name: string): TextractResponse =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '__fixtures__', 'textract', `${name}.json`), 'utf8'),
  ) as TextractResponse;

const SMART_CARD = load('id-smart-card');
const GREEN_BOOK = load('id-green-book');
const SAPS_A = load('saps524-competency-a');
const SAPS_B = load('saps524-competency-b');
const LICENCE = load('firearm-licence');
const TRAINING = load('training-results');

describe('🚨 the ID number survives both failures we actually saw', () => {
  it('GREEN BOOK: FORMS glued the page number on; the raw text was clean', () => {
    // FORMS returned '1 970724 0045 089' — the "1" printed above the barcode
    // is the page number. The raw OCR line was a perfect
    // "I.D. No. 970724 0045 089". Reading raw text FIRST is what saves it.
    const viaForm = findValue(keyValues(GREEN_BOOK), ['id no']);
    expect(viaForm?.replace(/\D/g, '')).toHaveLength(14);

    const r = extractIdentity(GREEN_BOOK);
    expect(r.idNumber).toBe('9707240045089');

    // ⚠️ AND IT CAME FROM THE RAW TEXT, UNREPAIRED — which is the point of
    // the ordering and the only thing that distinguishes it. Reading FORMS
    // first ALSO yields the right number, because the 14-digit repair rescues
    // it; the difference is that one path needs no repair at all. Asserting
    // only the number passes whichever order is used — this was a test that
    // did not bite until a mutation exposed it.
    expect(r.notes).toHaveLength(0);
  });

  it('SAPS 524: a box border read as a digit, in the OCR itself', () => {
    // The same certificate, scanned twice. Scan A read 890512-5220-089; scan B
    // read 1890512-5220-089 — the left border of the first digit-box. Both at
    // ~94.9% confidence, within a tenth of a point of each other.
    expect(extractIdentity(SAPS_A).idNumber).toBe('8905125220089');
    expect(extractIdentity(SAPS_B).idNumber).toBe('8905125220089');
  });

  it('repairs only when arithmetic agrees, never on a hunch', () => {
    // 14 digits that do NOT become valid when shortened stay refused.
    expect(readIdNumber('1234567890123456').id).toBeNull();
    // And the repair is always declared.
    expect(readIdNumber('19707240045089').note).toMatch(/dropped a leading/);
  });

  it('refuses a checksum-broken number outright', () => {
    expect(saIdChecksumValid('9707240045088')).toBe(false);
    expect(readIdNumber('9707240045088').id).toBeNull();
  });
});

describe('🚨 loose key matching, because the smart card breaks exact matching', () => {
  it('finds the ID even though Textract renamed the key', () => {
    // Textract swallowed the Nationality VALUE into the next KEY, producing
    // 'RSA Identity Number:'. An exact match on "Identity Number" finds nothing.
    const pairs = keyValues(SMART_CARD);
    expect(pairs.some((p) => p.key.includes('RSA Identity Number'))).toBe(true);
    expect(pairs.some((p) => p.key.trim() === 'Identity Number:')).toBe(false);

    expect(findValue(pairs, ['identity number'])).toBe('5904015035080');
  });
});

describe('the identity documents read correctly end to end', () => {
  it('smart ID card', () => {
    const r = extractIdentity(SMART_CARD);
    expect(r.documentType).toBe('SMART_ID_CARD');
    expect(r.idNumber).toBe('5904015035080');
    expect(r.surname).toBe('FOURIE');
    expect(r.names).toBe('PETRUS WILLEM ADRIAAN');
    expect(r.dateOfBirth).toBe('1959-04-01');
  });

  it('green barcoded book — photographed sideways, glared and skewed', () => {
    const r = extractIdentity(GREEN_BOOK);
    expect(r.documentType).toBe('GREEN_BOOK');
    expect(r.surname).toBe('DE BEER');
    expect(r.names).toBe('RUANDA');
    expect(r.dateOfBirth).toBe('1997-07-24');
    // And the printed date agrees with the number's own digits.
    expect(dobFromIdNumber(r.idNumber as string)).toBe('1997-07-24');
  });
});

describe('a non-identity document is not mistaken for one', () => {
  it.each([
    ['competency certificate', SAPS_A],
    ['firearm licence', LICENCE],
    ['training results', TRAINING],
  ])('%s reads as OTHER', (_label, res) => {
    // These carry an ID number and a name, so an extractor that only looked
    // for those would happily treat a licence as proof of identity.
    expect(documentKind(res as TextractResponse)).toBe('OTHER');
  });
});

describe('dates', () => {
  it('reads the spellings these documents actually use', () => {
    expect(readDate('1997-07-24')).toBe('1997-07-24');
    expect(readDate('01 APR 1959')).toBe('1959-04-01');
    expect(readDate('2025-06-06')).toBe('2025-06-06');
    expect(readDate('sometime last year')).toBeNull();
  });

  it('picks the century that does not put the birth in the future', () => {
    expect(dobFromIdNumber('9707240045089')).toBe('1997-07-24');
    expect(dobFromIdNumber('5904015035080')).toBe('1959-04-01');
  });
});
