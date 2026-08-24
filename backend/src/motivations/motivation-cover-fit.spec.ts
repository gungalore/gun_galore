import * as zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { MotivationPdfService } from './motivation-pdf.service';
import { COVER_FRAME_MM } from './motivation-cover-photo';

// ────────────────────────────────────────────────────────────────────
// THE COVER PHOTOGRAPH WAS BEING GUILLOTINED.
//
// Operator, item 12 of twelve, 2026-08-24, with a screenshot of a
// lever-action rifle cut off at both ends: "the box cuts the picture off. we
// need to make a plan so we can fit almost any shape picture and that it does
// not screw up the documents formatting."
//
// Two causes. The frame was 86 mm — 47% of the 182 mm content column, a
// leftover from a two-column cover that no longer exists — so the browser's
// trim tool forced every photograph into a narrow letterbox before it ever
// reached the renderer. And the renderer used `cover`, which fills the frame
// and clips whatever hangs over, so anything that did NOT come through the
// trim tool (a stock image off Commons, any shape at all) was cut.
//
// ⚠️ THE BOX STAYS FIXED. That is what keeps the formatting safe and it is why
// the fixed frame was introduced in the first place: the page reserves the
// same rectangle whatever the photograph is, so the dossier below never moves
// and no cover is a different length from any other. What changed is that the
// image is FITTED inside that rectangle instead of cropped to it.
// ────────────────────────────────────────────────────────────────────

/** A solid PNG of an exact shape, so the aspect under test is the one drawn. */
function png(w: number, h: number): Buffer {
  const row = Buffer.alloc(w * 3, 0xc8);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    row.copy(raw, y * (w * 3 + 1) + 1);
  }
  const table = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cc = Buffer.alloc(4);
    cc.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const base = {
  referenceNumber: 'MO000123',
  applicantName: 'Gerhard Fourie',
  licenceTypeLabel: 'Section 16 — Dedicated Hunter',
  body: 'Introduction:\n\nI am applying under section 16.',
  disclaimer: 'Prepared with assistance.',
  templateVersion: 'tpl-test',
  generatedAt: new Date('2026-08-24T08:00:00Z'),
  firearmLine: 'Marlin 1895 lever action, .45-70 Government',
};

const pageCount = async (pdf: Buffer) =>
  (await PDFDocument.load(pdf)).getPageCount();

jest.setTimeout(120000);

describe('a photograph of any shape survives the cover', () => {
  const svc = new MotivationPdfService();

  // The shapes that actually arrive: a phone panorama, a stock rifle image,
  // an ordinary snap, an upright photograph of a handgun on a bench.
  const shapes: [string, number, number][] = [
    ['4:1 panorama', 1600, 400],
    ['16:9', 1600, 900],
    ['3:2', 1500, 1000],
    ['square', 1000, 1000],
    ['3:4 upright', 750, 1000],
  ];

  it.each(shapes)('renders with a %s photograph', async (_n, w, h) => {
    const out = await svc.render({
      ...base,
      firearmPhoto: png(w, h),
    } as never);
    expect(out.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(out.pdf.toString('latin1')).toContain('/Image');
  });

  it('⚠️ THE PAGE COUNT DOES NOT MOVE WITH THE PHOTOGRAPH’S SHAPE', async () => {
    // This is "does not screw up the documents formatting", asserted. The box
    // is fixed, so a panorama and an upright photograph reserve exactly the
    // same rectangle and everything below them lands identically.
    const counts = new Set<number>();
    for (const [, w, h] of shapes) {
      const out = await svc.render({ ...base, firearmPhoto: png(w, h) } as never);
      counts.add(await pageCount(out.pdf));
    }
    expect(counts.size).toBe(1);
  });

  it('a pack with no photograph still renders', async () => {
    const out = await svc.render({ ...base } as never);
    expect(await pageCount(out.pdf)).toBeGreaterThan(0);
  });

  it('survives bytes pdfkit cannot embed, rather than losing the pack', async () => {
    const out = await svc.render({
      ...base,
      firearmPhoto: Buffer.from('not an image at all'),
    } as never);
    expect(out.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('the frame the cover reserves', () => {
  it('⚠️ is the FULL content column, not half of it', () => {
    // 182 mm is the column: 210 mm page less 14 mm margins. The frame was
    // 86 mm and its own comment claimed that WAS the full column.
    expect(COVER_FRAME_MM.w).toBe(182);
  });

  it('is deep enough that an upright photograph is not starved', () => {
    // At this height a 3:4 upright prints 64 mm wide — small, but whole and
    // legible. A shallower box shrinks it further.
    const upright = COVER_FRAME_MM.h * 0.75;
    expect(upright).toBeGreaterThan(55);
  });
});
