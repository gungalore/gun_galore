import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Re-encodes every uploaded valuation photo through sharp to strip ALL
 * metadata (EXIF, GPS, ICC, XMP) before storage or model use. Fails closed:
 * any decode/encode error throws and the caller rejects the upload, so an
 * image whose metadata could not be verified as removed is never stored.
 *
 * Orientation is applied first (so a rotated phone photo displays upright)
 * and the longest edge is capped to bound model cost.
 */
@Injectable()
export class ExifService {
  async strip(
    fileBuffer: Buffer,
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    const out = await sharp(fileBuffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: out.data,
      width: out.info.width,
      height: out.info.height,
    };
  }
}
