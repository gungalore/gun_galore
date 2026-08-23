import PDFDocument from 'pdfkit';
import * as K from './motivation-pdf-chrome';
import { renderStatementForm } from './motivation-pdf-form';
import { consentFormFor } from './motivation-consent-statement';
import { SCHEMES } from './motivation-pdf.service';
import type { FirearmSnapshot } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// ONE A4 PAGE. Operator, 2026-08-23: "Everything on one page."
//
// ⚠️ THIS IS THE TEST THAT BREAKS WHEN SOMEBODY ADDS A ROW. The sheet carries
// a declaration, up to twelve card particulars, two photographs at 92.5mm and
// a signature block, and renderStatementForm scales the whole thing to fit
// rather than spilling — but only down to MIN_SCALE. Past that it silently
// becomes two pages, and a consent whose signature is overleaf is a consent
// whose signature does not obviously govern the particulars.
//
// It renders a REAL PDF rather than measuring, because measuring is the thing
// that would be wrong.
// ────────────────────────────────────────────────────────────────────

/** A real, minimal JPEG. Enough that pdfkit embeds rather than throws. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/** The fullest card of the operator's five — every row populated. */
const FULLEST: FirearmSnapshot = {
  unlabelledNumber: '3086',
  section: 'SECTION 15',
  make: 'HOWA',
  model: 'NONE',
  type: 'MANUALLY OPERATED RIFLE',
  calibre: '6.5MM CREEDMOOR',
  serial: 'B477423',
  barrelSerial: 'B477423',
  barrelMake: 'HOWA',
  receiverSerial: 'B477423',
  receiverMake: 'HOWA',
  frameSerial: 'B477423',
  frameMake: 'HOWA',
  applicantName: 'A Buyer With A Rather Long Name Indeed',
  applicantIdNumber: '9001015800086',
};

function pagesFor(firearm: FirearmSnapshot, sellerFullName: string): number {
  const form = consentFormFor(
    {
      sellerFullName,
      sellerIdNumber: '8905125220089',
      sellerPhone: '+27743039999',
      firearm,
      signedPlace: 'Bloemfontein, Free State',
      signedAt: new Date('2026-08-23T10:00:00Z'),
    },
    { signature: JPEG, front: JPEG, back: JPEG },
  );

  const doc = new PDFDocument({
    size: [K.PAGE_W, K.PAGE_H],
    autoFirstPage: false,
    bufferPages: true,
  });
  // Swallow the stream: we want the page count, not the bytes.
  doc.on('data', () => undefined);
  const chrome: K.Chrome = {
    doc,
    c: Object.values(SCHEMES)[0],
    f: K.faces(K.registerFonts(doc)),
  };
  renderStatementForm(chrome, form);
  const pages = doc.bufferedPageRange().count;
  doc.end();
  return pages;
}

describe('the consent prints on one page', () => {
  it('fits the fullest card, both photographs and a signature', () => {
    expect(pagesFor(FULLEST, 'Gerhard Johan Petrus Fourie')).toBe(1);
  });

  it('still fits when every string is long', () => {
    // Nothing on this sheet is free text the seller can run away with, but the
    // names are theirs and a card's type string can be verbose. If this ever
    // spills, the fix is the layout — never truncating what somebody signed.
    expect(
      pagesFor(
        {
          ...FULLEST,
          type: 'S/L: RIFLE  CAL - RIFLE/CARBINE, SEMI-AUTOMATIC, CENTREFIRE',
          make: 'A VERY LONG MANUFACTURER NAME INDEED PROPRIETARY LIMITED',
          receiverMake: 'A VERY LONG MANUFACTURER NAME INDEED PROPRIETARY LIMITED',
          barrelMake: 'A VERY LONG MANUFACTURER NAME INDEED PROPRIETARY LIMITED',
        },
        'Johannes Christiaan Hendrik van der Merwe-Oosthuizen',
      ),
    ).toBe(1);
  });

  it('fits with no photographs at all', () => {
    // The images block is conditional — a consent signed before the
    // photographs uploaded must still render.
    const form = consentFormFor(
      {
        sellerFullName: 'G J P Fourie',
        sellerIdNumber: '8905125220089',
        sellerPhone: '+27743039999',
        firearm: FULLEST,
        signedPlace: null,
        signedAt: null,
      },
      { signature: null, front: null, back: null },
    );
    expect(form.blocks.some((b) => b.kind === 'images')).toBe(false);

    const doc = new PDFDocument({
      size: [K.PAGE_W, K.PAGE_H],
      autoFirstPage: false,
      bufferPages: true,
    });
    doc.on('data', () => undefined);
    renderStatementForm(
      { doc, c: Object.values(SCHEMES)[0], f: K.faces(K.registerFonts(doc)) },
      form,
    );
    expect(doc.bufferedPageRange().count).toBe(1);
    doc.end();
  });
});
