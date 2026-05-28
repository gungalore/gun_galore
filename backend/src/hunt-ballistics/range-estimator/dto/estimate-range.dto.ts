import { BadRequestException } from '@nestjs/common';

/**
 * AimRegion — normalised aim coordinates as 0..1 fractions of the
 * photo's dimensions. Mirrors the frontend's AimRegion type in
 * lib/api/estimate-range.ts. The AI uses these to know where in
 * the photo the operator was actually aiming.
 */
export type AimRegion = {
  centerX: number;
  centerY: number;
  boxW: number;
  boxH: number;
  dotR: number;
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
  const fields = ['centerX', 'centerY', 'boxW', 'boxH', 'dotR'] as const;
  return fields.every(
    (k) =>
      typeof v[k] === 'number' &&
      Number.isFinite(v[k] as number) &&
      (v[k] as number) >= 0 &&
      (v[k] as number) <= 1,
  );
}
