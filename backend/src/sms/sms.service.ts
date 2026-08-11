import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface SendSmsParams {
  to: string;
  message: string;
  /** Free-text grouping tag so we can find every attempt of a flow in
   *  the SmsLog table — e.g. "phone-change-<userId>". */
  reference?: string;
  /** Whether a transport failure of this message may be auto-retried by the
   *  10-min retry cron. When omitted it is DERIVED from the reference prefix:
   *  time-sensitive OTP flows (phone-change) are never retried (a code
   *  redelivered 20min later is expired + confusing); everything else IS
   *  (PIN/waybill/refund/reminder notices genuinely want redelivery). Pass
   *  explicitly to override the derivation. */
  retryable?: boolean;
}

interface SendSmsResult {
  success: boolean;
  messageId?: string;
  /** True when SMSPortal isn't configured and we logged a STUB row
   *  instead of actually sending. Dev mode falls back to this so
   *  the OTP flow still completes (the code is visible in the log). */
  stub?: boolean;
}

// Reference prefixes whose messages must NEVER be auto-retried — they are
// time-sensitive one-time codes where a late redelivery is worse than none.
const NON_RETRYABLE_PREFIXES = ['phone-change', 'otp', 'verify-code'];

// Retry budget + cadence. Initial send counts as attempt 1.
const MAX_SMS_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 10 * 60 * 1000; // 10 min between attempts
// Consecutive-FAILED run over the most recent sends that trips the outage alert.
const OUTAGE_STREAK = 5;
const OUTAGE_DEDUP_MS = 6 * 60 * 60 * 1000; // one outage alert per 6h

