import { MotivationLicenceType } from '@prisma/client';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Saps271Service } from './saps271.service';

// ────────────────────────────────────────────────────────────────────
// RENDER THE FORM AND READ IT BACK.
//
// Every other test here checks which BOX we decided to write. This one checks
// that the ink lands on the page the form prints that box on — the failure a
// coordinate map is actually capable of, and the one nothing else can see.
//
// ⚠️ A WRONG COORDINATE IS SILENT AND WORSE THAN A BLANK. Text half a
// centimetre into the next box still renders: it produces a form that looks
// filled and says something untrue, and the applicant carries it to a counter.
// So the values are drawn and then extracted back out of the PDF, and the
// assertion is which PAGE each one landed on.
//
// This does not replace a human looking at a printed copy before it goes near
// a DFO — see decision 5 in LICENCE-APPLICATION-REBUILD.md. It is the part
// that can be automated.
// ────────────────────────────────────────────────────────────────────

const require_ = createRequire(__filename);

// ⚠️ pdfjs-dist SHIPS ESM ONLY, and ts-jest compiles this file to CommonJS —
// which turns a plain `import()` into `require()` and fails on the .mjs. The
// Function constructor keeps a real dynamic import out of TypeScript's reach.
// The measure script has the same import for the same reason; it is a script,
// so it can simply be ESM.
const esmImport = new Function('u', 'return import(u)') as (
  u: string,
) => Promise<{ getDocument: (a: unknown) => { promise: Promise<any> } }>;

/** Text on each page of a rendered PDF, in reading order. */
async function pageText(pdf: Buffer): Promise<string[]> {
  const { getDocument } = await esmImport(
    pathToFileURL(require_.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,
  );
  const doc = await getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    out.push(
      (tc.items as { str?: string }[])
        .map((i) => i.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' '),
    );
  }
  return out;
}

