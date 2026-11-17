import sharp from 'sharp';
import { maskPhotoRegions } from './photo-mask';

// Pixelation is checked by the region's spread: a gradient inside the box must
// flatten, while the image keeps its dimensions. JPEG re-encoding changes every
// pixel slightly, so a raw equality check would be a lie.

async function gradientImage(width = 200, height = 100): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      // A one-pixel checkerboard: its detail cannot survive a 6px mosaic.
      const high = (x + y) % 2 === 0 ? 240 : 15;
      raw[i] = high;
      raw[i + 1] = (x * 3 + y * 11) % 256;
      raw[i + 2] = (x * 13 + y * 5) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('maskPhotoRegions', () => {
  it('pixelates the requested region and keeps the image size', async () => {
    const input = await gradientImage();
    const box = {
      category: 'contact' as const,
      top: 0.2,
      bottom: 0.4,
      left: 0.2,
      right: 0.4,
      confidence: 0.9,
    };

    const out = await maskPhotoRegions(input, [box]);
    expect(out).not.toBeNull();

    const meta = await sharp(out!).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);

    const crop = { left: 45, top: 23, width: 30, height: 14 };
    const before = await sharp(input).extract(crop).stats();
    const after = await sharp(out!).extract(crop).stats();
    const spreadBefore = before.channels.reduce((n, c) => n + c.stdev, 0);
    const spreadAfter = after.channels.reduce((n, c) => n + c.stdev, 0);

    expect(spreadBefore).toBeGreaterThan(0);
    expect(spreadAfter).toBeLessThan(spreadBefore * 0.8);
  });

  it('returns null when there is nothing to mask', async () => {
    expect(await maskPhotoRegions(await gradientImage(), [])).toBeNull();
  });
});
