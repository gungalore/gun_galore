import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  DiditCreatedSession,
  DiditDecision,
  DiditError,
  DiditOtpResult,
} from './didit.types';

const DEFAULT_BASE_URL = 'https://verification.didit.me';
/** Didit's own freshness window for a webhook signature. */
const WEBHOOK_MAX_SKEW_SECONDS = 300;

export interface CreateSessionInput {
  /** User.id. Binds the session to our member and gives us webhook routing. */
  vendorData: string;
  /** Where the hosted flow returns the member. */
  callback: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
  /** SANDBOX ONLY — forces an outcome without running (or billing) providers. */
  sandboxScenario?: string;
}

/**
 * The ONE adapter for Didit, mirroring the rule that governs LlmService: no
 * other service builds a client, picks a host, or parses a Didit response.
 * They speak the typed methods below and handle DiditError.
 */
@Injectable()
export class DiditService implements OnModuleInit {
  private readonly logger = new Logger(DiditService.name);

  private get apiKey() {
    return process.env.DIDIT_API_KEY?.trim() ?? '';
  }
  private get baseUrl() {
    return (process.env.DIDIT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    );
  }
  private get workflowId() {
    return process.env.DIDIT_WORKFLOW_ID?.trim() ?? '';
  }
  private get mode(): 'sandbox' | 'live' {
    return process.env.DIDIT_MODE?.trim().toLowerCase() === 'live'
      ? 'live'
      : 'sandbox';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.workflowId.length > 0;
  }

  isSandbox(): boolean {
    return this.mode === 'sandbox';
  }

  /**
   * Local development with no Didit key at all.
   *
   * ⚠️ THIS CAN NEVER BE TRUE IN PRODUCTION, and not by convention —
   * `onModuleInit` below hard-throws when production boots unconfigured, so a
   * production process that reaches this line does not exist. That is the only
   * reason a code-printing stub is safe to have in the tree at all.
   *
   * It exists because `register` writes the User row and then sends the code:
   * without a stub, nobody can complete a sign-up on a fresh clone, and the
   * first thing a new developer meets is a 400. Same shape SmsService uses
   * when SMSPortal is unconfigured — do the work, print the code, never
   * pretend the send happened silently.
   */
  /**
   * THIS THROWS AND KILLS THE BOOT, DELIBERATELY.
   *
   * The provider this replaced defaulted to sandbox and only LOGGED an error
   * in production, so a production box could — and did — boot with sandbox
   * identity checks, which means every identity passes on canned data and
   * nobody finds out until it matters. A verification rail that is silently
   * fake is worse than one that is visibly down.
   */
  onModuleInit() {
    if (process.env.NODE_ENV !== 'production') return;
    if (this.mode !== 'live') {
      throw new Error(
        'DIDIT_MODE must be "live" in production. Refusing to start with ' +
          'sandbox identity verification, which approves canned data.',
      );
    }
    if (!this.isConfigured()) {
      throw new Error(
        'DIDIT_API_KEY and DIDIT_WORKFLOW_ID must both be set in production.',
      );
    }
  }

  private async call<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<T> {
    if (!this.apiKey) {
      throw new DiditError('not_configured', 'DIDIT_API_KEY is not set');
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          // x-api-key, NOT Authorization: Bearer. The bearer scheme belongs to
          // apx.didit.me (account management); the verification API on this
          // host does not accept it.
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw new DiditError(
        'provider_unavailable',
        `Could not reach Didit: ${(err as Error).message}`,
      );
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { detail: text.slice(0, 300) };
    }

    if (res.ok) return json as T;

    const detail =
      (json as { detail?: string })?.detail ?? `HTTP ${res.status}`;
    const code = (json as { code?: string })?.code;

    // 403, NOT 401, is what a bad or missing key returns on this API. Anyone
    // grepping logs for 401s to diagnose a credential problem finds nothing.
    if (res.status === 403 || res.status === 401) {
      throw new DiditError(
        'not_configured',
        `Didit rejected the API key: ${detail}`,
        res.status,
      );
    }
    if (res.status === 429) {
      throw new DiditError('rate_limited', detail, 429);
    }
    if (res.status === 502 && code === 'phone_provider_unavailable') {
      throw new DiditError('provider_unavailable', detail, 502);
    }
    if (res.status >= 500) {
      throw new DiditError('provider_unavailable', detail, res.status);
    }
    throw new DiditError('bad_request', detail, res.status);
  }

