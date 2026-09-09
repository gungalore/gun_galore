import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MotivationPdfService } from './motivation-pdf.service';

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
  idNumber: '8501015800081',
  licenceTypeLabel: 'Section 16 — Dedicated Hunter',
  body: '1. Introduction\n\nI am applying under section 16.\n\n9. Safe storage and transport\n\nA SABS safe.',
  disclaimer: 'Prepared with assistance.',
  templateVersion: 'tpl-test',
  generatedAt: new Date('2026-08-24T08:00:00Z'),
  firearmLine: 'Cezka Zbrojovka (CZ) Handgun, serial 81815',
};

jest.setTimeout(120000);

// ────────────────────────────────────────────────────────────────────
// THE FOOTER NAMES THE APPLICANT AND NOBODY ELSE.
//
// ⚠️ THIS FILE USED TO ASSERT THE OPPOSITE, AND THE REVERSAL IS AN OPERATOR
// DECISION OVERTAKING AN EARLIER OPERATOR DECISION.
//
// Operator, 2026-08-24: "add ALLOUTDOORS logo on the footer of each page and
// say Prepared by All Outdoor." MOTIVATION-GUIDE-BOOK Part 1 rule 2, decided
// 2026-09-09: "First person, applicant's voice, no service name anywhere in
// the lodged pack. No 'prepared by', no footer brand, no 'we'. The applicant
// signs it as their own letter." Failure mode 20 is the same point from the
// other end — a letter that says "I prepared this" carrying somebody else's
// name in every footer contradicts itself on every page, in front of the
// official deciding whether to believe it.
//
// What Part 7.1 puts there instead: the applicant's full names, ID number, the
// motivation line, "Page n of N", and an "Initial: ____" rule so the applicant
// initials each page — which is what stops a page being added to or taken out
// of a bound submission after it was signed.
// ────────────────────────────────────────────────────────────────────

describe('the footer identifies the application, not the service', () => {
  it('⚠️ NAMES ALL OUTDOOR ON NO PAGE AT ALL', async () => {
    const out = await new MotivationPdfService().render(input as never);
    const ps = pages(out.pdf);
    expect(ps.length).toBeGreaterThan(1);
    for (const p of ps) {
      expect(p).not.toMatch(/PREPARED BY/i);
      expect(p).not.toMatch(/ALL OUTDOOR/i);
    }
  });

  it('carries the applicant, the ID number and the page number on every page', async () => {
    const out = await new MotivationPdfService().render(input as never);
    const ps = pages(out.pdf);
    for (let i = 0; i < ps.length; i++) {
      expect(ps[i]).toMatch(/GERHARD FOURIE/i);
      expect(ps[i]).toMatch(new RegExp('PAGE ' + (i + 1) + ' OF ' + ps.length, 'i'));
    }
  });

  it('gives every page an initial line', async () => {
    // Part 7.1, and the Engala packs. Without it a page can be swapped into a
    // bound submission after the applicant signed the last one.
    const out = await new MotivationPdfService().render(input as never);
    for (const p of pages(out.pdf)) expect(p).toMatch(/INITIAL:/i);
  });

  it('⚠️ KEEPS OUR REFERENCE OFF THE FOOTER', async () => {
    // Part 7.1 enumerates the footer and the MO number is not in it — it means
    // nothing to a DFO. It survives in the PDF's Title metadata and in the
    // download filename, which is where an operator looks for it.
    const out = await new MotivationPdfService().render(input as never);
    for (const p of pages(out.pdf).slice(1)) expect(p).not.toContain('MO000123');
    expect(out.filename).toContain('MO000123');
  });

  it('does not let a long firearm line push the applicant off the strip', async () => {
    // The line is fitted against what is LEFT after the initial block, and
    // sheds from the tail. The applicant and the page number never shed.
    const out = await new MotivationPdfService().render({
      ...input,
      firearmLine:
        'Ceska Zbrojovka (CZ) Model 557 Eclipse Bolt Action Rifle, serial 81815-ABCDEF',
    } as never);
    for (const p of pages(out.pdf)) {
      expect(p).toMatch(/GERHARD FOURIE/i);
      expect(p).toMatch(/INITIAL:/i);
    }
  });
});
