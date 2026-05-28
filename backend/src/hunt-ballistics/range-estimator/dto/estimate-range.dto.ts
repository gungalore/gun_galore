import { BadRequestException } from '@nestjs/common';

/**
 * AimRegion — normalised aim coordinates as 0..1 fractions of the
 * photo's dimensions. Mirrors the frontend's AimRegion type in
 * lib/api/estimate-range.ts. The AI uses these to know where in
 * the photo the operator was actually aiming, AND where to look
 * for distance-matched scale references.
 *
 * Three concentric zones (innermost to outermost), each with a
 * different semantic role for the AI:
 *
 * 1. DOT (centerX, centerY, radius dotR ~1% of frame)
 *    Primary aim point. The AI tries to identify whatever is here
 *    first.
 *
 * 2. BOX (centred on dot, ~8% × 8% square)
 *    Sized to encompass a small SA car (~1.5 × 3.7 m) at 200 m on
 *    an iPhone main camera, plus ~3× safety margin so the box is
 *    big enough to be visible/tappable on a phone screen. If the
 *    DOT landed on empty terrain, the AI expands its subject search
 *    to ANYTHING TOUCHING the box. The box doubles as a built-in
 *    scale reference: anything filling it is roughly car-at-200m
 *    sized in apparent angular extent.
 *
 * 3. BAND (vertical strip at the dot's image-Y, full frame width,
 *    thickness ~15% of frame height)
 *    On flat-ish ground, objects at the same image-Y are at similar
 *    physical distances to the camera (perspective principle). So
 *    the AI PREFERS reference objects found in the band: a fence
 *    post or vehicle in the band is at the same distance as the
 *    subject in the dot, which makes the scale-to-distance math
 *    much cleaner than using a reference at a different image
 *    height. Falls back to other-frame references when the band
 *    has nothing identifiable.
 */
export type AimRegion = {
  centerX: number;
  centerY: number;
  /** BOX width (0..1) — sized to a small car at 200 m on iPhone main camera. */
  boxW: number;
  /** BOX height (0..1) — sized to a small car at 200 m on iPhone main camera. */
  boxH: number;
  /** DOT radius (0..1 of min(width, height)). */
  dotR: number;
  /** BAND top Y-coordinate (0..1, 0 = top of frame). */
  bandTop?: number;
  /** BAND bottom Y-coordinate (0..1, 1 = bottom of frame). */
  bandBottom?: number;
};

/**
 * Parsed multipart body for POST /hunt-ballistics/estimate-range.
 * Multipart fields arrive as strings — this is the typed shape after
 * parsing + range validation.
 */
export type EstimateRangeBody = {
  /** ISO 3166-1 alpha-2, e.g. "ZA". */
  regionCode?: string;
  /** Inclinometer pitch in degrees at capture, -89..89. */
  tiltDeg?: number;
  /** Compass heading in degrees at capture, 0..360. Captured for the
   *  future map-plot feature (shooter location + bearing → target). */
  headingDeg?: number;
  /** GPS latitude at capture, -90..90. */
  latitude?: number;
  /** GPS longitude at capture, -180..180. */
  longitude?: number;
  /** Optional quarry shortlist (species names) to narrow AI search. */
  knownSpecies?: string[];
  /** Aim region geometry. */
  aimRegion?: AimRegion;
  /** Optical zoom of the chosen lens (1 = main wide, 3 = typical iPhone
   *  Pro tele). Frontend reports this so the AI can derive an effective
   *  FOV from the base camera FOV. */
  opticalZoom?: number;
  /** Digital zoom applied at capture (centre-crop + upscale, 1 = none). */
  digitalZoom?: number;
  /** Combined zoom factor — operator's "stack the lenses" math. */
  effectiveZoom?: number;
  /** Human-readable camera label for logs ("Back Telephoto Camera"). */
  cameraLabel?: string;
};

/**
 * Parse + validate the multipart form-data body into typed fields.
 *
 * NestJS doesn't run class-validator on multipart fields automatically
 * (they all arrive as strings), so we do parsing + range checks here.
 * Bad input throws BadRequestException (HTTP 400) with a clear message
 * instead of silently coercing.
 *
 * All fields are optional — the endpoint accepts a photo-only request
 * (the AI will still try to estimate, just without metadata help).
 */