  // ── OTPs are NOT here any more ───────────────────────────────────────
  //
  // ⚠️ EMAIL AND PHONE VERIFICATION MOVED BACK IN-HOUSE, 2026-09-11, and the
  // four methods that lived here (sendEmailCode / checkEmailCode /
  // sendPhoneCode / checkPhoneCode) are deleted rather than left unused.
  //
  //   * Email is minted in AuthService and delivered by Resend — Didit charged
  //     $0.03 a send and the mail arrived under Didit's own branding, which is
  //     a stranger's name on the first email a member ever gets from us.
  //   * Phone is minted in UsersService and delivered over SMSPortal — Didit
  //     charged $0.1048 per ZA SMS against roughly $0.01-0.02, and refuses
  //     phone verification outright until the organisation's first top-up.
  //
  // Do not add them back without moving the callers too: two implementations
  // of one OTP is how a code gets checked against the wrong store.

  /**
   * Create a hosted verification session and return the URL to send the
   * member to.
   *
   * Idempotent on (workflow_id, vendor_data) while a session is unfinished, so
   * a member who reloads the page gets the same session back rather than a
   * second billable one.
   */
  async createKycSession(
    input: CreateSessionInput,
  ): Promise<DiditCreatedSession> {
    // ⚠️ DELIBERATELY NOT STUBBED, unlike the OTPs above. A stubbed code still
    // has to be read out of a log by the person signing up; a stubbed identity
    // verification would silently APPROVE somebody. Local KYC needs a real
    // sandbox key — Didit's sandbox mocks every provider and bills nothing.
    const body: Record<string, unknown> = {
      workflow_id: this.workflowId,
      vendor_data: input.vendorData,
      callback: input.callback,
      // "both" because the callback sometimes does not fire from the device
      // that started the flow — and a desktop member finishes on their phone,
      // which is precisely that case.
      callback_method: 'both',
      language: 'en',
      metadata: input.metadata ?? {},
    };

    const contact: Record<string, unknown> = {};
    if (input.email) contact.email = input.email;
    if (input.phone) contact.phone = input.phone;
    if (Object.keys(contact).length) body.contact_details = contact;

    // Rejected outright by a live application, so it can never leak into
    // production as a way of forcing an approval.
    if (input.sandboxScenario && this.isSandbox()) {
      body.sandbox_scenario = input.sandboxScenario;
    }

    return this.call<DiditCreatedSession>('/v3/session/', {
      method: 'POST',
      body,
    });
  }

  async getDecision(sessionId: string): Promise<DiditDecision> {
    return this.call<DiditDecision>(
      `/v3/session/${encodeURIComponent(sessionId)}/decision/`,
      { method: 'GET' },
    );
  }

  // ── Webhook signature ────────────────────────────────────────────────

  /**
   * Verify a webhook's HMAC-SHA256 signature and timestamp.
   *
   * Didit sends two usable signatures and we accept EITHER:
   *   - `X-Signature`    over the exact raw bytes
   *   - `X-Signature-V2` over sorted, Unicode-preserved canonical JSON
   *
   * `X-Signature-Simple` is deliberately NOT accepted. It signs only
   * "{timestamp}:{session_id}:{status}:{webhook_type}" — the envelope, not the
   * decision — so a valid Simple signature says nothing about whether the
   * identity data underneath it was tampered with.
   */
  verifyWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const secret = process.env.DIDIT_WEBHOOK_SECRET?.trim();
    if (!secret) {
      this.logger.error('DIDIT_WEBHOOK_SECRET is not set — refusing webhook');
      return false;
    }

    const header = (name: string): string | undefined => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };

    const ts = Number(header('x-timestamp'));
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Date.now() / 1000 - ts) > WEBHOOK_MAX_SKEW_SECONDS) {
      this.logger.warn('Didit webhook rejected: timestamp outside ±5 minutes');
      return false;
    }

    const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const hmac = (payload: string | Buffer) =>
      createHmac('sha256', secret).update(payload).digest('hex');

    const candidates: Array<[string | undefined, string]> = [
      [header('x-signature'), hmac(raw)],
    ];

    const v2 = header('x-signature-v2');
    if (v2) {
      try {
        candidates.push([
          v2,
          hmac(canonicalJson(JSON.parse(raw.toString('utf8')))),
        ]);
      } catch {
        // Unparseable body — the raw-bytes candidate is the only chance.
      }
    }

    return candidates.some(([given, expected]) =>
      given ? constantTimeEquals(given, expected) : false,
    );
  }
}

/** Constant-time compare that does not leak length through an early return. */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still burn a comparison so a length mismatch is not faster than a
    // content mismatch.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Deterministic JSON with object keys sorted at every depth and non-ASCII left
 * as-is. Array ORDER is meaningful and is never sorted.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
