import sharp from 'sharp';
import type { JevImageAsset } from '../llm/llm.types';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SIDE = 1568;
const MIN_SIDE = 280;

/**
 * Turn an uploaded image into the shape Jev accepts.
 *
 * ⚠️ TRANSPORT ONLY. This rotates by EXIF, strips metadata, resizes and
 * re-encodes when needed. It does not crop, deskew, brighten or OCR — the
 * pixels Jev sees are the applicant's own document.
 */
export async function toJevImage(
  bytes: Buffer,
  mimeType: string,
): Promise<JevImageAsset> {
  if (!bytes?.length) throw new Error('The document is empty.');
  if (mimeType === 'application/pdf') {
    throw new Error(
      'PDF classification needs the PDF rasteriser before it can be sent to Jev.',
    );
  }

  let image = sharp(bytes, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('That image could not be read.');
  }

  const longest = Math.max(meta.width, meta.height);
  const shortest = Math.min(meta.width, meta.height);
  if (longest > MAX_SIDE || shortest < MIN_SIDE) {
    const scale =
      longest > MAX_SIDE
        ? MAX_SIDE / longest
        : Math.max(1, MIN_SIDE / shortest);
    image = image.resize({
      width: Math.round(meta.width * scale),
      height: Math.round(meta.height * scale),
      fit: 'inside',
      withoutEnlargement: false,
    });
  }

  const out = await image
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: false });

  if (out.length > MAX_BYTES) {
    throw new Error('That image is larger than 16 MB after conversion.');
  }

  return {
    type: 'image',
    format: 'jpg',
    data_base64: out.toString('base64'),
  };
}