export function parseEstimateRangeBody(
  raw: Record<string, unknown>,
): EstimateRangeBody {
  const out: EstimateRangeBody = {};

  if (typeof raw.regionCode === 'string' && raw.regionCode.length > 0) {
    if (!/^[A-Z]{2}$/.test(raw.regionCode)) {
      throw new BadRequestException(
        'regionCode must be ISO 3166-1 alpha-2 (e.g. "ZA").',
      );
    }
    out.regionCode = raw.regionCode;
  }

  out.tiltDeg = parseNumberField(raw.tiltDeg, 'tiltDeg', -89, 89);
  out.headingDeg = parseNumberField(raw.headingDeg, 'headingDeg', 0, 360);
  out.latitude = parseNumberField(raw.latitude, 'latitude', -90, 90);
  out.longitude = parseNumberField(raw.longitude, 'longitude', -180, 180);
  out.opticalZoom = parseNumberField(raw.opticalZoom, 'opticalZoom', 0.5, 20);
  out.digitalZoom = parseNumberField(raw.digitalZoom, 'digitalZoom', 1, 20);
  out.effectiveZoom = parseNumberField(raw.effectiveZoom, 'effectiveZoom', 0.5, 100);

  if (typeof raw.cameraLabel === 'string' && raw.cameraLabel.length > 0) {
    // Clip to 100 chars so a malicious / weird label can't blow up log
    // lines + the system prompt.
    out.cameraLabel = raw.cameraLabel.slice(0, 100);
  }

  if (typeof raw.knownSpecies === 'string' && raw.knownSpecies.length > 0) {
    out.knownSpecies = parseJsonField(raw.knownSpecies, 'knownSpecies', (v) => {
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
        throw new BadRequestException(
          'knownSpecies must be a JSON array of strings.',
        );
      }
      // Sanity cap so a malicious caller can't ship a 10k-species list.
      return v.slice(0, 20) as string[];
    });
  }

  if (typeof raw.aimRegion === 'string' && raw.aimRegion.length > 0) {
    out.aimRegion = parseJsonField(raw.aimRegion, 'aimRegion', (v) => {
      if (!isValidAimRegion(v)) {
        throw new BadRequestException(
          'aimRegion must have numeric centerX, centerY, boxW, boxH, dotR (all 0..1).',
        );
      }
      return v;
    });
  }

  return out;
}

function parseNumberField(
  raw: unknown,
  fieldName: string,
  min: number,
  max: number,
): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new BadRequestException(`${fieldName} must be a number.`);
  }
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${fieldName} must be a finite number.`);
  }
  if (n < min || n > max) {
    throw new BadRequestException(
      `${fieldName} must be between ${min} and ${max}.`,
    );
  }
  return n;
}

function parseJsonField<T>(
  raw: string,
  fieldName: string,
  validate: (value: unknown) => T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BadRequestException(
      `${fieldName} must be valid JSON: ${
        err instanceof Error ? err.message : 'parse error'
      }`,
    );
  }
  return validate(parsed);
}

function isValidAimRegion(value: unknown): value is AimRegion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  // Required: centerX, centerY, boxW, boxH, dotR. All 0..1.
  const required = ['centerX', 'centerY', 'boxW', 'boxH', 'dotR'] as const;
  const requiredValid = required.every(
    (k) =>
      typeof v[k] === 'number' &&
      Number.isFinite(v[k] as number) &&
      (v[k] as number) >= 0 &&
      (v[k] as number) <= 1,
  );
  if (!requiredValid) return false;

  // Optional: bandTop, bandBottom. Must both be present or both absent,
  // and bandTop < bandBottom.
  const hasTop = 'bandTop' in v && v.bandTop != null;
  const hasBot = 'bandBottom' in v && v.bandBottom != null;
  if (hasTop !== hasBot) return false;
  if (hasTop && hasBot) {
    const t = v.bandTop;
    const b = v.bandBottom;
    if (
      typeof t !== 'number' ||
      typeof b !== 'number' ||
      !Number.isFinite(t) ||
      !Number.isFinite(b) ||
      t < 0 ||
      b > 1 ||
      t >= b
    ) {
      return false;
    }
  }
  return true;
}
