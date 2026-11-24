import sharp from 'sharp';
import { toJevImage } from './jev-image';

// The listing photo screen caps the longest side to stay under JEV's 32k
// `state` token budget (a 1568px image + the six-question battery is rejected
// with max_tokens_exceeded). Documents keep the 1568 default.
describe('toJevImage — maxSide', () => {
  async function jpeg(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    })
      .jpeg({ quality: 84 })
      .toBuffer();
  }

  it('downscales to the requested longest side', async () => {
    const asset = await toJevImage(await jpeg(1600, 1200), 'image/jpeg', 1024);
    const meta = await sharp(Buffer.from(asset.data_base64, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
  });

  it('keeps the 1568 document default when no maxSide is given', async () => {
    const asset = await toJevImage(await jpeg(1600, 1200), 'image/jpeg');
    const meta = await sharp(Buffer.from(asset.data_base64, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
  });

  it('does not upscale an image already below the cap', async () => {
    const asset = await toJevImage(await jpeg(900, 700), 'image/jpeg', 1280);
    const meta = await sharp(Buffer.from(asset.data_base64, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(900);
  });
});
