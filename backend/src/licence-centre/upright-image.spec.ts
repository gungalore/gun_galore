import { uprightImageBytes } from './upright-image';
import sharp from 'sharp';

// ────────────────────────────────────────────────────────────────────
// THE EXIF ORIENTATION CORRECTION, AND ITS NO-OPS.
//
// ⚠️ THE INTERESTING CASES ARE THE ONES THAT MUST NOT CHANGE ANYTHING. A
// correction that fires on an already-upright upload, a PDF or an undecodable
// file would re-encode bytes we had no business touching — and an evidence
// photograph is meant to be stored exactly as it was taken.
// ────────────────────────────────────────────────────────────────────

async function flat(): Promise<Buffer> {
  // 60x40 landscape, no orientation tag.
  return sharp({
    create: { width: 60, height: 40, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer();
}

describe('uprightImageBytes', () => {
  it('bakes a portrait EXIF orientation into the pixels', async () => {
    const upright = await flat();
    const rotated = await sharp(upright)
      .withMetadata({ orientation: 6 })
      .toBuffer();
    // The tag is really there and really says "turn me".
    expect((await sharp(rotated).metadata()).orientation).toBe(6);

    const out = await uprightImageBytes(rotated, 'image/jpeg');

    expect(out.rotated).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    // The tag is gone (baked in), and the pixels are now portrait.
    expect(meta.orientation ?? 1).toBe(1);
    expect(`${meta.width}x${meta.height}`).toBe('40x60');
  });

  it('is a byte-for-byte no-op on an image with no orientation tag', async () => {
    const upright = await flat();
    const out = await uprightImageBytes(upright, 'image/jpeg');
    expect(out.rotated).toBe(false);
    expect(out.bytes).toBe(upright);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('never touches a PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4\nnot really');
    const out = await uprightImageBytes(pdf, 'application/pdf');
    expect(out.rotated).toBe(false);
    expect(out.bytes).toBe(pdf);
    expect(out.mimeType).toBe('application/pdf');
  });

  it('passes an undecodable file through rather than throwing', async () => {
    const junk = Buffer.from('not an image at all');
    const out = await uprightImageBytes(junk, 'image/jpeg');
    expect(out.rotated).toBe(false);
    expect(out.bytes).toBe(junk);
  });

  it('passes empty bytes through', async () => {
    const out = await uprightImageBytes(Buffer.alloc(0), 'image/jpeg');
    expect(out.rotated).toBe(false);
    expect(out.bytes.length).toBe(0);
  });
});
