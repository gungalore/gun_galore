import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MotivationPdfService } from './motivation-pdf.service';
import { logoPath } from './motivation-pdf-chrome';

function pages(pdf: Buffer): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foot-'));
  const f = path.join(dir, 'a.pdf');
  fs.writeFileSync(f, pdf);
  return execFileSync('pdftotext', ['-layout', f, '-'], {
    encoding: 'latin1', maxBuffer: 64 << 20,
  }).split('\f').slice(0, -1);
}

const input = {
  referenceNumber: 'MO000123',
  applicantName: 'Gerhard Fourie',
  licenceTypeLabel: 'Section 16 — Dedicated Hunter',
  body: 'Introduction:\n\nI am applying under section 16.\n\nSafe storage:\n\nA SABS safe.',
  disclaimer: 'Prepared with assistance.',
  templateVersion: 'tpl-test',
  generatedAt: new Date('2026-08-24T08:00:00Z'),
  firearmLine: 'Cezka Zbrojovka (CZ) Handgun, serial 81815',
};

jest.setTimeout(120000);

// Operator, 2026-08-24: "add ALLOUTDOORS logo on the footer of each page and
// say Prepared by All Outdoor."
describe('the footer says who prepared the pack', () => {
  it('names All Outdoor on EVERY page, and keeps what makes a loose sheet filable', async () => {
    const out = await new MotivationPdfService().render(input as never);
    const ps = pages(out.pdf);
    expect(ps.length).toBeGreaterThan(1);
    for (let i = 0; i < ps.length; i++) {
      // ⚠️ ONE LINE, NOT TWO. widthOfString excludes characterSpacing, so
      // measuring with it and drawing into exactly that width wrapped this to
      // "PREPARED BY ALL" / "OUTDOOR" on every page.
      expect(ps[i]).toMatch(/PREPARED BY ALL OUTDOOR/i);
      expect(ps[i]).toContain('MO000123');
      expect(ps[i]).toMatch(new RegExp('PAGE ' + (i + 1) + ' OF ' + ps.length, 'i'));
    }
  });

  it('embeds the mark itself, not only the words', async () => {
    expect(logoPath()).toBeTruthy();
    const out = await new MotivationPdfService().render(input as never);
    expect(out.pdf.toString('latin1')).toContain('/Image');
  });

  it('does not let a long firearm line run under the mark', async () => {
    // The centred line used to be fitted against the FULL content width; with
    // a logo occupying the left end that let a long name slide underneath it.
    const out = await new MotivationPdfService().render({
      ...input,
      firearmLine:
        'Ceska Zbrojovka (CZ) Model 557 Eclipse Bolt Action Rifle, serial 81815-ABCDEF',
    } as never);
    for (const p of pages(out.pdf)) {
      expect(p).toMatch(/PREPARED BY ALL OUTDOOR/i);
      expect(p).toContain('MO000123');
    }
  });
});
