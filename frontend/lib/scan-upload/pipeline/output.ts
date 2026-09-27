import { imageDataToCanvas, resizeImageData } from './decode';

/** Matches what the website expects: JPEG, quality 0.88, longest edge 3600 px, well under 10 MB. */
export const OUTPUT_MAX_EDGE = 3600;
export const JPEG_QUALITY = 0.88;

export async function imageDataToJpeg(img: ImageData, quality = JPEG_QUALITY, maxEdge = OUTPUT_MAX_EDGE): Promise<Blob> {
  const sized = resizeImageData(img, maxEdge);
  const canvas = imageDataToCanvas(sized);
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  });
}

export const NAME_MAX = 80;

/** Strip characters that file systems and the website's review rows dislike. */
export function safeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/** `<name>.jpg` for one file, `<name> p1.jpg`, `<name> p2.jpg`... for several. Keeps the extension. */
export function nameFiles(files: File[], name: string): File[] {
  const base = safeName(name);
  if (!base) return files;
  return files.map((f, i) => {
    const m = /\.[a-z0-9]+$/i.exec(f.name);
    const ext = m ? m[0].toLowerCase() : f.type === 'application/pdf' ? '.pdf' : '.jpg';
    const named = files.length === 1 ? `${base}${ext}` : `${base} p${i + 1}${ext}`;
    return new File([f], named, { type: f.type, lastModified: f.lastModified });
  });
}
