import {
  AnnexureImage,
  CAPTION_H,
  GAP,
  captionFor,
  imageSize,
  isEmbeddable,
  planAnnexurePages,
} from './motivation-annexure-layout';

// A4 at 72dpi with the motivation's own 71pt margins.
const BOX = { x: 71, y: 71, width: 453.28, height: 699.89 };

const img = (
  over: Partial<AnnexureImage> & { width: number; height: number },
): AnnexureImage => ({
  letter: 'A',
  label: 'A copy of your ID',
  index: 1,
  total: 1,
  ...over,
});

/** An ID-1 card photographed landscape. */
const card = (over: Partial<AnnexureImage> = {}) =>
  img({ width: 1712, height: 1080, ...over });
/** An A4 page photographed portrait. */
const a4 = (over: Partial<AnnexureImage> = {}) =>
  img({ width: 1240, height: 1754, ...over });

describe('planAnnexurePages', () => {
  it('⚠️ GIVES AN A4 CERTIFICATE A PAGE TO ITSELF', () => {
    // At the full content width an A4 scan is 1.41x as tall as it is wide —
    // 640pt of a 700pt box. Nothing else fits beside it, and squeezing one in
    // would mean scaling both down.
    const pages = planAnnexurePages([a4(), a4({ letter: 'B' })], BOX);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(1);
    expect(pages[1]).toHaveLength(1);
  });

  it('⚠️ PUTS TWO LICENCE CARDS ON ONE PAGE, at full width each', () => {
    // The operator's ask: more than one copy per page is fine. A card at full
    // width is ~286pt tall, so two fit with room for both captions — and
    // neither is shrunk to make it happen.
    const pages = planAnnexurePages([card(), card({ letter: 'B' })], BOX);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
    for (const p of pages[0]) {
      expect(p.w).toBeCloseTo(BOX.width, 6);
    }
  });

  it('⚠️ NEVER LETS AN IMAGE RUN OFF THE PAGE', () => {
    // Readable means printable. A placement that overflows the content box is
    // a copy the printer crops, which is worse than one that is merely small.
    const many = [card(), card({ letter: 'B' }), a4({ letter: 'C' }), card({ letter: 'D' })];
    for (const page of planAnnexurePages(many, BOX)) {
      for (const p of page) {
        expect(p.captionY).toBeGreaterThanOrEqual(BOX.y - 1e-6);
        expect(p.y + p.h).toBeLessThanOrEqual(BOX.y + BOX.height + 1e-6);
        expect(p.x).toBeGreaterThanOrEqual(BOX.x - 1e-6);
        expect(p.x + p.w).toBeLessThanOrEqual(BOX.x + BOX.width + 1e-6);
      }
    }
  });

  it('never overlaps two placements on a page', () => {
    const pages = planAnnexurePages([card(), card({ letter: 'B' })], BOX);
    const [first, second] = pages[0];
    expect(second.captionY).toBeGreaterThanOrEqual(first.y + first.h + GAP);
  });

  it('leaves room for every caption', () => {
    const pages = planAnnexurePages([card(), card({ letter: 'B' })], BOX);
    for (const p of pages[0]) {
      expect(p.y - p.captionY).toBeCloseTo(CAPTION_H, 6);
    }
  });

  it('⚠️ SCALES A VERY TALL SCAN DOWN RATHER THAN CROPPING IT', () => {
    // A phone photograph of a long receipt, or a page shot at a distance.
    // Height-limited, so it comes out narrower than the box — and centred,
    // because a copy hard against the left margin reads as a mistake.
    const tall = img({ width: 800, height: 4000 });
    const [page] = planAnnexurePages([tall], BOX);
    const p = page[0];
    expect(p.h).toBeLessThanOrEqual(BOX.height - CAPTION_H + 1e-6);
    expect(p.w).toBeLessThan(BOX.width);
    expect(p.x + p.w / 2).toBeCloseTo(BOX.x + BOX.width / 2, 6);
  });

  it('⚠️ DOES NOT LOOP FOREVER on an image bigger than the page', () => {
    // The first image on a page must never trigger a break, or an oversized
    // one pushes itself to a fresh page again and again.
    const huge = img({ width: 100, height: 100000 });
    const pages = planAnnexurePages([huge, huge], BOX);
    expect(pages).toHaveLength(2);
  });

  it('handles an empty list and a degenerate size', () => {
    expect(planAnnexurePages([], BOX)).toEqual([]);
    const [page] = planAnnexurePages([img({ width: 0, height: 0 })], BOX);
    expect(Number.isFinite(page[0].w)).toBe(true);
    expect(Number.isFinite(page[0].h)).toBe(true);
  });
});

describe('captionFor', () => {
  it('names the annexure and the document', () => {
    expect(captionFor(card())).toBe('Annexure A — A copy of your ID');
  });

  it('⚠️ NUMBERS THE COPIES when one annexure has several', () => {
    // Front and back of a card share a letter. Without "1 of 2" the DFO
    // cannot tell whether the pack is complete.
    expect(captionFor(card({ index: 2, total: 2 }))).toBe(
      'Annexure A — A copy of your ID (2 of 2)',
    );
  });
});

describe('isEmbeddable', () => {
  it('takes what pdfkit takes, and nothing else', () => {
    expect(isEmbeddable('image/jpeg')).toBe(true);
    expect(isEmbeddable('image/png')).toBe(true);
    // ⚠️ Both are accepted uploads. They are stored, listed and served as
    // normal; they just cannot be reprinted into the pack, and the index says
    // so rather than the page quietly going missing.
    expect(isEmbeddable('image/webp')).toBe(false);
    expect(isEmbeddable('application/pdf')).toBe(false);
  });
});

describe('imageSize', () => {
  it('reads a PNG header', () => {
    const b = Buffer.alloc(24);
    b.writeUInt32BE(0x89504e47, 0);
    b.writeUInt32BE(1240, 16);
    b.writeUInt32BE(1754, 20);
    expect(imageSize(b)).toEqual({ width: 1240, height: 1754 });
  });

  it('reads a JPEG SOF0, walking past earlier segments', () => {
    // SOI, then an APP0 of length 16, then SOF0 carrying the real size.
    const parts = [
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x10]),
      Buffer.alloc(14),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
      (() => {
        const d = Buffer.alloc(4);
        d.writeUInt16BE(1080, 0);
        d.writeUInt16BE(1712, 2);
        return d;
      })(),
      Buffer.alloc(8),
    ];
    expect(imageSize(Buffer.concat(parts))).toEqual({
      width: 1712,
      height: 1080,
    });
  });

  it('⚠️ IS NOT FOOLED BY A HUFFMAN TABLE, which shares the SOF range', () => {
    // 0xC4 is DHT, not a frame header. Reading its bytes as a size yields a
    // plausible-looking number and a stretched licence.
    const parts = [
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xc4, 0x00, 0x0a]),
      Buffer.alloc(8),
      Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08]),
      (() => {
        const d = Buffer.alloc(4);
        d.writeUInt16BE(600, 0);
        d.writeUInt16BE(900, 2);
        return d;
      })(),
      Buffer.alloc(8),
    ];
    expect(imageSize(Buffer.concat(parts))).toEqual({ width: 900, height: 600 });
  });

  it('returns null rather than guessing', () => {
    expect(imageSize(Buffer.from([0x52, 0x49, 0x46, 0x46]))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