describe('the filled form', () => {
  const svc = new Saps271Service();

  const INPUT = {
    licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
    answers: {
      full_name: 'Gerhard Fourie',
      firearm_type: 'Rifle',
      firearm_make: 'MARLIN',
      firearm_calibre: '.45-70 Government',
      barrel_serial: 'NONE',
      barrel_make: 'NONE',
      frame_serial: 'NONE',
      frame_make: 'NONE',
      receiver_serial: 'MR90189D',
      receiver_make: 'MARLIN',
      // Stated, never implied: the map ticks item 1.2 from THIS answer alone.
      firearm_source: 'From a private owner',
      safe_present: 'Yes',
      safe_type: 'Rifle safe',
      safe_mounted: 'Yes',
      safe_mounted_to: 'Wall',
      association_name: 'SAHGCA',
      association_number: '108828',
      // ⚠️ THE "DATE JOINED" BOX IS FED BY `association_joined`, NOT BY
      // `dedicated_since`. This fixture used to carry only the second, and the
      // assertion below duly saw 20190401 land in item 59 — because the map
      // reached for the field labelled "Dedicated status held since" to answer
      // a box printed "Date joined". They are different facts and for most
      // members different years: you join, and then you qualify. Both are kept
      // here, with different dates, so the render test can prove the JOIN date
      // is what reaches the box.
      association_joined: '2019-04-01',
      dedicated_since: '2022-08-15',
      association_expiry: '2027-03-31',
    },
    safeAnnexureLetter: 'F',
    seller: {
      fullName: 'Petrus Johannes Malan',
      idNumber: '7204125008087',
      residentialAddress: '12 Kerkstraat, Bothaville',
      residentialPostalCode: '9660',
      cellphone: '0821112222',
      email: 'piet@example.co.za',
      firearmAddress: '12 Kerkstraat, Bothaville',
      firearmPostalCode: '9660',
      designation: 'Owner',
      place: 'Bothaville',
    },
  };

  let pages: string[];

  beforeAll(async () => {
    const { pdf } = await svc.build(INPUT);
    pages = await pageText(pdf);
  }, 60_000);

  it('renders all twelve pages', () => {
    expect(pages).toHaveLength(12);
  });

  it('puts the firearm on page 2, where section E is printed', () => {
    // 1-indexed page 2 is index 1.
    expect(pages[1]).toContain('MARLIN');
    expect(pages[1]).toContain('MR90189D');
    expect(pages[1]).toContain('.45-70 Government');
  });

  it('puts the current owner’s particulars on page 3, where type A is printed', () => {
    // ⚠️ THE WHOLE POINT OF THE PHASE. Section F had no coordinates, so none
    // of this could reach the paper at all.
    expect(pages[2]).toContain('Petrus Johannes Malan');
    expect(pages[2]).toContain('12 Kerkstraat, Bothaville');
    expect(pages[2]).toContain('piet@example.co.za');
    expect(pages[2]).toContain('0821112222');
  });

  it('answers both "submit full details" boxes on page 9', () => {
    // Items 68.1 and 69.1 asked for details in as many words and got a blank
    // band back until now. The ink has to land on page 9 — the page the safe
    // questions are printed on — and nowhere else.
    const pointer = 'See Annexure F (photographs of the safe)';
    expect(pages[8]).toContain(pointer);
    // Twice: once beside the type of safe, once beside the mounting.
    expect(pages[8].split(pointer).length - 1).toBe(2);
    const strays = pages
      .map((t, i) => ({ page: i + 1, t }))
      .filter(({ page, t }) => page !== 9 && t.includes('Annexure F'));
    expect(strays.map((x) => x.page)).toEqual([]);
  });

  it('dates the association on page 7, from the letter of good standing', () => {
    // Item 60. The registry never had the field, so the box went to the DFO
    // blank while the date sat in the applicant's own vault.
    expect(pages[6]).toContain('SAHGCA');
    expect(pages[6]).toContain('108828');
    // YYYYMMDD, one digit per printed cell, so it reads back spaced.
    const flat = pages[6].replace(/\s/g, '');
    expect(flat).toContain('20270331');
    // Joined and expires are different dates in adjacent boxes; a single
    // date written into both would be a plausible-looking coordinate error.
    expect(flat).toContain('20190401');
    // ⚠️ AND THE DEDICATED-SINCE DATE REACHES NO BOX ON THIS FORM. It used to
    // reach this one. The 271 asks when the applicant JOINED; when the status
    // was awarded is a different question that the form does not ask and the
    // motivation annexure argues from.
    expect(flat).not.toContain('20220815');
  });

  it('leaves the estate declaration block on page 5 empty', () => {
    // ⚠️ ITEMS 79-87 BELONG TO TYPE E. Operator, 2026-08-28: on Type A "the
    // license will be in a living persons name and they will need to have it
    // in a safe at their house of residence according to law. So no need to
    // declare you are keeping it safe." His consent is captured on our own
    // signed annexure instead.
    expect(pages[4]).not.toContain('Petrus Johannes Malan');
    expect(pages[4]).not.toContain('Owner');
  });

  it('does not scatter the owner’s details onto pages that are not his', () => {
    // Section F lives on pages 2, 3 and 5. His name appearing on page 6 — the
    // APPLICANT's own particulars — would mean a coordinate pointing at the
    // wrong page, which is exactly the failure that looks like a filled form.
    const strays = pages
      .map((t, i) => ({ page: i + 1, t }))
      .filter(({ page, t }) => ![3, 5].includes(page) && t.includes('Petrus'));
    expect(strays.map((s) => s.page)).toEqual([]);
  });

  it('keeps the applicant and the owner apart', () => {
    // The applicant is on page 6. The owner must not be.
    expect(pages[5]).not.toContain('Petrus');
  });

  it('reports what it deliberately did not print', () => {
    // A signature is his to make in ink. The form says so and we say so.
    return svc.build(INPUT).then(({ leftBlank }) => {
      expect(leftBlank.map((b) => b.field)).toContain('f_signature');
      expect(leftBlank.map((b) => b.field)).toContain('f_surname');
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// THE OWNER-TYPE X, ON THE PAGE, IN THE RIGHT BOX.
//
// Item 1.2 is five 19.1pt tick cells on ONE printed row, 95.4pt apart. Every
// wrong answer here is a mark inside a box that means something else — "A.
// Private owner" on a dealer purchase — and a page-level assertion cannot see
// it, because all five are on the same page. So the X is located by its x
// coordinate, which is the only thing that distinguishes them.
// ────────────────────────────────────────────────────────────────────

/** Every drawn glyph on one page, with where it landed. */
async function marks(
  pdf: Buffer,
  page1Indexed: number,
): Promise<{ s: string; x: number; y: number }[]> {
  const { getDocument } = await esmImport(
    pathToFileURL(require_.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,
  );
  const doc = await getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  }).promise;
  const page = await doc.getPage(page1Indexed);
  const tc = await page.getTextContent();
  return (tc.items as { str?: string; transform?: number[] }[])
    .filter((i) => (i.str ?? '').trim())
    .map((i) => ({
      s: (i.str ?? '').trim(),
      x: Math.round((i.transform?.[4] ?? 0) * 10) / 10,
      y: Math.round((i.transform?.[5] ?? 0) * 10) / 10,
    }));
}

describe('the owner-type X lands in its own box', () => {
  const svc = new Saps271Service();

  /** The x of every X drawn on the item 1.2 row (y ≈ 76.1, ±6). */
  const routeMarks = async (firearm_source: string) => {
    const { pdf } = await svc.build({
      licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: { firearm_source },
      seller: { fullName: 'Petrus Johannes Malan', idNumber: '7204125008087' },
    });
    return (await marks(pdf, 2))
      .filter((m) => m.s === 'X' && Math.abs(m.y - 76.1) < 6)
      .map((m) => m.x)
      .sort((a, b) => a - b);
  };

  // The five measured cell centres, from saps271-coords.ts.
  const A = 169.3;
  const B = 264.7;

  it('puts exactly one X on the row, in box A, for a private sale', async () => {
    const xs = await routeMarks('From a private owner');
    expect(xs).toHaveLength(1);
    expect(Math.abs(xs[0] - A)).toBeLessThan(10);
  }, 60_000);

  it('puts it in box B — 95pt to the right — for a dealer purchase', async () => {
    // ⚠️ THE ASSERTION THE OLD CODE COULD NOT HAVE PASSED. It drew this X at
    // A on every route, so a dealer purchase said "private owner" in ink.
    const xs = await routeMarks('From a dealer');
    expect(xs).toHaveLength(1);
    expect(Math.abs(xs[0] - B)).toBeLessThan(10);
    expect(Math.abs(xs[0] - A)).toBeGreaterThan(50);
  }, 60_000);

  it('leaves the whole row blank when the route was not stated', async () => {
    const xs = await routeMarks('Not decided yet');
    expect(xs).toEqual([]);
  }, 60_000);
});

describe('all fourteen owned firearms reach the paper', () => {
  const svc = new Saps271Service();

  // ⚠️ THE COORDINATES FOR ROWS 7-14 DID NOT EXIST UNTIL 2026-09-07, and the
  // map looped to six anyway. Operator, 2026-09-07: "all fire arms the
  // applicant owns must be in that list." Rows 7 to 14 were collected from the
  // member's vault, stored, and printed nowhere.
  //
  // This is the one assertion that can prove they now land: the values are
  // drawn and read back out of the rendered PDF, so a coordinate measured onto
  // the wrong band — text half a centimetre into the next row, which looks
  // filled and says something untrue — cannot pass.
  let page5: { s: string; x: number; y: number }[];

  beforeAll(async () => {
    let answers: Record<string, string> = {};
    for (let n = 1; n <= 14; n++) {
      answers = {
        ...answers,
        [`existing_firearm_${n}_type`]: 'Rifle',
        [`existing_firearm_${n}_make`]: `MAKE${n}`,
        [`existing_firearm_${n}_serial`]: `SERIAL${n}`,
      };
    }
    const { pdf } = await svc.build({
      licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers,
    });
    page5 = await marks(pdf, 5);
  }, 60_000);

  it('prints every serial, on page 5', () => {
    const printed = page5.map((m) => m.s);
    for (let n = 1; n <= 14; n++) expect(printed).toContain(`SERIAL${n}`);
  });

  it('puts each serial on its own line, in order down the page', () => {
    // Fourteen distinct baselines, descending. Two rows sharing one would mean
    // a row measured onto its neighbour's band — the silent failure.
    const ys = Array.from({ length: 14 }, (_, i) => {
      const hit = page5.find((m) => m.s === `SERIAL${i + 1}`);
      expect(hit).toBeDefined();
      return hit!.y;
    });
    expect(new Set(ys).size).toBe(14);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
  });

  it('keeps each firearm’s make beside its own serial', () => {
    // The make and the serial of one firearm share a row; a row that drifted
    // would pair MAKE7 with SERIAL8 and read as a different firearm.
    for (let n = 1; n <= 14; n++) {
      const make = page5.find((m) => m.s === `MAKE${n}`);
      const serial = page5.find((m) => m.s === `SERIAL${n}`);
      expect(make).toBeDefined();
      expect(Math.abs(make!.y - serial!.y)).toBeLessThan(3);
      // Make is the third column, the frame/receiver serial the fifth.
      expect(make!.x).toBeLessThan(serial!.x);
    }
  });

  it('leaves the barrel column empty on every row', () => {
    // One answer must not become two assertions: we hold one serial and it
    // goes in the column that IS the firearm in law. Nothing is drawn in the
    // Barrel Serial No column, which the form rules from x 276.9 to ≈369.
    //
    // ⚠️ THE FRAME COLUMN'S OWN x MOVES BY A POINT HALFWAY DOWN THE TABLE
    // (373.3 for rows 1-8, 372.3 for rows 9-14). That is the paper, not a
    // rounding error — the measuring script reads the form's ruling lines, and
    // extrapolating a constant pitch from the first six rows would have
    // smoothed it away. So this asserts a COLUMN, never one exact x.
    const serialXs = page5
      .filter((m) => /^SERIAL\d+$/.test(m.s))
      .map((m) => m.x);
    expect(serialXs).toHaveLength(14);
    for (const x of serialXs) {
      expect(x).toBeGreaterThan(370);
      expect(x).toBeLessThan(465);
    }
  });
});
