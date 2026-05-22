import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

// PORTED VERBATIM from the old project's verifynow.service.ts. Only
// difference: env vars are read via process.env instead of NestJS's
// ConfigService (matches the rest of this codebase). Logic is identical
// so if the old project worked, this one does too.
//
// Do not "improve" this file without re-testing the full flow end-to-end
// against the real VerifyNow API — small changes in headers or body
// shape break it silently.

export class KycException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KycException';
  }
}

export interface IdVerificationResult {
  success: boolean;
  firstName: string;
  surname: string;
  dob: string;
  gender: string;
  citizenship: string;
  deceasedStatus: string;
  idBlocked: string;
  transactionId: string;
  /** Base64-encoded PNG of the official Home Affairs ID photo (returned by VerifyNow) */
  idPhotoBase64?: string;
}

export interface FaceMatchResult {
  success: boolean;
  matchStatus: string;
  confidenceScore: number;
  transactionId: string;
}

export interface CreditBalance {
  /** Credits remaining on the VerifyNow account. */
  available: number;
  /** When VerifyNow last refreshed this number (ISO string, if returned). */
  lastRefreshAt: string | null;
  /** Raw payload — kept for debugging if the response shape changes. */
  raw: unknown;
}

/**
 * Wraps the VerifyNow public REST API.
 *
 * Endpoint:  POST {baseUrl}/verify
 * Auth:      x-api-key: vn_live_…
 * Idempotency: client-generated UUID per request (Idempotency-Key header)
 *
 * Body:  { reportType, idNumber, mode }
 *   reportType: "home_affairs_id_photo" → returns full ID record + IDPhoto base64
 *   mode: "sandbox" (free) | "production" (uses credits)
 */
@Injectable()
export class VerifyNowService {
  private readonly log = new Logger(VerifyNowService.name);

  /** Defaults to the public VerifyNow API namespace. */
  private get baseUrl(): string {
    return (
      process.env.VERIFYNOW_BASE_URL ??
      'https://www.verifynow.co.za/api/external'
    );
  }

  private get apiKey(): string {
    return process.env.VERIFYNOW_API_KEY ?? '';
  }

