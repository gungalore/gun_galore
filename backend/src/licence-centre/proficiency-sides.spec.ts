// The two sides of a proficiency, against the operator's own documents.
//
// Four fronts from three providers (One Shot x2, Progun, NSN) and four PFTC
// statements of results. The fixtures under __fixtures__/textract are the real
// Textract responses; the pairing below is what the vault does with them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractDocument, parseLooseDate, type TextractResponse } from './textract-document-extract';
import { documentSide, findDuplicate, findOtherSide } from './credential-duplicates';

const DIR = join(__dirname, '__fixtures__', 'textract');
const fx = (doc: string): TextractResponse => JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8'));
const MATERIAL = ['certificate_number', 'holder_name', 'unit_standard', 'scv_number', 'issuer'];
const read = (doc: string) => extractDocument(fx(doc), 'PROFICIENCY', MATERIAL).reading;

describe('reading a provider certificate (the front)', () => {
  it('One Shot: the code, the S/C/V number, the certificate number, the name and the date', () => {
    const r = read('doc01');
    expect(r.details.unit_standard).toBe('119650');
    expect(r.details.scv_number).toBe('50BSR-A3597');
    expect(r.details.certificate_number).toBe('19/2025');
    expect(r.details.holder_name).toBe('GJP Fourie');
    expect(r.issuedOn).toBe('2025-03-28');
    expect(r.details.document_side).toBe('front');
  });

  it('Progun: the name past the address line, the split certificate number, "this 31 day of MARCH 2021"', () => {
    const r = read('doc10');
    expect(r.details.unit_standard).toBe('119651');
    expect(r.details.holder_name).toBe('GERHARD JOHAN PETRUS FOURIE');
    expect(r.details.certificate_number).toBe('K/10358-K919835');
    expect(r.issuedOn).toBe('2021-03-31');
    expect(r.details.document_side).toBe('front');
  });

  it('the second One Shot certificate', () => {
    const r = read('doc11');
    expect(r.details.unit_standard).toBe('119652');
    expect(r.details.scv_number).toBe('52BS-A8041');
    expect(r.issuedOn).toBe('2025-04-14');
  });

  it('never invents an expiry', () => {
    for (const d of ['doc01', 'doc10', 'doc11', 'doc02', 'doc14', 'doc16', 'doc17']) {
      expect(read(d).expiresOn).toBeNull();
    }
  });
});

describe('reading a statement of results (the back)', () => {
  it('knows it is the back, and reads the date of issue and the SCV number', () => {
    const r = read('doc02');
    expect(r.details.document_side).toBe('back');
    expect(r.issuedOn).toBe('2025-04-14');
    expect(r.details.scv_number).toBe('52BS-A8041');
    expect(r.details.unit_standard).toBe('119652');
  });
  it('reads both codes off the 2014 template', () => {
    expect(read('doc14').details.unit_standard).toBe('117705, 119649');
  });
});

describe('parseLooseDate', () => {
  it('reads the four ways a provider prints one', () => {
    expect(parseLooseDate('2025/03/28')).toBe('2025-03-28');
    expect(parseLooseDate('14/04/2025')).toBe('2025-04-14');
    expect(parseLooseDate('31 day of MARCH | 2021')).toBe('2021-03-31');
    expect(parseLooseDate('23 January 2014')).toBe('2014-01-23');
    expect(parseLooseDate('99/99/2025')).toBeNull();
    expect(parseLooseDate('')).toBeNull();
  });
});

describe('pairing the two sides', () => {
  const day = new Date('2026-09-06T21:00:00Z');
  const row = (id: string, doc: string, over: Partial<{ createdAt: Date; otherSideId: string | null }> = {}) => {
    const r = read(doc);
    return { id, title: id, createdAt: over.createdAt ?? day, kind: 'PROFICIENCY' as const, details: r.details, issuedOn: r.issuedOn, otherSideId: over.otherSideId ?? null };
  };
  const subject = (doc: string) => {
    const r = read(doc);
    return { kind: 'PROFICIENCY' as const, details: r.details, issuedOn: r.issuedOn };
  };

  it('joins One Shot certificate and statement on the S/C/V number', () => {
    const vault = [row('back-shotgun', 'doc02'), row('back-slr', 'doc16'), row('back-rifle', 'doc17'), row('back-handgun', 'doc14')];
    expect(findOtherSide(subject('doc11'), vault)?.id).toBe('back-shotgun');
    expect(findOtherSide(subject('doc01'), vault)?.id).toBe('back-slr');
  });

  it('joins Progun on the number it prints as a certificate number and the PFTC prints as an SCV number', () => {
    const vault = [row('back-shotgun', 'doc02'), row('back-rifle', 'doc17')];
    expect(findOtherSide(subject('doc10'), vault)?.id).toBe('back-rifle');
  });

  it('works from either side', () => {
    const fronts = [row('front-slr', 'doc01'), row('front-shotgun', 'doc11'), row('front-rifle', 'doc10')];
    expect(findOtherSide(subject('doc16'), fronts)?.id).toBe('front-slr');
    expect(findOtherSide(subject('doc17'), fronts)?.id).toBe('front-rifle');
  });

  it('never pairs a front with a front, or a row already paired', () => {
    expect(findOtherSide(subject('doc01'), [row('x', 'doc11')])).toBeNull();
    expect(findOtherSide(subject('doc01'), [row('taken', 'doc16', { otherSideId: 'someone' })])).toBeNull();
  });

  it('does not call the other side a copy', () => {
    expect(findDuplicate(subject('doc11'), [row('back', 'doc02')])).toBeNull();
    // ...but a second scan of the same side still is one.
    expect(findDuplicate(subject('doc11'), [row('again', 'doc11')])?.id).toBe('again');
  });

  it('falls back to the same codes for the same person within four months', () => {
    const front = subject('doc10');
    const back = row('back', 'doc17');
    back.details = { ...back.details, scv_number: '', certificate_number: '', authentication_code: '' };
    expect(findOtherSide(front, [back])?.id).toBe('back');
    const late = { ...back, issuedOn: '2022-06-01' };
    expect(findOtherSide(front, [late])).toBeNull();
  });

  it('reports the side', () => {
    expect(documentSide(read('doc02').details)).toBe('back');
    expect(documentSide(read('doc01').details)).toBe('front');
    expect(documentSide({})).toBeNull();
  });
});