// Outbound SMS via SMSPortal. Ported from the old project
// (gun_galore_project/backend/src/modules/notifications/sms.service.ts)
// — proven working. Every send writes an SmsLog row, both for audit
// and so dev mode can dump stubbed sends to the DB instead of trying
// to hit the network.
@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** True when SMSPortal credentials are present (real-send mode). */
  private isConfigured(): boolean {
    const clientId =
      process.env.SMSPORTAL_CLIENT_ID ?? process.env.SMSPORTAL_API_KEY;
    return Boolean(clientId && process.env.SMSPORTAL_API_SECRET);
  }

  /** Whether a transport failure of this message is eligible for retry. */
  private isRetryable(params: SendSmsParams): boolean {
    if (typeof params.retryable === 'boolean') return params.retryable;
    const ref = params.reference ?? '';
    return !NON_RETRYABLE_PREFIXES.some((p) => ref.startsWith(p));
  }

  /** Normalise a SA mobile number to E.164 ("+27..."). Returns null on
   *  invalid input so callers can short-circuit early. */
  private normalise(raw: string): string | null {
    let n = raw.replace(/[\s\-()]/g, '');
    if (n.startsWith('0')) n = '+27' + n.slice(1);
    else if (n.startsWith('27')) n = '+' + n;
    // already +27...
    if (!/^\+27\d{9}$/.test(n)) return null;
    return n;
  }

  // Low-level POST to SMSPortal — no DB writes. Shared by the initial send
  // and the retry cron so both hit the exact same transport path. Callers
  // must have confirmed isConfigured() first.
  private async dispatch(
    normalised: string,
    message: string,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const clientId =
      process.env.SMSPORTAL_CLIENT_ID ?? process.env.SMSPORTAL_API_KEY;
    const apiSecret = process.env.SMSPORTAL_API_SECRET;
    const baseUrl =
      process.env.SMSPORTAL_BASE_URL ?? 'https://rest.smsportal.com/v1';
    const credentials = Buffer.from(`${clientId}:${apiSecret}`).toString(
      'base64',
    );
    try {
      // SMSPortal REST v1 uses /BulkMessages with Basic auth
      // (clientId:secret). Sender ID is configured per-account in the
      // SMSPortal console, not passed in the request body.
      const res = await fetch(`${baseUrl}/BulkMessages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ destination: normalised, content: message }],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        const errMsg =
          (body as { message?: string })?.message ?? `HTTP ${res.status}`;
        return { ok: false, error: errMsg };
      }
      const messages = (body as { messages?: Array<{ messageId?: unknown }> })
        ?.messages;
      const messageId =
        messages?.[0]?.messageId ?? (body as { messageId?: unknown })?.messageId;
      return { ok: true, messageId: messageId ? String(messageId) : undefined };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error: errMsg };
    }
  }

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const normalised = this.normalise(params.to);

    if (!normalised) {
      this.log.error(`Invalid phone number: ${params.to}`);
      // Permanent failure — never retryable (a bad number can't self-heal).
      await this.prisma.smsLog.create({
        data: {
          to: params.to,
          message: params.message,
          reference: params.reference,
          status: 'FAILED',
          error: 'Invalid phone number after normalisation',
        },
      });
      return { success: false };
    }

    if (!this.isConfigured()) {
      // Dev / unconfigured mode — log a STUB row + print the message to
      // the server log so the OTP can be retrieved during local testing.
      this.log.warn('SMSPortal not configured — SMS stub mode');
      this.log.log(
        `[SMS STUB] To: ${normalised} | Ref: ${params.reference ?? '-'} | ${params.message}`,
      );
      await this.prisma.smsLog.create({
        data: {
          to: normalised,
          message: params.message,
          reference: params.reference,
          status: 'STUB',
        },
      });
      return { success: true, stub: true };
    }

    const result = await this.dispatch(normalised, params.message);

    if (!result.ok) {
      this.log.error(`SMSPortal error for ${normalised}: ${result.error}`);
      const retryable = this.isRetryable(params);
      await this.prisma.smsLog.create({
        data: {
          to: normalised,
          message: params.message,
          reference: params.reference,
          status: 'FAILED',
          error: result.error,
          retryable,
          // Schedule the first retry attempt; null when not eligible.
          nextRetryAt: retryable ? new Date(Date.now() + RETRY_BACKOFF_MS) : null,
        },
      });
      return { success: false };
    }

    this.log.log(`SMS sent to ${normalised} — id: ${result.messageId ?? 'n/a'}`);
    await this.prisma.smsLog.create({
      data: {
        to: normalised,
        message: params.message,
        reference: params.reference,
        status: 'SENT',
        messageId: result.messageId,
      },
    });
    return { success: true, messageId: result.messageId };
  }

  // Retry FAILED-but-retryable messages whose backoff has elapsed, mirroring
  // the email outbox retry. Re-dispatches on the SAME SmsLog row (updates
  // status/attempts in place rather than creating a new row) so the audit
  // trail stays one row per message. Skips OTP/time-sensitive flows (their
  // rows are written retryable=false). Also raises an SMSPortal-outage alert
  // when the most recent sends are a solid run of failures.
  async retryFailed(): Promise<{
    retried: number;
    sent: number;
    exhausted: number;
  }> {
    if (!this.isConfigured()) return { retried: 0, sent: 0, exhausted: 0 };
    const now = new Date();
    const due = await this.prisma.smsLog.findMany({
      where: {
        status: 'FAILED',
        retryable: true,
        nextRetryAt: { not: null, lte: now },
        attempts: { lt: MAX_SMS_ATTEMPTS },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: 50,
    });

    let sent = 0;
    let exhausted = 0;
    for (const row of due) {
      const result = await this.dispatch(row.to, row.message);
      if (result.ok) {
        await this.prisma.smsLog.update({
          where: { id: row.id },
          data: {
            status: 'SENT',
            messageId: result.messageId,
            error: null,
            attempts: { increment: 1 },
            nextRetryAt: null,
          },
        });
        sent++;
      } else {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_SMS_ATTEMPTS;
        if (giveUp) exhausted++;
        await this.prisma.smsLog.update({
          where: { id: row.id },
          data: {
            attempts,
            error: result.error ?? 'retry failed',
            nextRetryAt: giveUp ? null : new Date(Date.now() + RETRY_BACKOFF_MS),
          },
        });
      }
    }
    if (sent > 0 || exhausted > 0) {
      this.log.log(
        `SMS retry: ${sent} sent, ${exhausted} exhausted of ${due.length} due`,
      );
    }
    await this.checkOutage();
    return { retried: due.length, sent, exhausted };
  }

  // Raise a deduped admin alert when the most-recent OUTAGE_STREAK real sends
  // are ALL failures — a strong signal SMSPortal (or our creds) are down and
  // critical messages (drop-off PINs, refund notices) are silently failing.
  private async checkOutage(): Promise<void> {
    try {
      const recent = await this.prisma.smsLog.findMany({
        where: { status: { in: ['SENT', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
        take: OUTAGE_STREAK,
        select: { status: true },
      });
      if (
        recent.length < OUTAGE_STREAK ||
        !recent.every((r) => r.status === 'FAILED')
      ) {
        return;
      }
      const since = new Date(Date.now() - OUTAGE_DEDUP_MS);
      const existing = await this.prisma.adminAlert.count({
        where: {
          type: 'SMS_OUTAGE',
          resolved: false,
          createdAt: { gte: since },
        },
      });
      if (existing > 0) return;
      await this.prisma.adminAlert.create({
        data: {
          type: 'SMS_OUTAGE',
          referenceId: 'smsportal',
          urgent: true,
          context:
            `The last ${OUTAGE_STREAK} SMS sends all FAILED — SMSPortal looks down or the ` +
            `credentials/balance are broken. Critical messages (parcel drop-off PINs, ` +
            `refund notices, reminders) are not reaching users. Check the SMSPortal ` +
            `console + balance. Fires at most once per 6h.`,
        },
      });
      this.log.error('SMS outage alert raised (>=5 consecutive failures)');
    } catch (err) {
      this.log.warn(`SMS outage check failed: ${(err as Error).message}`);
    }
  }
}
