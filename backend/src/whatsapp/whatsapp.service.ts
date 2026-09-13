import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { WHATSAPP_TEMPLATES, WhatsappTemplateDef } from './whatsapp-templates';

interface SendTemplateParams {
  to: string;
  templateKey: string;
  /** Rendered into the template body AND handed to `linkCode` for the URL
   *  button suffix — so it may carry `txId` even for a template whose body
   *  has no placeholders at all (`welcome_complete_profile`). */
  vars: Record<string, string>;
  /** Free-text grouping tag, mirrors SmsLog.reference — e.g.
   *  "order-confirmed-<transactionId>". */
  reference?: string;
}

interface SendTemplateResult {
  success: boolean;
  messageId?: string;
  /** True when WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID aren't configured and
   *  we logged a STUB row instead of calling Meta. Mirrors SmsService's dev
   *  stub behaviour so the caller (the sendSms seam) can fall back to SMS
   *  exactly as it would for a real failure. */
  stub?: boolean;
}

// Meta error codes that mean "sending again will not help" — see
// developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes.
//   131047 — Re-engagement message outside the 24h customer-service window.
//   132001 — Template does not exist / is not approved in this language.
// Everything else (5xx, network errors, rate limits) is treated as
// transient and retried, per the plan this module mirrors.
const NON_RETRYABLE_CODES = new Set([131047, 132001]);

// Retry budget + cadence — identical to SmsService's.
const MAX_WHATSAPP_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 10 * 60 * 1000; // 10 min between attempts
const OUTAGE_STREAK = 5;
const OUTAGE_DEDUP_MS = 6 * 60 * 60 * 1000; // one outage alert per 6h

const GRAPH_API_VERSION = 'v21.0';

