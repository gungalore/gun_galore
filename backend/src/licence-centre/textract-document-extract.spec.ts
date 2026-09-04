// backend/src/licence-centre/textract-document-extract.spec.ts
//
// The extractor, against the operator's own 18 documents.
//
// These assertions are values read off real paper — a Howa in 6.5 Creedmoor,
// a competency numbered C7276902 — not invented fixtures. A change that
// breaks one of them breaks a document we know exists.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractDocument,
  type TextractResponse,
} from './textract-document-extract';

const DIR = join(__dirname, '__fixtures__', 'textract');
const fx = (doc: string): TextractResponse =>
  JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8'));

/** Mirrors WANTED in the Claude extractor — the fields each kind stores. */
const MATERIAL: Record<string, string[]> = {
  FIREARM_LICENCE: [
    'licence_number',
    'holder_name',
    'firearm_type',
    'make',
    'calibre',
    'frame_serial',
    'barrel_serial',
    'section',
  ],
  COMPETENCY_CERTIFICATE: [
    'competency_number',
    'holder_name',
    'covers',
    'competency_issued',
  ],
  PROFICIENCY: ['certificate_number', 'holder_name', 'unit_standard'],
  IDENTITY_DOCUMENT: ['full_name', 'id_number', 'issue_date'],
};

const read = (doc: string, kind: keyof typeof MATERIAL) =>
  extractDocument(fx(doc), kind as never, MATERIAL[kind]);

describe('firearm licence', () => {
  it('reads the whole card', () => {
    const r = read('doc03', 'FIREARM_LICENCE');
    expect(r.reading.details).toMatchObject({
      make: 'HOWA',
      calibre: '6.5MM CREEDMOOR',
      frame_serial: 'B477423',
      barrel_serial: 'B477423',
      section: '15',
      holder_name: 'GJP FOURIE',
      firearm_type: 'MANUALLY OPERATED RIFLE',
    });
  });

  it('takes the validity range off the line, where FORMS never sees it', () => {
    const r = read('doc03', 'FIREARM_LICENCE');
    expect(r.reading.issuedOn).toBe('2022-11-29');
    expect(r.reading.expiresOn).toBe('2032-11-28');
  });

  // 🚨 THE TRAP. Every licence carries 3086 or 3088 in a spot that looks like
  // a reference number. It is the section code — 3086 on the section 15, 3088
  // on all six section 16s — so reading it as a licence number would give six
  // different firearms the same number, and put that number on an application.
  it('never mistakes the section code for a licence number', () => {
    for (const doc of ['doc03', 'doc04', 'doc05', 'doc08']) {
      const r = read(doc, 'FIREARM_LICENCE');
      expect(r.reading.details.licence_number).toBeUndefined();
      expect(r.reading.details.section).not.toBe('3086');
      expect(r.reading.details.section).not.toBe('3088');
    }
  });

  it('reads a self-loading type without flattening it', () => {
    const r = read('doc08', 'FIREARM_LICENCE');
    expect(r.reading.details.firearm_type).toMatch(/S\/L/);
    expect(r.reading.details.make).toBe('NORDISKE PRECISION');
  });

  it('a clean licence auto-fills', () => {
    expect(read('doc03', 'FIREARM_LICENCE').autoFillable).toBe(true);
  });
});

describe('competency certificate', () => {
  it('reads the number and the endorsement block', () => {
    const r = read('doc12', 'COMPETENCY_CERTIFICATE');
    expect(r.reading.details.competency_number).toBe('C7276902');
    expect(r.reading.details.covers).toMatch(/HANDGUN/);
    expect(r.reading.details.holder_name).toBe('GJP FOURIE');
  });

  // Reference §4.8.2: "There is no expiry date field. Not blank — absent."
  // A confirmed expiry arms the reminder sweep, so inventing one here starts
  // SMSing members about a certificate that cannot lapse. Its real expiry is
  // DERIVED from the licences it covers.
  it('never produces an expiry', () => {
    for (const doc of ['doc12', 'doc13', 'doc15']) {
      expect(read(doc, 'COMPETENCY_CERTIFICATE').reading.expiresOn).toBeNull();
    }
  });

  // The boxed date came back as seven digits where a date needs eight — one
  // was lost. Every repair is plausible and the rubber stamp says something
  // else again, so it goes to the member rather than being guessed.
  it('refuses to invent the issue date, and will not auto-fill without it', () => {
    const r = read('doc12', 'COMPETENCY_CERTIFICATE');
    expect(r.reading.issuedOn).toBeNull();
    expect(r.autoFillable).toBe(false);
  });

  // The same 14-digit corruption the KYC extractor was built for, hit again
  // on this document family: the left border of the first box reads as a
  // leading digit. Shared rule, so the two modules cannot drift.
  it('repairs a 14-digit ID and records that it did', () => {
    const r = read('doc15', 'COMPETENCY_CERTIFICATE');
    expect(r.reading.details.id_number).toBe('8905125220089');
    expect(r.notes.join(' ')).toMatch(/dropped a leading "1"/);
  });

  it('holds the poor scan back', () => {
    const r = read('doc15', 'COMPETENCY_CERTIFICATE');
    expect(r.autoFillable).toBe(false);
    expect(r.reading.lowConfidence.length).toBeGreaterThan(0);
  });
});

describe('identity document', () => {
  it('joins the surname and the forenames', () => {
    const r = read('doc18', 'IDENTITY_DOCUMENT');
    expect(r.reading.details.full_name).toBe('GERHARD JOHAN PETRUS FOURIE');
  });

  it('normalises the ID to thirteen digits however it was printed', () => {
    expect(read('doc18', 'IDENTITY_DOCUMENT').reading.details.id_number).toBe(
      '8905125220089',
    );
    // The competency spaces it: `890512 5220 089`. Same person, same value.
    expect(
      read('doc12', 'COMPETENCY_CERTIFICATE').reading.details.id_number,
    ).toBe('8905125220089');
  });
});

describe('nothing is thrown away', () => {
  // Operator: "I want to extract all fields and keep them for future use."
  // The canonical fields drive the columns; `raw` is everything else the page
  // carried, which the Claude extractor's allow-list used to discard.
  it('keeps every pair the page carried, beyond the ones we map', () => {
    const r = read('doc02', 'PROFICIENCY');
    expect(Object.keys(r.raw).length).toBeGreaterThan(
      Object.keys(r.reading.details).length,
    );
    expect(r.raw).toHaveProperty('SAPS Accreditation Number:');
  });
});
