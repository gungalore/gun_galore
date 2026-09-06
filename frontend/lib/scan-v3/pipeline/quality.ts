import type { QualityVerdict } from '../types';
import { resizeImageData } from './decode';
import { exposure, glareFraction, sharpness, toGrey } from './gates';

/** Sharpness is measured on a copy this size on the long edge, so numbers compare across phones. */
export const QUALITY_MEASURE_EDGE = 1000;

/**
 * Thresholds from the first phone rounds (sharpness at the 1000 px measuring
 * scale): crisp A4 pages read 4300-9000, crisp cards 2500-3400, a soft but
 * legible card 350-420. Revisit once OCR results come back from the server.
 */
export const QUALITY = {
  /** Above this: "Sharp and readable". */
  sharpGood: 1500,
  /** Below this: "A bit blurry". Between: readable, said plainly, not as a warning. A Samsung photo at 400 reads, but looks poor. */
  sharpWarn: 600,
  darkMean: 60,
  glareWarn: 0.015,
};

/**
 * Grade a rectified page for the review badge. `normalized` is what the
 * member sees; `base` is the same crop before illumination normalisation,
 * which is where glare has to be measured.
 */
export function gradePage(normalized: ImageData, base: ImageData = normalized): QualityVerdict {
  const measured = resizeImageData(normalized, QUALITY_MEASURE_EDGE);
  const grey = toGrey(measured);
  const sharp = sharpness(grey, measured.width, measured.height);
  const exp = exposure(grey);
  const glare = glareFraction(resizeImageData(base, QUALITY_MEASURE_EDGE));
  const img = normalized;
  void img;
  if (exp.mean < QUALITY.darkMean) {
    return { level: 'bad', label: 'Too dark to read - scan again', sharpness: sharp, brightness: exp.mean, glare };
  }
  if (sharp < QUALITY.sharpWarn) {
    return { level: 'warn', label: 'A bit blurry - can you read it?', sharpness: sharp, brightness: exp.mean, glare };
  }
  if (glare > QUALITY.glareWarn) {
    return { level: 'warn', label: 'Some glare - check the text', sharpness: sharp, brightness: exp.mean, glare };
  }
  if (sharp < QUALITY.sharpGood) {
    // Legible, just not crisp: a Samsung's 12 MP photo of a card reads fine at ~300 here.
    return { level: 'good', label: 'Readable', sharpness: sharp, brightness: exp.mean, glare };
  }
  return { level: 'good', label: 'Sharp and readable', sharpness: sharp, brightness: exp.mean, glare };
}
