import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from '../whatsapp/whatsapp-templates';

/**
 * THE DESK — the WhatsApp reply thread, server side.
 *
 * Backs the three /admin/desk/whatsapp/* routes DeskWhatsappController
 * exposes. Mirrors frontend/lib/desk-whatsapp.ts's ThreadWire and its three
 * calls exactly — read that file's header before changing anything here:
 * registry templates only, no free text ever (not even inside the 24-hour
 * window), fail closed on every gate, and the MSISDN is masked before it
 * leaves this file, not just at the client boundary.
 *
 * ⚠️ THE CARD ITSELF LIVES IN desk.service.ts, NOT HERE. desk-emitters.spec.ts
 * greps desk.service.ts's own source for `type: 'whatsapp_reply'` to prove the
 * catalogue is not outrunning the wire, so the pile assembly has to be a
 * literal in that file. This service only answers the drawer once a card has
 * been clicked.
 */

interface TxForVars {
  id: string;
  orderReference: string | null;
  trackingReference: string | null;
  carrierDropoffPin: string | null;
  carrierProvider: string | null;
  shippingStatus: string | null;
  estimatedDeliveryAt: Date | null;
  listing: { title: string | null } | null;
}

const TX_SELECT = {
  id: true,
  orderReference: true,
  trackingReference: true,
  carrierDropoffPin: true,
  carrierProvider: true,
  shippingStatus: true,
  estimatedDeliveryAt: true,
  listing: { select: { title: true } },
} as const;

export interface WhatsappTemplateWire {
  key: string;
  label: string;
  preview: string | null;
  ready: boolean;
  blockedReason: string | null;
}

