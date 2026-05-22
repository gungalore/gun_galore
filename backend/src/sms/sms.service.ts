import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface SendSmsParams {
  to: string;
  message: string;
  /** Free-text grouping tag so we can find every attempt of a flow in
   *  the SmsLog table — e.g. "phone-change-<userId>". */
  reference?: string;
}

interface SendSmsResult {
  success: boolean;
  messageId?: string;
  /** True when SMSPortal isn't configured and we logged a STUB row
   *  instead of actually sending. Dev mode falls back to this so
   *  the OTP flow still completes (the code is visible in the log). */
  stub?: boolean;
}

// Outbound SMS via SMSPortal. Ported from the old project
// (gun_galore_project/backend/src/modules/notifications/sms.service.ts)
// — proven working. Every send writes an SmsLog row, both for audit
// and so dev mode can dump stubbed sends to the DB instead of trying
// to hit the network.
@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    // SMSPortal credentials. The env var is conventionally
    // SMSPORTAL_CLIENT_ID but the auth scheme is "Basic <id:secret>"
    // — same as the old project's wiring. We also accept the legacy
    // SMSPORTAL_API_KEY name so this works on both env files.
    const clientId =
      process.env.SMSPORTAL_CLIENT_ID ?? process.env.SMSPORTAL_API_KEY;
    const apiSecret = process.env.SMSPORTAL_API_SECRET;
    const baseUrl =
      process.env.SMSPORTAL_BASE_URL ?? 'https://rest.smsportal.com/v1';

    const normalised = this.normalise(params.to);

    if (!normalised) {
      this.log.error(`Invalid phone number: ${params.to}`);
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

    if (!clientId || !apiSecret) {
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
          messages: [{ destination: normalised, content: params.message }],
        }),
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        const errMsg =
          (body as { message?: string })?.message ?? `HTTP ${res.status}`;
        this.log.error(`SMSPortal error for ${normalised}: ${errMsg}`);
        await this.prisma.smsLog.create({
          data: {
            to: normalised,
            message: params.message,
            reference: params.reference,
            status: 'FAILED',
            error: errMsg,
          },
        });
        return { success: false };
      }

      const messages = (body as { messages?: Array<{ messageId?: unknown }> })
        ?.messages;
      const messageId =
        messages?.[0]?.messageId ??
        (body as { messageId?: unknown })?.messageId;
      this.log.log(`SMS sent to ${normalised} — id: ${messageId ?? 'n/a'}`);
      await this.prisma.smsLog.create({
        data: {
          to: normalised,
          message: params.message,
          reference: params.reference,
          status: 'SENT',
          messageId: messageId ? String(messageId) : undefined,
        },
      });
      return {
        success: true,
        messageId: messageId ? String(messageId) : undefined,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      this.log.error(`SMSPortal fetch failed for ${normalised}: ${errMsg}`);
      await this.prisma.smsLog.create({
        data: {
          to: normalised,
          message: params.message,
          reference: params.reference,
          status: 'FAILED',
          error: errMsg,
        },
      });
      return { success: false };
    }
  }
}
