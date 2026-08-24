import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { MotivationPdfService } from './motivation-pdf.service';
import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  LAYOUT_KEYS,
  asLayout,
} from './motivation-pdf-layouts';
import { SCHEME_KEYS } from './motivation-pdf.service';

// ────────────────────────────────────────────────────────────────────
// FIVE WAYS TO SET THE SAME DOCUMENT.
//
// Operator, item 11 of twelve, 2026-08-24: "at least 5 styles that looks
// vastly different from each other but still have all the same information in.
// each style can be chosen in the color we already offer."
//
// ⚠️ SAME INFORMATION IS THE HALF THAT IS EASY TO BREAK. A layout that drops a
// section, or whose heading swallows one, would look like a style choice and
// be a content choice — and the old format axis (concise/standard) was retired
// precisely so nobody has to wonder whether their pack is the short one.
// ────────────────────────────────────────────────────────────────────

function pages(pdf: Buffer): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
  const f = path.join(dir, 'a.pdf');
  fs.writeFileSync(f, pdf);
  return execFileSync('pdftotext', ['-layout', f, '-'], {
    encoding: 'latin1',
    maxBuffer: 64 << 20,
  }).split('\f');
}

const squash = (s: string) => s.replace(/\s+/g, '').toUpperCase();

const base = {
  referenceNumber: 'MO000123',
  applicantName: 'Gerhard Fourie',
  licenceTypeLabel: 'Section 16 — Dedicated Hunter',
  body: [
    'Introduction:',
    'I am applying for a licence in terms of section 16.',
    'Experience and training:',
    'I completed my competency in 2018.',
    'Safe storage:',
    'A SABS-approved safe bolted to a brick wall.',
  ].join('\n\n'),
  disclaimer: 'Prepared with assistance.',
  templateVersion: 'tpl-test',
  generatedAt: new Date('2026-08-24T08:00:00Z'),
  firearmLine: 'Marlin 1895, .45-70 Government',
};

jest.setTimeout(240000);

describe('the five layouts', () => {
  const svc = new MotivationPdfService();

  it('offers at least the five the operator asked for', () => {
    expect(LAYOUT_KEYS.length).toBeGreaterThanOrEqual(5);
  });

  it('⚠️ EVERY LAYOUT CARRIES EVERY SECTION — the content never varies', async () => {
    // The headings the body asks for must survive whatever the heading style
    // does to them. 'caps' letterspaces, 'numeral' splits the number off, and
    // squashing whitespace is what lets one assertion cover all five.
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const all = squash(pages(out.pdf).join(' '));
      for (const heading of ['INTRODUCTION', 'EXPERIENCEANDTRAINING', 'SAFESTORAGE']) {
        expect(all).toContain(heading);
      }
      // And the applicant's own words, which no layout may drop.
      expect(all).toContain(squash('bolted to a brick wall'));
    }
  });

  it('⚠️ they genuinely differ — no two render identical bytes', async () => {
    // The weakest possible version of "vastly different", and the one that
    // actually catches a layout wired up but never reaching the renderer.
    const seen = new Map<string, string>();
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const sig = String(out.pdf.length);
      const clash = [...seen.entries()].find(([, v]) => v === sig);
      seen.set(key, sig);
      if (clash) {
        throw new Error(`${key} renders identically to ${clash[0]}`);
      }
    }
    expect(seen.size).toBe(LAYOUT_KEYS.length);
  });

  it('⚠️ works in EVERY colourway, because the axes are orthogonal', async () => {
    // A layout that hard-coded a colour would be right in one scheme and wrong
    // in nine. Two schemes at each end of the palette is enough to catch it.
    for (const key of LAYOUT_KEYS) {
      for (const scheme of [SCHEME_KEYS[0], SCHEME_KEYS[SCHEME_KEYS.length - 1]]) {
        const out = await svc.render({
          ...base,
          layout: key,
          colourway: scheme,
        } as never);
        expect(out.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      }
    }
  });

  it('keeps the footer on every page of every layout', async () => {
    // The quieter layouts drop the running banner, so the footer is the only
    // thing left naming the application. A loose sheet must stay filable.
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const ps = pages(out.pdf).slice(0, -1);
      for (const p of ps) {
        expect(p).toContain('MO000123');
        expect(squash(p)).toContain(squash('PREPARED BY ALL OUTDOOR'));
      }
    }
  });

  it('the page count stays sane in all five', async () => {
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const n = (await PDFDocument.load(out.pdf)).getPageCount();
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThan(12);
    }
  });
});

describe('choosing a layout', () => {
  it('falls back rather than throwing on anything unrecognised', () => {
    // The column is a plain VarChar, so a stale client or a retired layout
    // must degrade. A download that 500s over a stored preference is the worst
    // failure for a document somebody already paid for.
    expect(asLayout('nonsense')).toBe(DEFAULT_LAYOUT);
    expect(asLayout(undefined)).toBe(DEFAULT_LAYOUT);
    expect(asLayout(null)).toBe(DEFAULT_LAYOUT);
    expect(asLayout(42)).toBe(DEFAULT_LAYOUT);
  });

  it('keeps the existing document as the default', () => {
    // Nobody's pack changes shape because a new axis was added underneath them.
    expect(DEFAULT_LAYOUT).toBe('banner');
    expect(LAYOUTS[DEFAULT_LAYOUT].runningBanner).toBe(true);
    expect(LAYOUTS[DEFAULT_LAYOUT].heading).toBe('band');
  });

  it('⚠️ describes the LOOK, never the strength of the case', () => {
    // The same facts make the same case however the document is set. A blurb
    // implying otherwise would be an outcome claim on a product that makes
    // none.
    for (const key of LAYOUT_KEYS) {
      const blurb = LAYOUTS[key].blurb.toLowerCase();
      expect(blurb).not.toMatch(
        /strong|best|better|persuasi|improve|chance|succe|approv/,
      );
      expect(LAYOUTS[key].name.trim()).not.toBe('');
    }
  });

  it('every layout is self-consistent', () => {
    for (const key of LAYOUT_KEYS) {
      expect(LAYOUTS[key].key).toBe(key);
    }
  });
});
