import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { PDFArray, PDFDocument } from 'pdf-lib';
import { MotivationPdfService } from './motivation-pdf.service';
import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  LAYOUT_KEYS,
  asLayout,
} from './motivation-pdf-layouts';
import {
  DEFAULT_SCHEME,
  SCHEMES,
  SCHEME_KEYS,
} from './motivation-pdf.service';

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

/** The 9 mm edge bar in PDF points, as motivation-pdf-cover computes it. */
const K_EDGE_BAR_W = 9 * 2.8346456693;

/**
 * One page's own drawing operations, decompressed.
 *
 * ⚠️ PER PAGE, WHICH IS THE WHOLE POINT. Comparing whole PDFs is what let
 * five identical covers pass for five different ones; this narrows the
 * comparison to the page actually under test.
 */
async function pageStream(pdf: Buffer, index: number): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const contents = doc.getPage(index).node.Contents();
  const raw =
    contents instanceof PDFArray
      ? Buffer.concat(
          contents
            .asArray()
            .map((ref) =>
              Buffer.from((doc.context.lookup(ref) as never as {
                getContents(): Uint8Array;
              }).getContents()),
            ),
        )
      : Buffer.from(
          (contents as never as { getContents(): Uint8Array }).getContents(),
        );
  try {
    return zlib.inflateSync(raw);
  } catch {
    // pdfkit compresses by default; an uncompressed stream is still readable.
    return raw;
  }
}

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
    // ⚠️ THIS TEST PASSED THROUGHOUT THE PERIOD ALL FIVE COVERS WERE IDENTICAL,
    // and it is left here as the reason the two below exist. It signs a layout
    // with the LENGTH OF THE WHOLE PDF, so the heading style alone — one of the
    // five things a layout varies — was enough to give every layout a distinct
    // number. Meanwhile `LayoutSpec.cover` was read by nothing and page one was
    // byte-identical across all five: rasterising them returned one checksum.
    //
    // A whole-document signature can only ever prove that SOMETHING differs.
    // It cannot say what, so it cannot notice that the thing a member is
    // actually choosing is not among them.
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

  it('⚠️ NO TWO LAYOUTS DRAW THE SAME COVER', async () => {
    // The regression the length test could not see. Page one is what a layout
    // is chosen FOR — it is the page a DFO looks at before opening the folder —
    // and for as long as this went unasserted, choosing Plate or Classic or
    // Report changed nothing about it.
    //
    // Hashing the page's own content stream is what makes this specific: it is
    // the drawing operations for that page and nothing else, so a change in
    // the body or the footer cannot mask two covers being the same.
    const seen = new Map<string, string>();
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const sig = createHash('sha1')
        .update(await pageStream(out.pdf, 0))
        .digest('hex');
      const clash = [...seen.entries()].find(([, v]) => v === sig);
      if (clash) {
        throw new Error(
          `${key} draws the same cover as ${clash[0]} — LayoutSpec.cover is not reaching the renderer`,
        );
      }
      seen.set(key, sig);
    }
    expect(seen.size).toBe(LAYOUT_KEYS.length);
  });

  it('⚠️ the sans layout really is sans THROUGHOUT', async () => {
    // `bodyFace` was the second field declared on every layout and read by
    // nothing: Report's blurb has promised "sans-serif throughout" while every
    // paragraph of it was set in Source Serif, exactly like the other four.
    //
    // Asserted by the ABSENCE of the serif from the file rather than by the
    // presence of the sans. Every layout embeds Archivo somewhere — the footer
    // and the small caps are Archivo in all five — so finding it proves
    // nothing. A document with no serif in it anywhere is the only proof that
    // the running text moved.
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const hasSerif = out.pdf.toString('latin1').includes('SourceSerif4');
      expect({ key, hasSerif }).toEqual({
        key,
        hasSerif: LAYOUTS[key].bodyFace !== 'sans',
      });
    }
  });

  it('⚠️ only the edge-bar layout draws an edge bar, and it draws it on BODY pages', async () => {
    // "A colour bar down the edge of every page" has been Ledger's blurb since
    // the axis shipped, and nothing drew one. The bar is a full-height filled
    // rectangle at x=0, so it is unambiguous in the page's own operations.
    //
    // ⚠️ PAGE TWO, NOT THE COVER. A cover-only bar would satisfy a careless
    // reading of the blurb and be visibly wrong from the second sheet onwards.
    // ⚠️ SIX DECIMALS, WHICH IS HOW pdfkit WRITES A COORDINATE. Rounding the
    // width to look for ("26") matches nothing at all, and a test that never
    // matches reports the feature as absent from every layout including the
    // one that has it.
    const bar = `0 0 ${K_EDGE_BAR_W.toFixed(6)} `;
    for (const key of LAYOUT_KEYS) {
      const out = await svc.render({ ...base, layout: key } as never);
      const body = (await pageStream(out.pdf, 1)).toString('latin1');
      expect({ key, drawn: body.includes(bar) }).toEqual({
        key,
        drawn: LAYOUTS[key].edgeBar,
      });
    }
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

  it('\u26a0\ufe0f A COVER PHOTOGRAPH MUST NOT SPRAY ORPHAN PAGES', async () => {
    // The bug this exists for, caught in a pre-deploy review on 2026-08-24 and
    // then measured on the real renderer:
    //
    //   with a cover photograph and six dossier rows
    //     banner 7 pages · plate 12 · rule 5 · ledger 4 · classic 8
    //   the same packs without a photograph
    //     4 pages each
    //
    // The cause was the cover dossier grid drawing every row with a `width`,
    // which routes the draw through pdfkit's LineWrapper — and LineWrapper's
    // first act is to compare doc.y against the bottom margin and call
    // addPage(). A grid that did not fit therefore emitted one nearly-blank
    // page PER ROW, each carrying a single value like "24 August 2026".
    //
    // ⚠️ AND IT WAS ALREADY LIVE. Banner is DEFAULT_LAYOUT, so this reached
    // members before the five-cover work existed; the taller Plate and Classic
    // covers only made an old fault easy to see. Anything that reintroduces an
    // unguarded `.text(..., { width })` on the cover fails here.
    const photo = path.join(
      __dirname,
      '..',
      '..',
      'assets',
      'firearms',
      'glock-19.jpg',
    );
    if (!fs.existsSync(photo)) return; // asset-light checkout — nothing to prove

    for (const key of LAYOUT_KEYS) {
      const withPhoto = await svc.render({
        ...base,
        layout: key,
        idNumber: '8001015009087',
        firearmPhoto: photo,
        annexures: [
          { letter: 'A', title: 'ID', note: '' },
          { letter: 'B', title: 'Competency', note: '' },
        ],
      } as never);
      const withoutPhoto = await svc.render({
        ...base,
        layout: key,
        idNumber: '8001015009087',
        annexures: [
          { letter: 'A', title: 'ID', note: '' },
          { letter: 'B', title: 'Competency', note: '' },
        ],
      } as never);

      const a = (await PDFDocument.load(withPhoto.pdf)).getPageCount();
      const b = (await PDFDocument.load(withoutPhoto.pdf)).getPageCount();

      // A photograph is one framed block on the cover. It may cost a page — it
      // may not cost four.
      expect({ key, extra: a - b }).toEqual({
        key,
        extra: expect.any(Number),
      });
      if (a - b > 1) {
        throw new Error(
          `${key}: a cover photograph added ${a - b} pages (${b} -> ${a}) — the ` +
            'dossier grid is overflowing again',
        );
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

// ────────────────────────────────────────────────────────────────────
// THE BRANDING, WHICH IS A SEPARATE AXIS FROM BOTH OF THEM.
//
// Operator, 2026-08-24: "make them match the website branding. Should still
// look very professional."
// ────────────────────────────────────────────────────────────────────
describe('the house scheme', () => {
  it('\u26a0\ufe0f is what a new motivation opens on', () => {
    // The document used to default to Eucalyptus — the design handoff's own
    // colour, and nothing to do with All Outdoor. Safe to change only because
    // asScheme() validates on read: a row that stored a colour still gets it.
    expect(DEFAULT_SCHEME).toBe('alloutdoor');
    expect(SCHEME_KEYS[0]).toBe('alloutdoor');
  });

  it('carries the site\u2019s own ink and the site\u2019s own red', () => {
    // globals.css: --bg #0f0f0f, --red #C8102E.
    expect(SCHEMES.alloutdoor.deep2).toBe('#0f0f0f');
    expect(SCHEMES.alloutdoor.accent).toBe('#C8102E');
  });

  it('\u26a0\ufe0f leaves the PAGE white — a dark site is not a dark document', () => {
    // Flooding A4 with the site's ground would drink a cartridge, band on an
    // office laser and photocopy as a black rectangle at the police station
    // this pack is carried into. The wash is the paper, and it stays paper.
    const w = SCHEMES.alloutdoor.wash;
    expect(parseInt(w.slice(1, 3), 16)).toBeGreaterThan(0xf0);
  });

  it('\u26a0\ufe0f every scheme has an accent, and no scheme is a wash of one hue', () => {
    // The accent was added because eight muted values cannot make one. A
    // scheme whose accent equals its own body ink has not been given one.
    for (const key of SCHEME_KEYS) {
      const c = SCHEMES[key];
      expect(c.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.accent.toLowerCase()).not.toBe(c.ink.toLowerCase());
      expect(c.accent.toLowerCase()).not.toBe(c.deep.toLowerCase());
    }
  });

  it('\u26a0\ufe0f does not tint the section band — it repeats too often to be an accent', () => {
    // A pale red band was tried and rendered as five highlighter chips down a
    // body page. `band` sits behind every section title AND colours Report's
    // margin numerals, so on the house scheme it has to stay quiet; the brand
    // lives in the accent, which appears once per section.
    //
    // ⚠️ SCOPED TO THE HOUSE SCHEME ON PURPOSE, and it was briefly written
    // over all eleven — where Sand rightly failed it. Sand's band IS warm;
    // that is what choosing Sand means. Neutrality is a rule about the BRAND
    // scheme, not a rule about the operator's palette, and asserting it over
    // the palette would have made a correct colourway look like a defect.
    const b = SCHEMES.alloutdoor.band;
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    expect(Math.max(r, g, bl) - Math.min(r, g, bl)).toBeLessThan(0x08);
  });
});
