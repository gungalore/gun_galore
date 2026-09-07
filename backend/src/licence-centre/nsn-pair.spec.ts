// The NSN pair: a 2014 "Competency Course" certificate and the 2014-template
// PFTC statement behind it. Operator, 2026-09-07: "the NSN on both sides
// needed a review, and it also does not match the statement of results and
// certificate."
//
// Three things stood in the way, each fixed here: a SASSETA registration
// number that matched the ID pattern first, a certificate number printed two
// lines before its label, and a statement whose date is under "US Completed
// On" rather than "Date of issue".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractDocument, type TextractResponse } from './textract-document-extract';
import { findOtherSide } from './credential-duplicates';

const DIR = join(__dirname, '__fixtures__', 'textract');
const MATERIAL = ['certificate_number', 'holder_name', 'unit_standard', 'scv_number', 'issuer'];
const read = (res: TextractResponse) => extractDocument(res, 'PROFICIENCY', MATERIAL).reading;
const fx = (doc: string): TextractResponse => JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8'));

/** The certificate as Textract lines it, in the order the page reads. */
const NSN_FRONT: TextractResponse = {
  Blocks: [
    'SASSETA REG NO:',
    '0419 0400 2286',
    'SHOOTING RANGE NO:',
    '3000 051',
    'TRAINER PROVIDER NO:',
    '4000 114',
    '269 DYKOR STREET, SILVERTON',
    'THIS IS TO CERTIFY THAT',
    'GERHARD JOHAN PETRUS FOURIE',
    'NAME',
    '890512 5220 089',
    'ID NUMBER',
    'HAS SUCCESSFULLY COMPLETED A',
    'DEMONSTRATE KNOWLEDGE OF',
    'THE FIREARMS CONTROL ACT 2000',
    '(ACT 60 OF 2000)',
    '117705',
    'HANDLE AND USE OF A HANDGUN',
    '119649',
    'COMPETENCY COURSE',
    '23/01/2014',
    'TRG 11897',
    'DATE',
    'CERTIFICATE NO',
    'RANGE MASTER',
    'M J VAN HEERDEN',
    '19A 0604 0502',
    'ASSESSOR',
    'JC CRUYWAGEN',
    '19A11470505',
  ].map((t, i) => ({ Id: `L${i}`, BlockType: 'LINE', Text: t, Confidence: 99 })),
};

describe('the NSN certificate', () => {
  const r = read(NSN_FRONT);
  it('finds the ID number past the SASSETA registration number', () => {
    expect(r.details.id_number).toBe('8905125220089');
  });
  it('reads the certificate number from two lines before its label', () => {
    expect(r.details.certificate_number).toBe('TRG 11897');
  });
  it('reads the holder, both codes and the date', () => {
    expect(r.details.holder_name).toBe('GERHARD JOHAN PETRUS FOURIE');
    expect(r.details.unit_standard).toBe('117705, 119649');
    expect(r.issuedOn).toBe('2014-01-23');
    expect(r.details.document_side).toBe('front');
  });
});

describe('the 2014 statement of results', () => {
  it('takes its date from "US Completed On"', () => {
    expect(read(fx('doc14')).issuedOn).toBe('2014-01-23');
  });
});

describe('the pair', () => {
  const day = new Date('2026-09-07T04:32:00Z');
  const back = read(fx('doc14'));
  const front = read(NSN_FRONT);
  const row = (id: string, r: typeof back) => ({ id, title: id, createdAt: day, kind: 'PROFICIENCY' as const, details: r.details, issuedOn: r.issuedOn, otherSideId: null });

  it('matches on the certificate number', () => {
    expect(findOtherSide({ kind: 'PROFICIENCY', ...front }, [row('back', back)])?.id).toBe('back');
    expect(findOtherSide({ kind: 'PROFICIENCY', ...back }, [row('front', front)])?.id).toBe('front');
  });

  it('still matches with the numbers gone, on the codes, the ID and the date', () => {
    const strip = (r: typeof back) => ({ ...r, details: { ...r.details, certificate_number: '', scv_number: '', authentication_code: '' } });
    expect(findOtherSide({ kind: 'PROFICIENCY', ...strip(front) }, [row('back', strip(back))])?.id).toBe('back');
  });

  it('matches with one ID missing when the dates agree, and not when they do not', () => {
    const noId = { ...front, details: { ...front.details, id_number: '', certificate_number: '' } };
    expect(findOtherSide({ kind: 'PROFICIENCY', ...noId }, [row('back', back)])?.id).toBe('back');
    const late = { ...noId, issuedOn: '2016-01-23' };
    expect(findOtherSide({ kind: 'PROFICIENCY', ...late }, [row('back', back)])).toBeNull();
  });
});
