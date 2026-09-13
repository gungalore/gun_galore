import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  HttpCode,
  Query,
  Body,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { verifyMetaSignature } from './whatsapp-signature';

const WINDOW_MS = 24 * 60 * 60 * 1000; // Meta's customer-service window

interface MetaMessageEntry {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
}

interface MetaStatusEntry {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ title?: string; message?: string }>;
}

interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messages?: MetaMessageEntry[];
        statuses?: MetaStatusEntry[];
      };
    }>;
  }>;
}

// Public, unguarded — Meta calls this directly. `@Controller('whatsapp')`
// mounts it at /api/whatsapp/webhook (main.ts sets the global prefix
// 'api'). Deliberately its own controller rather than folded into anything
// under AuthGuard, exactly the reason scan/ splits its handoff route out —
// a member-auth guard would 401 Meta's servers.
@Controller('whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly prisma: PrismaService) {}

  // Meta's one-time subscription handshake. Echo the challenge ONLY when
  // every one of these holds:
  //   - hub.mode === 'subscribe'
  //   - hub.verify_token === WHATSAPP_VERIFY_TOKEN
  //   - that env var is actually set (never echo against an undefined or
  //     empty token — an unset var must not become an "anything matches").
  // Anything else is a 403, never an echo.
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (
      mode === 'subscribe' &&
      expected &&
      expected.length > 0 &&
      token === expected
    ) {
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn('WhatsApp webhook verification failed — wrong/missing token');
    res.status(403).send('Forbidden');
  }

  // ⚠️ A BAD SIGNATURE RETURNS 200 WITH THE HANDLER SKIPPED, NEVER A 401 —
  // the same convention the Peach and Didit webhooks already use in this
  // codebase. Grepping application logs for 401s to find a signature
  // problem here will find nothing; look for the raised
  // WEBHOOK_SIGNATURE_INVALID AdminAlert / the warning line below instead.
  //
  // `req.rawBody` is already available — main.ts:149 creates the app with
  // `{ rawBody: true }`. Nothing to change there.
  @Post('webhook')
  @HttpCode(200)
  async receiveWebhook(@Req() req: Request, @Body() body: MetaWebhookBody) {
    const header = req.headers['x-hub-signature-256'] as string | undefined;
    const secret = process.env.WHATSAPP_APP_SECRET ?? '';
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);

    if (!verifyMetaSignature(rawBody, header, secret)) {
      this.logger.warn('WhatsApp webhook signature invalid — dropping');
      await this.alertWebhookSignatureFailure();
      return { received: true };
    }

    try {
      await this.handleWebhookBody(body);
    } catch (err) {
      this.logger.error(
        `WhatsApp webhook handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    return { received: true };
  }

  private async handleWebhookBody(body: MetaWebhookBody): Promise<void> {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        for (const message of value.messages ?? []) {
          await this.handleInboundMessage(message);
        }
        for (const status of value.statuses ?? []) {
          await this.handleStatusUpdate(status);
        }
      }
    }
  }

  // Inbound message from a member. Reuses an open thread (window still in
  // the future) for the same phone, else opens a new one — and either way
  // extends the 24h customer-service window from THIS message, since that
  // is the rule the window itself exists to track. Idempotent on
  // metaMessageId: Meta redelivers webhooks, and writing the same inbound
  // message twice would double-count the Desk's unread thread list.
  private async handleInboundMessage(message: MetaMessageEntry): Promise<void> {
    if (!message.from) return;
    const phone = message.from.startsWith('+') ? message.from : `+${message.from}`;

    if (message.id) {
      const dup = await this.prisma.whatsappInboundMessage.findFirst({
        where: { metaMessageId: message.id },
        select: { id: true },
      });
      if (dup) return; // already recorded — Meta redelivered
    }

    const now = new Date();
    let thread = await this.prisma.whatsappThread.findFirst({
      where: { phone, windowClosesAt: { gt: now } },
      orderBy: { windowClosesAt: 'desc' },
    });
    if (!thread) {
      thread = await this.prisma.whatsappThread.create({
        data: {
          phone,
          windowOpenedAt: now,
          windowClosesAt: new Date(now.getTime() + WINDOW_MS),
        },
      });
    } else {
      thread = await this.prisma.whatsappThread.update({
        where: { id: thread.id },
        data: {
          windowOpenedAt: now,
          windowClosesAt: new Date(now.getTime() + WINDOW_MS),
        },
      });
    }

    await this.prisma.whatsappInboundMessage.create({
      data: {
        threadId: thread.id,
        body: message.text?.body ?? '',
        metaMessageId: message.id,
      },
    });
  }

  // Delivery-status callback for a message WE sent. Matches on Meta's wamid
  // (WhatsappMessageLog.messageId, stamped at send time). A status for a
  // message we have no log row for (e.g. a very old send, or a test number)
  // is silently ignored rather than erroring — there is nothing to update.
  private async handleStatusUpdate(status: MetaStatusEntry): Promise<void> {
    if (!status.id || !status.status) return;
    const row = await this.prisma.whatsappMessageLog.findFirst({
      where: { messageId: status.id },
      select: { id: true },
    });
    if (!row) return;

    const failed = status.status === 'failed';
    await this.prisma.whatsappMessageLog.update({
      where: { id: row.id },
      data: {
        status: status.status.toUpperCase(),
        error: failed
          ? (status.errors?.[0]?.title ?? status.errors?.[0]?.message ?? 'delivery failed')
          : undefined,
      },
    });
  }

  // Mirrors TransactionsService.alertWebhookSignatureFailure (see
  // transactions.service.ts:1255) — same AdminAlert type, so the Desk's
  // alert list groups every signature-verification failure together
  // regardless of which webhook raised it. Deduped by "not yet resolved",
  // no time window: an admin resolving it is the only way to see it again,
  // which is deliberate — a live signing-secret mismatch should nag until
  // someone fixes it, not go quiet after 6h and let deliveries keep dropping
  // unnoticed.
  private async alertWebhookSignatureFailure(): Promise<void> {
    try {
      const existing = await this.prisma.adminAlert.count({
        where: {
          type: 'WEBHOOK_SIGNATURE_INVALID',
          referenceId: 'whatsapp',
          resolved: false,
        },
      });
      if (existing > 0) return;
      await this.prisma.adminAlert.create({
        data: {
          type: 'WEBHOOK_SIGNATURE_INVALID',
          referenceId: 'whatsapp',
          urgent: true,
          context:
            `Incoming "whatsapp" webhook FAILED signature verification and was dropped. ` +
            `If this repeats, WHATSAPP_APP_SECRET is wrong or the raw-body pipeline broke — ` +
            `inbound member replies and delivery-status updates will silently stop arriving. ` +
            `Check the App Secret in Meta's console against WHATSAPP_APP_SECRET. This alert ` +
            `fires once until resolved.`,
        },
      });
      this.logger.error('WhatsApp webhook signature failure alert raised');
    } catch (err) {
      this.logger.warn(
        `alertWebhookSignatureFailure(whatsapp) failed: ${(err as Error).message}`,
      );
    }
  }
}
