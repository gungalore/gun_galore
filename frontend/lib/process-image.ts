// Client-side image processing shared by upload surfaces that feed
// Claude-vision on the backend (dealer verification, KYC ID document).
//
// Decode → downscale → re-encode as JPEG. Handles HEIF/HEIC from
// iPhones automatically because <img>/createImageBitmap on iOS Safari
// natively decodes HEIF. On Android the camera already shoots JPEG.
// On desktop the same path works for whatever the user uploads — but
// note desktop browsers can NOT decode HEIC, so this throws there and
// callers should fall back to uploading the original file (the backend
// transcodes via Cloudinary before any vision call).
export async function processImage(file: File): Promise<File> {
  // Bail fast for files under 1MB and known JPEG — no need to round-trip
  // through canvas; just send as-is.
  if (
    file.size < 1024 * 1024 &&
    (file.type === 'image/jpeg' || file.type === 'image/jpg')
  ) {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(async () => {
    // Fallback for browsers that don't support createImageBitmap on
    // arbitrary blobs (older Safari, some Android variants). Use an
    // Image element via a blob URL.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not decode image'));
        i.src = url;
      });
      return img as unknown as ImageBitmap;
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // Downscale to max 1920px on the longest edge. Phone photos are
  // ~4032×3024; this gets us to ~1920×1440 with no visible quality loss.
  const MAX_EDGE = 1920;
  const ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const targetW = Math.round(bitmap.width * ratio);
  const targetH = Math.round(bitmap.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, targetW, targetH);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Could not encode as JPEG');

  // Preserve the original filename but force a .jpg extension so the
  // server-side multer + Cloudinary don't get confused.
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
