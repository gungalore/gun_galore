import { bitmapToImageData, makeCanvas } from '../pipeline/decode';
import { DECODE_MAX_EDGE } from '../pipeline/decode';

import type { PhotoSettings } from './camera';

interface ImageCaptureLike {
  takePhoto(settings?: PhotoSettings): Promise<Blob>;
}
declare const ImageCapture: { new (track: MediaStreamTrack): ImageCaptureLike } | undefined;

/**
 * Take the still for the scan. Chrome Android has ImageCapture.takePhoto, which
 * goes through the native photo pipeline at full sensor resolution. iOS Safari
 * does not (through 26.x): there the still is a grab of the video frame, so the
 * stream must be opened as large as the phone allows.
 */
export type StillSource = 'photo' | 'frame';

export interface Still {
  image: ImageData;
  /** 'photo' = native photo pipeline (different field of view from the video); 'frame' = the video frame. */
  source: StillSource;
}

export async function grabStill(video: HTMLVideoElement, track: MediaStreamTrack | null, photo: PhotoSettings | null = null): Promise<Still> {
  if (track && typeof ImageCapture !== 'undefined') {
    try {
      const capture = new ImageCapture(track);
      // Ask for the capped size; a camera that refuses the size still gets asked for a photo.
      const blob = photo ? await capture.takePhoto(photo).catch(() => capture.takePhoto()) : await capture.takePhoto();
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        return { image: bitmapToImageData(bmp, DECODE_MAX_EDGE).image, source: 'photo' };
      } finally {
        bmp.close();
      }
    } catch {
      /* fall through to the frame grab */
    }
  }
  return { image: grabFrame(video, DECODE_MAX_EDGE), source: 'frame' };
}

/**
 * Copy a region of the current video frame (video pixels) to pixels, scaled
 * down so it is `outWidth` wide; never scaled up. For measuring the print
 * inside the outline at the resolution the camera actually delivers.
 */
export function grabRegion(video: HTMLVideoElement, sx: number, sy: number, sw: number, sh: number, outWidth: number): ImageData | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const x0 = Math.max(0, Math.floor(sx));
  const y0 = Math.max(0, Math.floor(sy));
  const x1 = Math.min(vw, Math.ceil(sx + sw));
  const y1 = Math.min(vh, Math.ceil(sy + sh));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const k = Math.min(1, outWidth / (x1 - x0));
  const w = Math.max(1, Math.round((x1 - x0) * k));
  const h = Math.max(1, Math.round((y1 - y0) * k));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Copy the current video frame to pixels, at most `maxEdge` on the long side. */
export function grabFrame(video: HTMLVideoElement, maxEdge: number): ImageData {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
