import sharp from 'sharp';
import type { WriteableMetadata } from 'sharp';
import { ExifService } from './exif.service';

async function gpsTaggedJpeg(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer();
  // sharp writes GPS EXIF at runtime; its type definitions omit the GPS IFD,
  // so the options object is cast to the parameter type.
  const exif = {
    IFD0: { Make: 'TestCam', Model: 'GPS-1' },
    GPS: { GPSLatitudeRef: 'S', GPSLatitude: '1/1 2/1 3/1' },
  };
  return sharp(base)
    .withMetadata({ exif } as unknown as WriteableMetadata)
    .jpeg()
    .toBuffer();
}

describe('ExifService', () => {
  const service = new ExifService();

  it('strips all metadata, including GPS, from an uploaded JPEG', async () => {
    const tagged = await gpsTaggedJpeg();
    const before = await sharp(tagged).metadata();
    expect(before.exif).toBeTruthy();

    const { buffer, width, height } = await service.strip(tagged);

    const after = await sharp(buffer).metadata();
    expect(after.exif ?? null).toBeNull();
    expect(width).toBe(40);
    expect(height).toBe(30);
  });

  it('caps the longest edge to 2048px without enlarging', async () => {
    const big = await sharp({
      create: { width: 4000, height: 1000, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();

    const { width, height } = await service.strip(big);
    expect(width).toBe(2048);
    expect(height).toBe(512);
  });

  it('fails closed on a non-image buffer', async () => {
    await expect(service.strip(Buffer.from('not an image'))).rejects.toBeTruthy();
  });
});
