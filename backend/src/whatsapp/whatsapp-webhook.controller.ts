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
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { verifyMetaSignature } from './whatsapp-signature';
import { WhatsappService } from './whatsapp.service';
import { TransactionsService } from '../payments/transactions.service';
import { OffersService } from '../offers/offers.service';

// The three Private Arrangement handover templates whose quick replies map to
// order actions. Body/button text only carries the ref; the ACTION is resolved
// from the tapped message's templateKey + its vars.txId.
const PRIVATE_ARRANGE_TEMPLATES = new Set([
  'private_arrange_seller_handover',
  'private_arrange_buyer_confirm',
  'private_arrange_buyer_reminder',
]);

const WINDOW_MS = 24 * 60 * 60 * 1000; // Meta's customer-service window

// Button texts the controller acts on itself. Anything else is a free-text
// reply with no automated handler — it must reach a human, not disappear into
// a table nothing reads (the Desk surface was removed).
const HANDLED_BUTTON_TEXTS = new Set([
  'accept',
  'decline',
  'counter',
  'item delivered',
  'item received',
  'dispute',
]);

function normalisePhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

interface MetaMessageEntry {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
  };
  context?: { id?: string };
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly whatsapp?: WhatsappService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

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
  // message twice would duplicate the thread history and re-alert the
  // operator for a message they already saw.
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

    const messageText =
      message.text?.body ??
      message.button?.text ??
      message.interactive?.button_reply?.title ??
      '';
    await this.prisma.whatsappInboundMessage.create({
      data: {
        threadId: thread.id,
        body: messageText,
        metaMessageId: message.id,
      },
    });

    // Every template quick reply (private arrange, sale accept/decline,
    // offer accept/decline, counter accept/decline) is resolved from the
    // tapped message's `context.id` → our log row → templateKey + vars.
    if (message.context?.id) {
      await this.handleTemplateButton(
        phone,
        messageText.trim().toLowerCase(),
        message.context.id,
      );
    }

    // Free text has no automated handler. Store it AND surface it to the
    // operator, otherwise WhatsApp becomes a write-only inbox: members reply
    // to a sales message and nobody ever sees it.
    if (
      messageText.trim().length > 0 &&
      !HANDLED_BUTTON_TEXTS.has(messageText.trim().toLowerCase())
    ) {
      await this.raiseInboundAlert(phone, messageText.trim());
    }
  }

  /**
   * One unresolved AdminAlert per phone number, refreshed with the latest
   * message. Deduped deliberately: a chatty member must not create a new
   * alert for every line. The full thread is in WhatsappInboundMessage.
   */
  private async raiseInboundAlert(phone: string, text: string): Promise<void> {
    try {
      const existing = await this.prisma.adminAlert.findFirst({
        where: {
          type: 'WHATSAPP_INBOUND_MESSAGE',
          referenceId: phone,
          resolved: false,
        },
        select: { id: true },
      });
      const context =
        `Inbound WhatsApp from ${phone}: "${text.slice(0, 500)}". ` +
        `Reply from the WhatsApp Business app; no member-facing action is automated.`;
      if (existing) {
        await this.prisma.adminAlert.update({
          where: { id: existing.id },
          data: { context },
        });
        return;
      }
      await this.prisma.adminAlert.create({
        data: {
          type: 'WHATSAPP_INBOUND_MESSAGE',
          referenceId: phone,
          urgent: false,
          context,
        },
      });
    } catch (err) {
      this.logger.warn(
        `raiseInboundAlert failed (${phone}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * A template quick reply. Resolve the exact outbound message from Meta's
   * `context.id`, verify the tap came from the phone we sent it to, then route
   * the button text to the right party's action. Never throws — the webhook
   * must always answer 200.
   *
   * The body/button only carries the action; identity comes from the message
   * log row and the sender's WhatsApp number. The first tap of the inbound
   * message also opens Meta's 24h window, which is why the confirmation can be
   * a free-form session reply instead of another paid template.
   */
  private async handleTemplateButton(
    senderPhone: string,
    buttonText: string,
    repliedToMessageId: string,
  ): Promise<void> {
    let sent:
      | { to: string; templateKey: string; vars: unknown }
      | null = null;
    try {
      sent = await this.prisma.whatsappMessageLog.findFirst({
        where: { messageId: repliedToMessageId },
        select: { to: true, templateKey: true, vars: true },
      });
    } catch (err) {
      this.logger.warn(
        `template-button lookup failed: ${(err as Error).message}`,
      );
      return;
    }
    if (!sent) return;
    // The tap must come from the phone we sent THIS message to.
    if (normalisePhone(sent.to) !== normalisePhone(senderPhone)) return;

    const vars = (sent.vars ?? {}) as Record<string, unknown>;

    if (PRIVATE_ARRANGE_TEMPLATES.has(sent.templateKey)) {
      await this.handlePrivateArrangeButton(
        senderPhone,
        buttonText,
        repliedToMessageId,
      );
      return;
    }

    if (sent.templateKey === 'new_sale_seller_courier') {
      // Decline keeps the existing reason-picker: a paid-sale rejection
      // records a strike, so a default reason is the wrong default there.
      if (buttonText === 'decline') {
        await this.handleCourierSaleDecline(senderPhone, repliedToMessageId);
        return;
      }
      if (buttonText === 'accept') {
        await this.actOnSale(senderPhone, sent.templateKey, vars, 'accept');
      }
      return;
    }

    if (
      sent.templateKey === 'new_sale_seller' ||
      sent.templateKey === 'sale_accept_reminder_seller'
    ) {
      if (buttonText !== 'accept' && buttonText !== 'decline') return;
      await this.actOnSale(senderPhone, sent.templateKey, vars, buttonText);
      return;
    }

    if (
      sent.templateKey === 'offer_received_seller' ||
      sent.templateKey === 'offer_countered_buyer'
    ) {
      if (buttonText !== 'accept' && buttonText !== 'decline') return;
      await this.actOnOffer(senderPhone, sent.templateKey, vars, buttonText);
    }
  }

  private getTransactions(): TransactionsService | null {
    try {
      return (
        this.moduleRef?.get(TransactionsService, { strict: false }) ?? null
      );
    } catch {
      return null;
    }
  }

  private getOffers(): OffersService | null {
    try {
      return this.moduleRef?.get(OffersService, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

  private appBase(): string {
    return process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za';
  }

  /**
   * Resolve a template `code` to the page that performs it. `a<token>` is the
   * signed-out action page; `t<txId>` is the transaction page (sign-in).
   */
  private actionPageUrl(code: string): string {
    if (code.startsWith('a')) return `${this.appBase()}/a/${code.slice(1)}`;
    if (code.startsWith('t')) {
      return `${this.appBase()}/transactions/${code.slice(1)}`;
    }
    return this.appBase();
  }

  private async sessionReply(
    to: string,
    text: string,
    reference: string,
  ): Promise<void> {
    if (!this.whatsapp) return;
    try {
      await this.whatsapp.sendSessionText({ to, text, reference });
    } catch (err) {
      this.logger.warn(
        `session reply failed (${reference}): ${(err as Error).message}`,
      );
    }
  }

  private stringVar(
    vars: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = vars[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private async actOnSale(
    senderPhone: string,
    templateKey: string,
    vars: Record<string, unknown>,
    action: 'accept' | 'decline',
  ): Promise<void> {
    const txId = this.stringVar(vars, 'txId');
    if (!txId) return;

    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: {
        sellerId: true,
        seller: { select: { phone: true } },
      },
    });
    if (
      !tx ||
      normalisePhone(tx.seller.phone) !== normalisePhone(senderPhone)
    ) {
      return;
    }

    const transactions = this.getTransactions();
    if (!transactions) return;

    try {
      if (action === 'accept') {
        // No schedule = acceptTransaction's existing default (the soonest
        // valid courier pickup day). The URL button still opens the date
        // picker for a seller who wants a later day.
        await transactions.acceptTransaction(txId, tx.sellerId);
        await this.sessionReply(
          senderPhone,
          "Sale accepted. The buyer has been notified and your pickup details are on the sale page. If you want a later collection day, open the original message and choose a date.",
          `wa-sale-accept-${txId}`,
        );
      } else {
        // Decline has consequences (a seller strike + refund), and the email
        // and SMS links open the reason picker. Do the same here instead of
        // silently choosing a default reason.
        const code = this.stringVar(vars, 'code');
        if (code?.startsWith('a')) {
          await this.sessionReply(
            senderPhone,
            `Choose a reason to decline this sale: ${this.actionPageUrl(code)}`,
            `wa-sale-decline-${txId}`,
          );
          return;
        }
        await this.sessionReply(
          senderPhone,
          `Open the sale to decline it: ${this.appBase()}/transactions/${txId}`,
          `wa-sale-decline-${txId}`,
        );
        return;
      }
    } catch (err) {
      this.logger.warn(
        `WhatsApp ${action} failed for ${templateKey}/${txId}: ${(err as Error).message}`,
      );
      await this.sessionReply(
        senderPhone,
        `We couldn't ${action} that sale: ${(err as Error).message}`,
        `wa-sale-${action}-failed-${txId}`,
      );
    }
  }

  private async actOnOffer(
    senderPhone: string,
    templateKey: string,
    vars: Record<string, unknown>,
    action: 'accept' | 'decline',
  ): Promise<void> {
    const offerId = this.stringVar(vars, 'offerId');
    if (!offerId) return;

    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: {
        buyerId: true,
        buyer: { select: { phone: true } },
        listing: {
          select: {
            sellerId: true,
            seller: { select: { phone: true } },
          },
        },
      },
    });
    if (!offer) return;

    const sellerSide = templateKey === 'offer_received_seller';
    const actorPhone = sellerSide
      ? offer.listing.seller.phone
      : offer.buyer.phone;
    if (normalisePhone(actorPhone) !== normalisePhone(senderPhone)) return;

    const offers = this.getOffers();
    if (!offers) return;

    try {
      if (sellerSide) {
        if (action === 'accept') {
          await offers.accept(offer.listing.sellerId, offerId);
          await this.sessionReply(
            senderPhone,
            'Offer accepted. The buyer has been sent a payment link.',
            `wa-offer-accept-${offerId}`,
          );
        } else {
          // The ticklist requires a structured reason and the choice decides
          // whether the rejection strikes the buyer. Email and SMS open that
          // reason picker; do the same here instead of defaulting to OTHER.
          const code = this.stringVar(vars, 'code');
          if (code?.startsWith('a')) {
            await this.sessionReply(
              senderPhone,
              `Choose a reason to decline this offer: ${this.actionPageUrl(code)}`,
              `wa-offer-decline-${offerId}`,
            );
            return;
          }
          await this.sessionReply(
            senderPhone,
            `Open your offers to decline it: ${this.appBase()}/offers/received`,
            `wa-offer-decline-${offerId}`,
          );
          return;
        }
      } else if (action === 'accept') {
        await offers.acceptCounter(offer.buyerId, offerId);
        await this.sessionReply(
          senderPhone,
          'Counter accepted. We have sent your payment link.',
          `wa-counter-accept-${offerId}`,
        );
      } else {
        await offers.rejectCounter(offer.buyerId, offerId);
        await this.sessionReply(
          senderPhone,
          'Counter declined. The seller has been notified.',
          `wa-counter-decline-${offerId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `WhatsApp ${action} failed for ${templateKey}/${offerId}: ${(err as Error).message}`,
      );
      await this.sessionReply(
        senderPhone,
        `We couldn't ${action} that offer: ${(err as Error).message}`,
        `wa-offer-${action}-failed-${offerId}`,
      );
    }
  }

  /**
   * A Private Arrangement handover quick reply. The button text only carries
   * the action; we resolve the exact order from the tapped message (Meta
   * context.id → our log row), verify the sender is the intended recipient,
   * then run the action. Never throws — the webhook must always 200.
   */
  private async handlePrivateArrangeButton(
    senderPhone: string,
    buttonText: string,
    repliedToMessageId: string,
  ): Promise<void> {
    const action =
      buttonText === 'item delivered'
        ? 'delivered'
        : buttonText === 'item received'
          ? 'received'
          : buttonText === 'dispute'
            ? 'dispute'
            : null;
    if (!action) return;

    let txIdForReply: string | null = null;
    try {
      const sent = await this.prisma.whatsappMessageLog.findFirst({
        where: { messageId: repliedToMessageId },
        select: { to: true, templateKey: true, vars: true },
      });
      if (!sent || !PRIVATE_ARRANGE_TEMPLATES.has(sent.templateKey)) return;
      // The tap must come from the phone we sent THIS message to.
      if (normalisePhone(sent.to) !== normalisePhone(senderPhone)) return;

      const vars = sent.vars as Record<string, unknown> | null;
      const txId = typeof vars?.txId === 'string' ? vars.txId : null;
      if (!txId) return;
      txIdForReply = txId;

      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        select: { buyerId: true, sellerId: true, shippingMethod: true },
      });
      if (!tx || tx.shippingMethod !== 'PRIVATE_ARRANGE') return;

      // Resolved lazily: PaymentsModule (TransactionsService) is not a static
      // import of this module, so an isolated boot spec stays green.
      let transactions: TransactionsService;
      try {
        if (!this.moduleRef) return;
        transactions = this.moduleRef.get(TransactionsService, { strict: false });
      } catch {
        return;
      }
      if (!transactions) return;

      const fromSeller = sent.templateKey === 'private_arrange_seller_handover';
      if (action === 'delivered') {
        if (!fromSeller) return;
        await transactions.markPrivateArrangeDelivered(txId, tx.sellerId);
      } else if (action === 'received') {
        if (fromSeller) return; // buyer-only action
        await transactions.confirmPrivateArrangeReceived(txId, tx.buyerId);
      } else if (action === 'dispute') {
        const userId = fromSeller ? tx.sellerId : tx.buyerId;
        await transactions.disputePrivateArrange(
          txId,
          userId,
          'Raised via WhatsApp',
        );
      }
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(
        `private-arrange WhatsApp button action failed (${buttonText}): ${message}`,
      );
      if (txIdForReply) {
        await this.sessionReply(
          senderPhone,
          `We couldn't complete that: ${message}`,
          `pa-action-${txIdForReply}`,
        );
      }
    }
  }

  /**
   * A template quick reply only carries its text. Resolve the exact outbound
   * courier-sale message via Meta's context.id (wamid), then verify both the
   * token's seller and the sender phone before returning a reason-picker link.
   * The rejection itself is deliberately completed on the token-gated page,
   * where the seller chooses one of the recorded reasons (or custom text).
   */
  private async handleCourierSaleDecline(
    senderPhone: string,
    repliedToMessageId: string,
  ): Promise<void> {
    if (!this.whatsapp) return;
    const sent = await this.prisma.whatsappMessageLog.findFirst({
      where: { messageId: repliedToMessageId },
      select: { id: true, to: true, templateKey: true, vars: true },
    });
    if (!sent || sent.templateKey !== 'new_sale_seller_courier') return;
    if (normalisePhone(sent.to) !== normalisePhone(senderPhone)) return;

    const vars = sent.vars as Record<string, unknown> | null;
    const actionToken = vars?.acceptToken;
    if (typeof actionToken !== 'string' || !actionToken) return;

    const action = await this.prisma.actionToken.findUnique({
      where: { token: actionToken },
      select: {
        purpose: true,
        targetType: true,
        targetId: true,
        authorisedUserId: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (
      !action ||
      action.purpose !== 'TRANSACTION_ACCEPT' ||
      action.targetType !== 'transaction' ||
      action.usedAt ||
      action.expiresAt <= new Date()
    ) {
      return;
    }

    const tx = await this.prisma.transaction.findUnique({
      where: { id: action.targetId },
      select: {
        sellerId: true,
        seller: { select: { phone: true } },
      },
    });
    if (
      !tx ||
      tx.sellerId !== action.authorisedUserId ||
      normalisePhone(tx.seller.phone) !== normalisePhone(senderPhone)
    ) {
      return;
    }

    const appUrl = process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za';
    await this.whatsapp.sendSessionText({
      to: senderPhone,
      reference: `new-sale-decline-${action.targetId}`,
      text:
        `To decline this sale, open ${appUrl}/a/${actionToken} and choose a reason. ` +
        `Declining records a seller strike and refunds the buyer.`,
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
