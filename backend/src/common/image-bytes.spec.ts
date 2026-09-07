import sharp from 'sharp';
import { boundedImageBytes } from './image-bytes';
import { IMAGE_EDGE } from './image-url';

async function png(width: number, height: number): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 46 } },
  })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

describe('boundedImageBytes', () => {
  it('shrinks a phone-sized photograph to the edge and re-encodes as JPEG', async () => {
    const big = await png(3000, 4000);
    const out = await boundedImageBytes({ base64: big, mimeType: 'image/png' }, IMAGE_EDGE.photo);
    expect(out.bounded).toBe(true);
    expect(out.mimeType).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(out.base64, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1280);
    expect(Buffer.from(out.base64, 'base64').length).toBeLessThan(Buffer.from(big, 'base64').length);
  });

  it('leaves a small JPEG exactly as it came, never upscaling', async () => {
    const small = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const out = await boundedImageBytes(
      { base64: small.toString('base64'), mimeType: 'image/jpeg' },
      IMAGE_EDGE.photo,
    );
    expect(out.bounded).toBe(false);
    expect(out.base64).toBe(small.toString('base64'));
  });

  it('passes bytes it cannot read through unchanged rather than failing', async () => {
    const junk = Buffer.from('not an image at all').toString('base64');
    const out = await boundedImageBytes({ base64: junk, mimeType: 'image/jpeg' }, 1280);
    expect(out).toEqual({ base64: junk, mimeType: 'image/jpeg', bounded: false });
  });
});
