import { MotivationLicenceType } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { Saps271Service } from './saps271.service';
import { buildSaps271 } from './saps271-map';
import { SAPS271_COORDS, Saps271FieldName } from './saps271-coords';

// The mapping is tested separately and purely. What this file has to prove is
// that the bytes come out RIGHT: values on the correct page, nothing reaching a
// signature or an official-use box, and a document that opens.
//
// Values are DRAWN, not set into form fields — the operator's fillable template
// shares field names across up to twelve boxes, so setting one would paint the
// same text in eleven other places (see saps271.service.ts). That means the
// check is text extraction from the produced PDF, not field readback.

const ANSWERS: Record<string, string> = {
  full_name: 'Jan Pieter van der Merwe',
  id_number: '8001015009087',
  residential_address: '12 Kerk Street, Universitas, Bloemfontein',
  residence_type: 'House',
  occupation: 'Farm manager',
  firearm_type: 'Rifle',
  firearm_action: 'Bolt action',
  firearm_make: 'Tikka',
  firearm_model: 'T3x Lite',
  firearm_calibre: '.308 Winchester',
  firearm_serial: 'AB123456',
  competency_number: 'C1234567',
  competency_issued: '2024-03-15',
  marital_status: 'Married',
  spouse_name: 'Anna van der Merwe',
  spouse_id_number: '8203020082088',
  safe_present: 'Yes',
  safe_type: 'Rifle safe',
  safe_mounted: 'Yes',
  safe_mounted_to: 'Wall',
  history_conviction: 'No',
  history_pending_case: 'No',
  history_lost_stolen: 'No',
  history_declared_unfit: 'No',
  history_confiscated: 'No',
  existing_firearm_1_type: 'Rifle',
  existing_firearm_1_calibre: '.22 LR',
  existing_firearm_1_make: 'CZ',
  existing_firearm_1_licence_no: 'L998877',
};

const AS_AT = new Date(Date.UTC(2026, 7, 19));

const svc = new Saps271Service();

async function fill(overrides: Record<string, string> = {}) {
  return svc.build({
    licenceType: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
    answers: { ...ANSWERS, ...overrides },
    email: 'jan@example.co.za',
    motivationReference: 'MO-000123',
    asAt: AS_AT,
  });
}

/**
 * How many bytes of drawing instructions each page carries.
 *
 * pdfjs cannot be loaded here — its ESM build throws "Cannot use import.meta
 * outside a module" under Jest's CJS runtime, the same wall the pdf-parse
 * attempt hit. Text extraction is not actually what these assertions need
 * though: comparing each page's decoded content stream against the BLANK form
 * says exactly which pages were drawn on, which is the property that matters.
 * A value on the wrong page is the failure that renders perfectly and is wrong.
 */
async function pageContentSizes(buf: Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPages().map((page) => {
    const c = page.node.Contents();
    if (!c) return 0;
    const streams =
      c instanceof PDFArray
        ? c.asArray().map((r) => doc.context.lookup(r))
        : [c];
    let n = 0;
    for (const st of streams) {
      if (!st) continue;
      try {
        n += decodePDFRawStream(st as never).decode().length;
      } catch {
        /* an opaque stream contributes nothing, and never changes either */
      }
    }
    return n;
  });
}

/** Which pages this service actually drew on. 1-based. */
async function pagesDrawnOn(pdf: Buffer): Promise<number[]> {
  const before = await pageContentSizes(readFileSync(BLANK));
  const after = await pageContentSizes(pdf);
  return after
    .map((n, i) => (n !== before[i] ? i + 1 : 0))
    .filter((p) => p > 0);
}

const BLANK = 'assets/saps271-blank.pdf';

/** The pure mapping, which most of these assertions are really about. */
const map = (overrides: Record<string, string> = {}) =>
  buildSaps271({
    licenceType: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
    answers: { ...ANSWERS, ...overrides },
    email: 'jan@example.co.za',
    motivationReference: 'MO-000123',
    asAt: AS_AT,
  });