// Outbound WhatsApp via the Meta Cloud API. Mirrors backend/src/sms/sms.service.ts
// on purpose — that service already solved logging, retry, backoff,
// stub-when-unconfigured and outage alerting, and its shape has been in
// production long enough to trust. WhatsApp is a fourth notification rail,
// not a rewrite of the pattern.
//
// This service is a pure SENDER. It does not check `FLAGS.whatsappEnabled` or
// `User.notifyWhatsappEnabled` — that gating lives in the `sendSms` fan-out
// seam in notifications.service.ts (a separate step of this plan), which
// decides WHETHER to call `sendTemplate` at all. Once called, this service
// always attempts to send (or stub) — it is not itself a second gate.
@Injectable()
export class WhatsappService {
  private readonly log = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Reused rather than forked — SmsService.toE164 is public specifically
    // so other transports normalise ZA numbers exactly one way. See its
    // own doc comment.
    private readonly sms: SmsService,
  ) {}

  /** True when Meta Cloud API credentials are present (real-send mode). */
  isConfigured(): boolean {
    return Boolean(
      process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
    );
  }

  private resolveTemplate(templateKey: string): WhatsappTemplateDef {
    const def = WHATSAPP_TEMPLATES[templateKey];
    if (!def) {
      // Unknown key is a programming error (a call site typo'd the key, or
      // the registry lost an entry) — never something a caller should
      // silently swallow into a failed send.
      throw new Error(`Unknown WhatsApp template key: "${templateKey}"`);
    }
    return def;
  }

  // Low-level POST to the Meta Graph API — no DB writes. Shared by the
  // initial send and the retry cron so both hit the exact same transport
  // path, exactly as SmsService.dispatch is. Callers must have confirmed
  // isConfigured() first.
  private async dispatch(
    normalised: string,
    def: WhatsappTemplateDef,
    vars: Record<string, string>,
  ): Promise<{
    ok: boolean;
    messageId?: string;
    error?: string;
    errorCode?: number;
  }> {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

    const components: Record<string, unknown>[] = [];
    if (def.requiredVars.length > 0) {
      components.push({
        type: 'body',
        parameters: def.requiredVars.map((key) => ({
          type: 'text',
          text: vars[key] ?? '',
        })),
      });
    }
    // One URL button maximum, one variable in its suffix (Meta's grammar
    // rule) — sub_type "url", index "0" is the only button slot every
    // template in the registry uses.
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: def.linkCode(vars) }],
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalised,
          type: 'template',
          template: {
            name: def.metaName,
            language: { code: def.lang },
            components,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        const errObj = (body as { error?: Record<string, unknown> })?.error;
        const errMsg =
          (errObj?.message as string | undefined) ?? `HTTP ${res.status}`;
        const errCode =
          typeof errObj?.code === 'number' ? (errObj.code as number) : undefined;
        return { ok: false, error: errMsg, errorCode: errCode };
      }
      const messages = (body as { messages?: Array<{ id?: unknown }> })
        ?.messages;
      const messageId = messages?.[0]?.id ? String(messages[0].id) : undefined;
      return { ok: true, messageId };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error: errMsg };
    }
  }

  private isRetryable(errorCode: number | undefined): boolean {
    if (errorCode !== undefined && NON_RETRYABLE_CODES.has(errorCode)) {
      return false;
    }
    return true;
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendTemplateResult> {
    const def = this.resolveTemplate(params.templateKey);
    const normalised = this.sms.toE164(params.to);

    if (!normalised) {
      this.log.error(`Invalid phone number: ${params.to}`);
      await this.prisma.whatsappMessageLog.create({
        data: {
          to: params.to,
          templateKey: def.key,
          vars: params.vars,
          reference: params.reference,
          status: 'FAILED',
          error: 'Invalid phone number after normalisation',
          retryable: false,
        },
      });
      return { success: false };
    }

    // ⚠️ REFUSE BEFORE ANYTHING LEAVES, NOT AFTER. A WhatsApp send cannot be
    // recalled, and both failure modes here are silent on the wire: a missing
    // body variable renders "Order  is confirmed" (Meta accepts an empty
    // parameter), and a missing `txId` builds the button suffix
    // `tundefined`, which resolveShortCode rejects and quietly redirects to
    // the home page. Neither throws, neither shows up in a status callback,
    // and the member sees a broken message we cannot take back. So every
    // variable the body AND the button need is checked here, and a gap falls
    // back to SMS — which is what returning failure does at the call site.
    const missing = [...def.requiredVars, ...def.linkVars].filter(
      (key) => !params.vars[key] || params.vars[key].trim().length === 0,
    );
    if (missing.length > 0) {
      this.log.error(
        `WhatsApp template ${def.key} missing variables: ${missing.join(', ')}`,
      );
      await this.prisma.whatsappMessageLog.create({
        data: {
          to: normalised,
          templateKey: def.key,
          vars: params.vars,
          reference: params.reference,
          status: 'FAILED',
          error: `Missing template variables: ${missing.join(', ')}`,
          // A programming error at the call site. Retrying sends the same
          // gap again; it needs a code change, not another attempt.
          retryable: false,
        },
      });
      return { success: false };
    }

    if (!this.isConfigured()) {
      // Dev / unconfigured mode — log a STUB row + print the rendered body
      // to the server log, the same way SmsService makes dev OTPs readable.
      this.log.warn('WhatsApp not configured — WhatsApp stub mode');
      this.log.log(
        `[WHATSAPP STUB] To: ${normalised} | Template: ${def.key} | Ref: ${params.reference ?? '-'} | ${def.render(params.vars)}`,
      );
      await this.prisma.whatsappMessageLog.create({
        data: {
          to: normalised,
          templateKey: def.key,
          vars: params.vars,
          reference: params.reference,
          status: 'STUB',
        },
      });
      return { success: true, stub: true };
    }

    const result = await this.dispatch(normalised, def, params.vars);

    if (!result.ok) {
      this.log.error(
        `WhatsApp send error for ${normalised} (${def.key}): ${result.error}`,
      );
      const retryable = this.isRetryable(result.errorCode);
      await this.prisma.whatsappMessageLog.create({
        data: {
          to: normalised,
          templateKey: def.key,
          vars: params.vars,
          reference: params.reference,
          status: 'FAILED',
          error: result.error,
          retryable,
          nextRetryAt: retryable ? new Date(Date.now() + RETRY_BACKOFF_MS) : null,
        },
      });
      return { success: false };
    }

    this.log.log(
      `WhatsApp sent to ${normalised} (${def.key}) — id: ${result.messageId ?? 'n/a'}`,
    );
    await this.prisma.whatsappMessageLog.create({
      data: {
        to: normalised,
        templateKey: def.key,
        vars: params.vars,
        reference: params.reference,
        status: 'SENT',
        messageId: result.messageId,
      },
    });
    return { success: true, messageId: result.messageId };
  }

  // Retry FAILED-but-retryable messages whose backoff has elapsed. Mirrors
  // SmsService.retryFailed: re-dispatches on the SAME WhatsappMessageLog row
  // (updates status/attempts in place) so the audit trail stays one row per
  // message, and raises an outage alert when the most recent sends are a
  // solid run of failures.
  async retryFailed(): Promise<{
    retried: number;
    sent: number;
    exhausted: number;
  }> {
    if (!this.isConfigured()) return { retried: 0, sent: 0, exhausted: 0 };
    const now = new Date();
    const due = await this.prisma.whatsappMessageLog.findMany({
      where: {
        status: 'FAILED',
        retryable: true,
        nextRetryAt: { not: null, lte: now },
        attempts: { lt: MAX_WHATSAPP_ATTEMPTS },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: 50,
    });

    let sent = 0;
    let exhausted = 0;
    for (const row of due) {
      // A row is only ever written against a key that existed at send time,
      // but the registry could in principle have changed since — skip
      // rather than throw so one bad row doesn't kill the whole batch.
      const def = WHATSAPP_TEMPLATES[row.templateKey];
      if (!def) {
        this.log.warn(
          `Skipping retry of ${row.id}: unknown template key "${row.templateKey}"`,
        );
        continue;
      }
      const vars = (row.vars ?? {}) as Record<string, string>;
      const result = await this.dispatch(row.to, def, vars);
      if (result.ok) {
        await this.prisma.whatsappMessageLog.update({
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
        const retryable = this.isRetryable(result.errorCode);
        const attempts = row.attempts + 1;
        const giveUp = !retryable || attempts >= MAX_WHATSAPP_ATTEMPTS;
        if (giveUp) exhausted++;
        await this.prisma.whatsappMessageLog.update({
          where: { id: row.id },
          data: {
            attempts,
            error: result.error ?? 'retry failed',
            retryable,
            nextRetryAt: giveUp ? null : new Date(Date.now() + RETRY_BACKOFF_MS),
          },
        });
      }
    }
    if (sent > 0 || exhausted > 0) {
      this.log.log(
        `WhatsApp retry: ${sent} sent, ${exhausted} exhausted of ${due.length} due`,
      );
    }
    await this.checkOutage();
    return { retried: due.length, sent, exhausted };
  }

  // Raise a deduped admin alert when the most-recent OUTAGE_STREAK real
  // sends are ALL failures — a strong signal the Meta Cloud API (or our
  // token/phone-number-id) is down and order/shipping updates are silently
  // failing over to SMS (or, if SMS is also down, not reaching anyone).
  private async checkOutage(): Promise<void> {
    try {
      const recent = await this.prisma.whatsappMessageLog.findMany({
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
          type: 'WHATSAPP_OUTAGE',
          resolved: false,
          createdAt: { gte: since },
        },
      });
      if (existing > 0) return;
      await this.prisma.adminAlert.create({
        data: {
          type: 'WHATSAPP_OUTAGE',
          referenceId: 'whatsapp',
          urgent: true,
          context:
            `The last ${OUTAGE_STREAK} WhatsApp sends all FAILED — the Meta Cloud API looks down, ` +
            `or the token/phone-number-id are broken. Order and shipping updates are falling back ` +
            `to SMS for members who opted into WhatsApp. Check WhatsApp Manager + the System User ` +
            `token. Fires at most once per 6h.`,
        },
      });
      this.log.error('WhatsApp outage alert raised (>=5 consecutive failures)');
    } catch (err) {
      this.log.warn(`WhatsApp outage check failed: ${(err as Error).message}`);
    }
  }
}
