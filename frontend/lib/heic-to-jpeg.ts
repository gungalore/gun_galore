// Convert an iPhone HEIC/HEIF photo to JPEG in the browser, so everything
// downstream — the <img> preview, the pre-publish Claude-vision moderation
// (which base64-encodes the staged photos and does NOT accept HEIC), and the
// Cloudinary upload — receives a universally-supported format.
//
// Why this is needed: once we add image/heic to a file input's `accept`, iOS
// Safari stops auto-converting Photo Library picks to JPEG and hands over the
// original HEIC; the Files app also becomes able to supply raw .heic. HEIC
// essentially only originates on Apple devices, and Safari can DECODE HEIC
// natively via createImageBitmap, so canvas re-encoding to JPEG works there.
// On browsers that can't decode HEIC (e.g. Android Chrome opening a
// transferred .heic) createImageBitmap throws — we then return the original
// file untouched: the backend validators accept HEIC and Cloudinary converts
// it on delivery, so storage/display still work (only the pre-publish vision
// scan may skip that rare file).

export function isHeic(file: File): boolean {
  return /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export async function normalizeImageForUpload(file: File): Promise<File> {
  if (!isHeic(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) return file;
    const jpegName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([blob], /\.jpe?g$/i.test(jpegName) ? jpegName : `${jpegName}.jpg`, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    // Browser can't decode HEIC — hand back the original; backend + Cloudinary
    // still accept and convert it for storage/display.
    return file;
  }
}