describe('a filled SAPS 271', () => {
  it('produces a valid 12-page PDF', async () => {
    const { pdf } = await fill();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
    expect(doc.getPageCount()).toBe(12);
  });

  it('draws only on the applicant pages', async () => {
    // Pages 1 and 10-12 belong to the police station, the CFR and the DFO. A
    // value landing there renders perfectly and is a mark on someone else's
    // section of an official form.
    const drawn = await pagesDrawnOn((await fill()).pdf);
    expect(drawn.length).toBeGreaterThan(0);
    for (const page of drawn) expect([2, 5, 6, 7, 8, 9]).toContain(page);
  });

  it('reaches every section it is supposed to', async () => {
    // section D+E (2), firearms owned (5), the applicant (6), spouse and the
    // motivation reference (7), history (8).
    const drawn = await pagesDrawnOn((await fill()).pdf);
    for (const page of [2, 5, 6, 7, 8]) expect(drawn).toContain(page);
  });

  it('puts a rifle serial on the RECEIVER line, not the frame', () => {
    // The frame is the firearm on a handgun, the receiver on everything else.
    const v = map();
    expect(v.text.e_receiver_serial).toBe('AB123456');
    expect(v.text.e_frame_serial).toBeUndefined();
  });

  it('puts a handgun serial on the FRAME line', () => {
    const v = map({ firearm_type: 'Handgun' });
    expect(v.text.e_frame_serial).toBe('AB123456');
    expect(v.text.e_receiver_serial).toBeUndefined();
  });

  it('splits the name the way the form asks for it', () => {
    const v = map();
    // "van der Merwe" is the surname — not "Merwe".
    expect(v.text.g_surname).toBe('van der Merwe');
    expect(v.text.g_full_names).toBe('Jan Pieter');
    expect(v.text.g_initials).toBe('JP');
  });

  it('derives date of birth and age from the ID rather than asking', () => {
    const v = map();
    expect(v.text.g_date_of_birth).toBe('01011980');
    expect(v.text.g_age).toBe('46');
    expect(v.text.g_id_number).toBe('8001015009087');
  });

  it('fills the firearms-already-owned table', () => {
    const v = map();
    expect(v.text.g_owned_1_calibre).toBe('.22 LR');
    expect(v.text.g_owned_1_make).toBe('CZ');
    expect(v.text.g_owned_1_licence).toBe('L998877');
    expect(v.text.g_owned_2_calibre).toBeUndefined();
  });

  it('references the attached motivation instead of writing it into the box', () => {
    const v = map();
    expect(v.text.g_motivation_reference).toContain('MO-000123');
    expect(v.text.g_motivation_reference).toMatch(/attached motivation/i);
  });

  it('marks the boxes it is meant to mark', () => {
    expect(map().ticks).toEqual(
      expect.arrayContaining([
        'd_section_15',
        'e_type_rifle',
        'e_action_manual',
        'safe_yes',
        'safe_mounted_wall',
        'h_conviction_no',
        'h_confiscated_no',
      ]),
    );
  });

  it('converts a date into the digits the cells expect', () => {
    expect(map({ competency_issued: '2024-03-15' }).text.g_competency_issued).toBe(
      '15032024',
    );
    expect(map({ competency_issued: '15/03/2024' }).text.g_competency_issued).toBe(
      '15032024',
    );
    // Anything it cannot read is left alone rather than written into the wrong
    // cells, where it would read as a different date entirely.
    expect(map({ competency_issued: 'last March' }).text.g_competency_issued)
      .toBeUndefined();
  });
});

describe('gender, which the form gives nowhere to mark', () => {
  it('rings the word rather than stamping an X across it', async () => {
    // The form prints "Male" and "Female" in adjacent cells with no empty box
    // between them, so an X would land on a word and make both unreadable. It
    // is circled instead — what a person does on a form with no tick box.
    const spec = SAPS271_COORDS.g_gender_male as { overLabel?: boolean };
    expect(spec.overLabel).toBe(true);
    const { leftBlank } = await fill();
    expect(leftBlank.map((b) => b.field)).not.toContain('Gender');
    expect(map().ticks).toContain('g_gender_male');
  });

  it('says so when the ID cannot be read', () => {
    const v = map({ id_number: 'not an id' });
    expect(v.ticks).not.toContain('g_gender_male');
    expect(v.ticks).not.toContain('g_gender_female');
    expect(v.leftBlank.map((b) => b.field)).toContain('Gender');
  });
});

describe('what it must never touch', () => {
  it('has no box on an official-use page at all', () => {
    for (const spec of Object.values(SAPS271_COORDS) as { page: number }[]) {
      expect([1, 10, 11, 12]).not.toContain(spec.page);
    }
  });

  it('never writes a signature or a date of signing', () => {
    // The operator's own guidance: a SAPS form is signed in front of the DFO.
    const names = Object.keys(SAPS271_COORDS).join(' ');
    expect(names).not.toMatch(/signature|signed|date_of_sign/i);
  });

  it('refuses to produce a 271 for a section 24 renewal', async () => {
    // Section D lists sections 13 to 20. A renewal is a different form, and
    // producing this one sends someone to a station with the wrong paperwork.
    await expect(
      svc.build({
        licenceType: MotivationLicenceType.S24_RENEWAL,
        answers: ANSWERS,
        asAt: AS_AT,
      }),
    ).rejects.toThrow(/renewal uses a different form/i);
  });
});

describe('when something cannot be filled', () => {
  it('says which boxes are left for the applicant', async () => {
    const { leftBlank } = await fill({ history_conviction: '' });
    expect(leftBlank.map((b) => b.field)).toContain('history_conviction');
    expect(leftBlank[0].because).toBeTruthy();
  });

  it('leaves marital status blank rather than guess widow or widower', () => {
    // The form separates them by gender. With no readable ID there is no
    // ungendered box, and writing the wrong one is a false statement about a
    // person on a form they sign.
    const v = map({ marital_status: 'Widowed', id_number: 'unknown' });
    expect(v.ticks).not.toContain('g_marital_widow');
    expect(v.ticks).not.toContain('g_marital_widower');
    expect(v.leftBlank.map((b) => b.field)).toContain('Marital status');
  });

  it('does not fall over on an empty application', async () => {
    const { pdf, leftBlank } = await svc.build({
      licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
      answers: {},
      asAt: AS_AT,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(leftBlank.length).toBeGreaterThan(3);
  });

  it('never writes Automatic, which is not licensable to a private person', () => {
    for (const action of [
      'Self-loading (semi-automatic)',
      'Bolt action',
      'Revolver',
      'Pump action',
    ]) {
      const marked = map({ firearm_action: action }).ticks.filter((t) =>
        t.startsWith('e_action_'),
      );
      expect(marked).toHaveLength(1);
      expect(marked[0]).toBe(
        action === 'Self-loading (semi-automatic)'
          ? 'e_action_semi_auto'
          : 'e_action_manual',
      );
    }
  });
});
