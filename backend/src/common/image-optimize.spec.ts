import sharp from 'sharp';
import {
  optimizePhotoForUpload,
  PHOTO_STORAGE_MAX_EDGE,
} from './image-optimize';

/** A JPEG with real detail (a flat colour compresses to almost nothing). */
async function photoJpeg(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = (i * 7) % 256;
    pixels[i + 1] = (i * 13) % 256;
    pixels[i + 2] = (i * 29) % 256;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe('optimizePhotoForUpload', () => {
  it('downscales a 12 MP phone photo to the storage edge', async () => {
    const original = await photoJpeg(3024, 4032);

    const optimized = await optimizePhotoForUpload(original);
    const meta = await sharp(optimized).metadata();

    // Longest side is capped at 1920; a 12 MP photo is orders of magnitude
    // more pixels than the page needs, and it is the payload Cloudinary was
    // taking minutes to accept live.
    expect(Math.max(meta.width!, meta.height!)).toBe(PHOTO_STORAGE_MAX_EDGE);
    expect(meta.width! < meta.height!).toBe(true); // portrait stays portrait
    expect(optimized.length).toBeLessThan(original.length);
  });

  it('leaves an already-small JPEG untouched', async () => {
    const small = await photoJpeg(900, 600);

    const optimized = await optimizePhotoForUpload(small);

    expect(optimized).toBe(small);
  });

  it('keeps transparency as PNG', async () => {
    const transparent = await sharp({
      create: {
        width: 2600,
        height: 1800,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.4 },
      },
    })
      .png()
      .toBuffer();

    const optimized = await optimizePhotoForUpload(transparent);
    const meta = await sharp(optimized).metadata();

    expect(meta.format).toBe('png');
    expect(Math.max(meta.width!, meta.height!)).toBe(PHOTO_STORAGE_MAX_EDGE);
  });

  it('returns bytes it cannot read unchanged, so an upload never breaks', async () => {
    const notAnImage = Buffer.from('this is definitely not an image');

    await expect(optimizePhotoForUpload(notAnImage)).resolves.toBe(notAnImage);
  });
});