@Injectable()
export class DeskWhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * A transaction's operator-facing reference.
   *
   * ⚠️ SAME FALLBACK AS DeskService.txRef, duplicated rather than shared —
   * the two files have no common base to hang it on, and this is the format
   * every other admin surface already quotes. See that method's own comment
   * for why transactions carry no reference scheme of their own.
   */
  private orderRef(tx: { orderReference: string | null; id: string }): string {
    return tx.orderReference ?? tx.id.slice(-8).toUpperCase();
  }

  /**
   * "+27 82 ··· ··41" — the same shape frontend/lib/desk-whatsapp.ts's
   * maskMsisdn draws. Computed here too, deliberately: defence in depth
   * means the raw MSISDN never reaches the wire even if a future edit on
   * either side forgets to mask it. Anything unparseable comes back fully
   * masked rather than printed raw.
   */
  private maskPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 4) return '+27 ··· ··· ··';
    const last2 = digits.slice(-2);
    const national = digits.startsWith('27')
      ? digits.slice(2)
      : digits.startsWith('0')
        ? digits.slice(1)
        : digits;
    const network = national.slice(0, 2);
    return `+27 ${network} ··· ··${last2}`;
  }

  /** The whatsapp_enabled kill switch, as this process sees it right now. */
  private async whatsappEnabled(): Promise<boolean> {
    return this.prisma.setting
      .findUnique({ where: { key: 'whatsapp_enabled' } })
      .then((s: { value: string } | null) => s?.value === 'true')
      .catch(() => false);
  }

  /** "Wed 2 Sep" — prose, not a timestamp. Null when there is nothing to show. */
  private dueLine(tx: TxForVars): string | null {
    if (!tx.estimatedDeliveryAt) return null;
    return tx.estimatedDeliveryAt.toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  /** "Bob Go · in transit" — prose, not identifiers. Null with nothing booked. */
  private courierLine(tx: TxForVars): string | null {
    const status = tx.shippingStatus ? tx.shippingStatus.toLowerCase().replace(/_/g, ' ') : null;
    const parts = [tx.carrierProvider, status].filter((p): p is string => Boolean(p));
    return parts.length ? parts.join(' · ') : null;
  }

  /**
   * Every var a registry template might need, filled from the order this
   * thread is linked to — never from anything an operator typed. `{}` when
   * there is no linked order, which blocks every template below.
   */
  private varsFor(tx: TxForVars | null): Record<string, string> {
    if (!tx) return {};
    const vars: Record<string, string> = { ref: this.orderRef(tx), txId: tx.id };
    if (tx.trackingReference) vars.waybill = tx.trackingReference;
    if (tx.carrierDropoffPin) vars.pin = tx.carrierDropoffPin;
    return vars;
  }

  /**
   * The whole registry, rendered against this thread's order.
   *
   * ⚠️ A MISSING PREVIEW IS A BLOCK, NOT A COSMETIC GAP — see
   * whatsapp-templates.ts's header for why `requiredVars` can never carry a
   * title, and frontend/lib/desk-whatsapp.ts's `toTemplate` for why `ready`
   * requires both the flag AND a non-null preview.
   */
  private renderTemplates(tx: TxForVars | null): WhatsappTemplateWire[] {
    const vars = this.varsFor(tx);
    return Object.values(WHATSAPP_TEMPLATES).map((def) => {
      const missing = [...def.requiredVars, ...def.linkVars].filter((k) => !vars[k]);
      const ready = missing.length === 0;
      return {
        key: def.key,
        label: def.metaName,
        preview: ready ? def.render(vars) : null,
        ready,
        blockedReason: ready
          ? null
          : !tx
            ? 'This thread is not linked to an order.'
            : `Needs: ${missing.join(', ')}.`,
      };
    });
  }

  private async loadTx(transactionId: string | null): Promise<TxForVars | null> {
    if (!transactionId) return null;
    return this.prisma.transaction.findUnique({ where: { id: transactionId }, select: TX_SELECT });
  }

  /** GET /admin/desk/whatsapp/:id */
  async fetchThread(id: string) {
    const thread = await this.prisma.whatsappThread.findUnique({
      where: { id },
      include: { messages: { orderBy: { receivedAt: 'desc' }, take: 1 } },
    });
    if (!thread) throw new NotFoundException('WhatsApp thread not found');

    const [tx, user, channelEnabled] = await Promise.all([
      this.loadTx(thread.transactionId),
      thread.userId
        ? this.prisma.user.findUnique({ where: { id: thread.userId }, select: { username: true } })
        : Promise.resolve(null),
      this.whatsappEnabled(),
    ]);

    const latest = thread.messages[0] ?? null;

    return {
      id: thread.id,
      reference: tx ? this.orderRef(tx) : null,
      // ⚠️ MASKED HERE, NOT THE RAW COLUMN. See the header note — the
      // client masks again at its own boundary, and both are deliberate.
      phone: this.maskPhone(thread.phone),
      username: user?.username ?? null,
      inboundText: latest?.body ?? '',
      inboundAt: latest?.receivedAt.toISOString() ?? null,
      windowOpenedAt: thread.windowOpenedAt.toISOString(),
      windowClosesAt: thread.windowClosesAt.toISOString(),
      channelEnabled,
      handledAt: thread.handledAt?.toISOString() ?? null,
      order: tx
        ? {
            transactionId: tx.id,
            reference: this.orderRef(tx),
            title: tx.listing?.title ?? null,
            courier: this.courierLine(tx),
            due: this.dueLine(tx),
          }
        : null,
      templates: this.renderTemplates(tx),
    };
  }

  /**
   * POST /admin/desk/whatsapp/:id/reply
   *
   * ⚠️ `templateKey` IS THE ONLY THING THAT MATTERS FROM THE CALLER. Every
   * variable the send needs is re-derived here from the order the thread is
   * linked to — see the controller's own comment for why nothing else in
   * the request body is read. Checks run in the SAME ORDER `sendGate` in
   * frontend/lib/desk-whatsapp.ts runs them (channel, then window, then the
   * template) so the two sides cannot drift about which reason wins.
   */
  async reply(id: string, templateKey: string): Promise<{ ok: true }> {
    const thread = await this.prisma.whatsappThread.findUnique({ where: { id } });
    if (!thread) throw new NotFoundException('WhatsApp thread not found');

    if (!(await this.whatsappEnabled())) {
      throw new BadRequestException(
        'The WhatsApp kill switch is off on the Site board. No template can send while it is.',
      );
    }
    if (thread.windowClosesAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'The 24-hour window has closed. This card resolves as unanswered; answer on another rail.',
      );
    }

    const key = (templateKey ?? '').trim();
    const def = WHATSAPP_TEMPLATES[key];
    if (!def) {
      throw new BadRequestException('That template cannot be sent yet.');
    }

    const tx = await this.loadTx(thread.transactionId);
    const vars = this.varsFor(tx);
    const missing = [...def.requiredVars, ...def.linkVars].filter((k) => !vars[k]);
    if (missing.length > 0) {
      throw new BadRequestException('That template cannot be sent yet.');
    }

    const result = await this.whatsapp.sendTemplate({
      to: thread.phone,
      templateKey: def.key,
      vars,
      reference: `desk-reply-${thread.id}`,
    });
    if (!result.success) {
      throw new BadRequestException(
        'The message could not be sent. Check the WhatsApp outage alert on the Site board.',
      );
    }
    return { ok: true };
  }

  /** POST /admin/desk/whatsapp/:id/handled — closes the card, sends nothing. */
  async markHandled(id: string): Promise<{ ok: true }> {
    const thread = await this.prisma.whatsappThread.findUnique({ where: { id } });
    if (!thread) throw new NotFoundException('WhatsApp thread not found');
    await this.prisma.whatsappThread.update({ where: { id }, data: { handledAt: new Date() } });
    return { ok: true };
  }
}
