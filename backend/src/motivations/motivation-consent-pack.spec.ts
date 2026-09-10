import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MotivationPdfService } from './motivation-pdf.service';
import { consentFormFor } from './motivation-consent-statement';
import { buildAnnexures } from './motivation-checklist';

// ⚠️ THE CONSENT SHEET WAS BUILT BY A FUNCTION NOTHING CALLED. The applicant's
// screen said it was in their pack; only the licence photographs were. This
// asserts against the RENDERED TEXT of a real PDF, because that is the only
// thing that would have caught it — the module compiled fine for weeks.
function pageTexts(pdf: Buffer): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consentpack-'));
  const f = path.join(dir, 'a.pdf');
  fs.writeFileSync(f, pdf);
  return execFileSync('pdftotext', ['-layout', f, '-'], {
    encoding: 'latin1',
    maxBuffer: 64 << 20,
  }).split('\f');
}

const base = {
  referenceNumber: 'MO000123',
  applicantName: 'Gerhard Fourie',
  licenceTypeLabel: 'Section 16 — Dedicated Hunter',
  body: 'Introduction:\n\nI am applying under section 16.',
  disclaimer: 'Prepared with assistance.',
  templateVersion: 'tpl-test',
  generatedAt: new Date('2026-08-24T08:00:00Z'),
};

const consent = consentFormFor(
  {
    sellerFullName: 'Piet Verkoper',
    sellerIdNumber: '8001015009087',
    sellerPhone: '0743039999',
    firearm: {
      make: 'HOWA',
      model: 'NONE',
      calibre: '6.5MM CREEDMOOR',
      serial: 'B477423',
      section: 'SECTION 15',
      applicantName: 'Gerhard Fourie',
    } as never,
    signedPlace: 'Kraaifontein, Western Cape',
    signedAt: new Date('2026-08-24T06:38:00Z'),
  },
  { signature: null, front: null, back: null },
);

jest.setTimeout(120000);

describe('the previous owner’s consent reaches the pack', () => {
  it('⚠️ prints the declaration, the firearm and the signatory', async () => {
    const out = await new MotivationPdfService().render({
      ...base,
      sellerConsent: consent,
    } as never);
    const all = pageTexts(out.pdf).join('\n');
    expect(all).toMatch(/consent/i);
    expect(all).toContain('Piet Verkoper');
    expect(all).toContain('HOWA');
    expect(all).toContain('B477423');
    // The card's own NONE is printed, not tidied away.
    expect(all).toContain('NONE');
  });

  it('⚠️ IS AN ANNEXURE, AND IS LETTERED AND CAPTIONED AS ONE', async () => {
    /**
     * Operator, 2026-09-10, wrote "Annexure" across this page on a rendered
     * pack. It used to print before the annexure index with a line of its own
     * in the CONTENTS — the treatment for a page we generate for the
     * applicant, which this is not. It is a third party's signed statement
     * about a firearm.
     *
     * ⚠️ SO IT IS NO LONGER IN THE CONTENTS. If that assertion comes back
     * somebody has given it two homes, and a reviewer following the index will
     * be sent to the wrong sheet.
     */
    const annexures = buildAnnexures(['IDENTITY_DOCUMENT'], ['SELLER_CONSENT']);
    const out = await new MotivationPdfService().render({
      ...base,
      sellerConsent: consent,
      annexures,
    } as never);
    const pages = pageTexts(out.pdf);

    const entry = annexures.find((a) => a.kind === 'SELLER_CONSENT')!;
    expect(entry.label).toMatch(/previous owner/i);

    // Captioned on the page it starts on, like every other annexure.
    const captioned = pages.some((pg) =>
      pg.includes('Annexure ' + entry.letter + ' '),
    );
    expect(captioned).toBe(true);

    // And gone from the contents.
    const contents = pages.find((pg) => /CONTENTS/i.test(pg)) ?? '';
    expect(contents).not.toMatch(/PREVIOUS OWNER/i);
  });

  it('costs a pack with no consent nothing at all', async () => {
    const withOut = await new MotivationPdfService().render({ ...base } as never);
    const withIt = await new MotivationPdfService().render({
      ...base,
      sellerConsent: consent,
    } as never);
    expect(pageTexts(withIt.pdf).length).toBeGreaterThan(
      pageTexts(withOut.pdf).length,
    );
  });
});