  /** "sandbox" or "production". Defaults to sandbox so we don't burn credits in dev. */
  private get mode(): 'sandbox' | 'production' {
    const m = (process.env.VERIFYNOW_MODE ?? 'sandbox').toLowerCase();
    return m === 'production' ? 'production' : 'sandbox';
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    };
  }

  async verifyIdNumber(idNumber: string): Promise<IdVerificationResult> {
    try {
      const res = await fetch(`${this.baseUrl}/verify`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          reportType: 'home_affairs_id_photo',
          idNumber,
          mode: this.mode,
        }),
      });

      const raw = await res.text();
      let data: Record<string, unknown>;
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        data = { rawBody: raw };
      }

      if (!res.ok) {
        this.log.error(
          `VerifyNow ID check failed: HTTP ${res.status} — ${raw.slice(0, 300)}`,
        );
        throw new KycException(
          (data?.message as string) ||
            'Identity verification service unavailable — please try again shortly.',
        );
      }
      if (data.success === false) {
        this.log.error(
          `VerifyNow ID check returned success=false: ${raw.slice(0, 300)}`,
        );
        throw new KycException(
          (data?.message as string) || 'We could not verify this ID number.',
        );
      }

      const r = (data.result ?? {}) as Record<string, string | undefined>;

      // Refuse flagged / deceased records up front
      if (r.DeadIndicator && r.DeadIndicator !== 'No') {
        throw new KycException('We could not verify this ID number.');
      }
      if (r.IDNBlocked && r.IDNBlocked !== 'No') {
        throw new KycException(
          'This ID number has been flagged. Please contact support.',
        );
      }
      // Verify the returned IDN matches the input (sanity check)
      if (r.IDN && idNumber && r.IDN !== idNumber) {
        throw new KycException(
          'The provided ID number does not match Home Affairs records.',
        );
      }

      return {
        success: true,
        firstName: r.Name ?? '',
        surname: r.Surname ?? '',
        dob: r.dob ?? r.DOB ?? r.DateOfBirth ?? '',
        gender: r.Gender ?? '',
        citizenship:
          r.Citizenship ?? r.citizenship ?? r.BirthPlaceCountryCode ?? 'SA',
        deceasedStatus:
          r.DeadIndicator === 'No' ? 'Alive' : r.DeadIndicator ?? 'Alive',
        idBlocked: r.IDNBlocked === 'Yes' ? 'YES' : 'NO',
        transactionId:
          (data.transaction_id as string) ?? (data.requestId as string) ?? '',
        idPhotoBase64: r.IDPhoto ?? r.Photo ?? undefined,
      };
    } catch (err) {
      if (err instanceof KycException) throw err;
      this.log.error('VerifyNow ID check error', err);
      throw new KycException(
        'Identity verification service unavailable — please try again shortly.',
      );
    }
  }

  /**
   * VerifyNow face-match endpoint.
   *
   * POST {baseUrl}/facematch
   * Body: { bundle: "facematch", mode, selfie_image_base64, id_number }
   * Response: results.face_match.{ status: "Approved", score: 0-100, warnings: [] }
   *
   * The selfie_image_base64 may include or omit the data URL prefix.
   * Caller (kyc.service.ts) requires score >= 75 AND status === 'Approved'.
   */
  async faceMatch(
    idNumber: string,
    selfieBase64: string,
  ): Promise<FaceMatchResult> {
    try {
      const res = await fetch(`${this.baseUrl}/facematch`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          bundle: 'facematch',
          mode: this.mode,
          selfie_image_base64: selfieBase64,
          id_number: idNumber,
        }),
      });

      const raw = await res.text();
      let data: Record<string, unknown>;
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        data = { rawBody: raw };
      }

      if (!res.ok) {
        this.log.error(
          `VerifyNow face-match failed: HTTP ${res.status} — ${raw.slice(0, 300)}`,
        );
        throw new KycException(
          (data?.message as string) ||
            'Face verification service unavailable — please try again shortly.',
        );
      }
      if (data.success === false) {
        this.log.error(
          `VerifyNow face-match returned success=false: ${raw.slice(0, 300)}`,
        );
        throw new KycException(
          (data?.message as string) || 'We could not verify your selfie.',
        );
      }

      const results = (data?.results ?? {}) as {
        face_match?: { status?: string; score?: number | string; warnings?: unknown[] };
        request_id?: string;
      };
      const fm = results.face_match ?? {};
      const status: string = fm.status ?? 'Unknown';
      const score: number =
        typeof fm.score === 'number'
          ? fm.score
          : Number(fm.score as string) || 0;
      const transactionId: string =
        results.request_id ?? (data.requestId as string) ?? '';

      if (Array.isArray(fm.warnings) && fm.warnings.length > 0) {
        this.log.warn(
          `VerifyNow face-match warnings: ${JSON.stringify(fm.warnings)}`,
        );
      }

      return {
        success: true,
        matchStatus: status,
        confidenceScore: score,
        transactionId,
      };
    } catch (err) {
      if (err instanceof KycException) throw err;
      this.log.error('VerifyNow face-match error', err);
      throw new KycException(
        'Face verification service unavailable — please try again shortly.',
      );
    }
  }

  // ─────────────────── Credit balance ──────────────────────────────
  // GET {baseUrl}/my_credits — returns the account's remaining credits.
  // Free to call (doesn't burn a credit itself) and works in both
  // sandbox + production. Idempotency-Key header is NOT required here
  // (per their docs it's only mandatory on /verify production calls).
  //
  // Response shapes we handle:
  //   Sandbox:    { "available_credits": 1000 }
  //   Production: { "Status": "Success",
  //                 "Result": { "credits": "1500",
  //                             "last_refresh": "2026-05-19T11:35:17Z" } }
  // We normalise both into CreditBalance so callers don't care.
  async getCreditBalance(): Promise<CreditBalance> {
    try {
      const res = await fetch(`${this.baseUrl}/my_credits`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      const raw = await res.text();
      let data: Record<string, unknown>;
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        data = { rawBody: raw };
      }

      if (!res.ok) {
        this.log.error(
          `VerifyNow my_credits failed: HTTP ${res.status} — ${raw.slice(0, 300)}`,
        );
        throw new KycException(
          (data?.message as string) ||
            'Could not fetch credit balance from VerifyNow.',
        );
      }

      // Pull `available_credits` (sandbox) or `Result.credits` (production).
      // VerifyNow returns credits as a string in production — coerce.
      const result = (data.Result ?? {}) as Record<string, unknown>;
      const rawCredits =
        (data.available_credits as number | string | undefined) ??
        (result.credits as number | string | undefined);
      const available =
        typeof rawCredits === 'number'
          ? rawCredits
          : typeof rawCredits === 'string'
            ? Number(rawCredits) || 0
            : 0;
      const lastRefreshAt =
        (result.last_refresh as string | undefined) ?? null;

      return { available, lastRefreshAt, raw: data };
    } catch (err) {
      if (err instanceof KycException) throw err;
      this.log.error('VerifyNow my_credits error', err);
      throw new KycException(
        'Could not fetch credit balance from VerifyNow.',
      );
    }
  }
}
