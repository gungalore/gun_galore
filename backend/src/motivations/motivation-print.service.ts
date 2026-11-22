import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MotivationPaymentStatus,
  MotivationPrintStatus,
  MotivationStatus,
  Province,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PROVINCE_LONG } from '../common/province-labels';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShippingService } from '../shipping/shipping.service';
import {
  printDeskEmail,
  printParcel,
  printPickupAddress,
  printPickupContact,
  type MotivationFulfilmentMode,
  type PrintDeliveryAddress,
} from './motivation-print.constants';
import { EDITABLE } from './motivation-shared.service';
import { MotivationRenderService } from './motivation-render.service';

/**
 * PRINT AND DELIVER — the fulfilment half of a motivation sale.
 *
 * ⚠️ THERE IS NO SECOND PAYMENT HERE. The member pays ONE Yoco amount at the
 * pack checkout (document + R75 print + courier); `MotivationPayment` owns that
 * money and this service owns what happens after it is captured. The order is
 * created beside the checkout so the amount is computed from a live quote, and
 * it is marked PAID inside the same transaction that marks the payment PAID.
 *
 * ⚠️ THE PDF GOES TO THE DESK ONLY AFTER THE DOCUMENT EXISTS. Generation runs
 * after payment; on completion this service renders the PDF, emails it with the
 * customer's details, and leaves the row in PAID until a human prints it and
 * presses "Book Bob Go collection". Nothing here books a courier
 * automatically — a parcel cannot be collected before it is printed.
 *
 * The digital document remains downloadable throughout: nothing in this service
 * gates `renderPdf` or the member's Download button.
 */

/** What the pack screen needs to price a Print-and-Deliver checkout. */
export interface MotivationPrintQuote {
  motivationCents: number;
  printFeeCents: number;
  shippingCents: number;
  totalCents: number;
  serviceName: string;
  deliveryDaysMin?: number;
  deliveryDaysMax?: number;
}

export interface PreparedPrintCheckout {
  orderId: string;
  reference: string;
  printFeeCents: number;
  shippingCents: number;
  totalCents: number;
}

/** How many pending Print-and-Deliver attempts one pack keeps live. */
const REUSE_ORDER_MS = 20 * 60 * 1000;

const ADDRESS_PROVINCES = new Set(Object.values(Province));

@Injectable()
export class MotivationPrintService {
  private readonly logger = new Logger(MotivationPrintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly shipping: ShippingService,
    private readonly render: MotivationRenderService,
    private readonly notifications: NotificationsService,
  ) {}

  async feeCents(): Promise<number> {
    return this.settings.get(FLAGS.motivationPrintFeeCents);
  }

  /**
   * The second choice: Print / Download or Print and Deliver.
   *
   * ⚠️ EDITABLE UNTIL PAID, NEVER AFTER. The fulfilment is part of what the
   * single Yoco amount buys, so changing it after capture would mean the money
   * no longer matches the promise. A change also cancels any un-paid print
   * order, so the next checkout prices the new choice from scratch.
   */
  async setFulfilment(
    userId: string,
    motivationId: string,
    mode: MotivationFulfilmentMode,
  ): Promise<{ mode: MotivationFulfilmentMode }> {
    const row = await this.prisma.motivation.findFirst({
      where: { id: motivationId, userId },
      select: { status: true, billedCents: true, paidAt: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (
      row.paidAt ||
      row.billedCents > 0 ||
      !EDITABLE.includes(row.status)
    ) {
      throw new ConflictException(
        'The fulfilment choice is locked once the application has been paid for.',
      );
    }
    const next = mode === 'DELIVER' ? 'DELIVER' : 'DIGITAL';
    await this.prisma.motivation.update({
      where: { id: motivationId },
      data: { fulfilmentMode: next },
    });
    if (next === 'DIGITAL') {
      await this.cancelPending(motivationId);
    }
    return { mode: next };
  }

  /**
   * Price the add-on for an address. No row is written.
   *
   * The caller may quote before the declaration is signed; the payment itself
   * still refuses until it is. The address is validated here rather than in the
   * controller so the same checks guard both the quote and the charge.
   */
  async quote(
    userId: string,
    motivationId: string,
    address: PrintDeliveryAddress,
  ): Promise<MotivationPrintQuote> {
    const motivation = await this.prisma.motivation.findFirst({
      where: { id: motivationId, userId },
      select: { id: true },
    });
    if (!motivation) throw new NotFoundException('Motivation not found');
    return this.quoteFor(address);
  }

  private async quoteFor(
    address: PrintDeliveryAddress,
  ): Promise<MotivationPrintQuote> {
    return (await this.priceFor(address)).quote;
  }

  /**
   * One Bob Go call, two outputs: the member-facing total and the rate token
   * that must be replayed at booking. Calling the courier twice for one
   * checkout could quote one price and store another.
   */
  private async priceFor(address: PrintDeliveryAddress): Promise<{
    quote: MotivationPrintQuote;
    serviceCode: string;
    providerSlug: string | null;
    serviceLevelCode: string | null;
  }> {
    // ⚠️ NEVER TAKE MONEY FOR A PARCEL NOBODY CAN COLLECT. Without the desk's
    // collection mobile Bob Go cannot book, so Print and Deliver is refused
    // before the quote (and therefore before any Yoco amount includes it).
    if (!printPickupContact().mobile) {
      throw new ServiceUnavailableException(
        'Print and Deliver is not open yet. Choose Print / Download, or try again shortly.',
      );
    }
    const clean = this.requireAddress(address);
    const motivationCents = await this.settings.get(FLAGS.motivationPriceCents);
    const printFeeCents = await this.feeCents();
    const priced = await this.shipping.quotePrivateDelivery({
      collection: printPickupAddress(),
      delivery: {
        streetAddress: clean.streetAddress,
        suburb: clean.suburb,
        city: clean.city,
        postalCode: clean.postalCode,
        province: clean.province,
      },
      parcel: printParcel(),
      // Documents: cover the print fee and the base price, not the carriage.
      declaredValueCents: motivationCents + printFeeCents,
      description: 'Printed motivation — A4 envelope',
    });
    return {
      quote: {
        motivationCents,
        printFeeCents,
        shippingCents: priced.priceCents,
        totalCents: motivationCents + printFeeCents + priced.priceCents,
        serviceName: priced.serviceName,
        ...(priced.deliveryDaysMin != null
          ? { deliveryDaysMin: priced.deliveryDaysMin }
          : {}),
        ...(priced.deliveryDaysMax != null
          ? { deliveryDaysMax: priced.deliveryDaysMax }
          : {}),
      },
      serviceCode: priced.serviceCode,
      providerSlug: priced.providerSlug ?? null,
      serviceLevelCode: priced.serviceLevelCode ?? null,
    };
  }

  /**
   * Create (or reuse) the fulfilment row for the checkout the member is about
   * to be sent to. Called by `MotivationPaymentsService.start` AFTER every
   * refusal check and BEFORE the Yoco call, so a failed checkout leaves no
   * payable order behind.
   */
  async prepareForPayment(input: {
    userId: string;
    motivationId: string;
    address: PrintDeliveryAddress;
  }): Promise<PreparedPrintCheckout> {
    const motivation = await this.prisma.motivation.findFirst({
      where: { id: input.motivationId, userId: input.userId },
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        fulfilmentMode: true,
      },
    });
    if (!motivation) throw new NotFoundException('Motivation not found');
    if (this.normalise(motivation.fulfilmentMode) !== 'DELIVER') {
      throw new ConflictException(
        'Choose "Print and Deliver" before starting this checkout.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        phone: true,
      },
    });
    if (!user) throw new NotFoundException('Account not found');
    if (!user.phone?.trim()) {
      throw new ConflictException({
        code: 'motivation-print-phone-required',
        message:
          'Add a mobile number to your account so the courier can reach you.',
      });
    }

    const address = this.requireAddress(input.address);
    const priced = await this.priceFor(address);
    const quote = priced.quote;
    const addressJson = address as unknown as object;
    const reusable = await this.prisma.motivationPrintOrder.findFirst({
      where: {
        motivationId: motivation.id,
        userId: input.userId,
        status: MotivationPrintStatus.AWAITING_PAYMENT,
        totalCents: quote.totalCents,
        createdAt: { gt: new Date(Date.now() - REUSE_ORDER_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      reusable &&
      JSON.stringify(reusable.deliveryAddress) === JSON.stringify(addressJson)
    ) {
      return {
        orderId: reusable.id,
        reference: reusable.reference,
        printFeeCents: reusable.printFeeCents,
        shippingCents: reusable.shippingCents,
        totalCents: reusable.totalCents,
      };
    }

    // A different address or price supersedes the previous un-paid attempt.
    await this.prisma.motivationPrintOrder.updateMany({
      where: {
        motivationId: motivation.id,
        status: MotivationPrintStatus.AWAITING_PAYMENT,
      },
      data: { status: MotivationPrintStatus.CANCELLED },
    });

    const reference = `PR${Date.now().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    const contactName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      'The applicant';
    const order = await this.prisma.motivationPrintOrder.create({
      data: {
        reference,
        motivationId: motivation.id,
        userId: input.userId,
        status: MotivationPrintStatus.AWAITING_PAYMENT,
        motivationCents: quote.motivationCents,
        printFeeCents: quote.printFeeCents,
        shippingCents: quote.shippingCents,
        totalCents: quote.totalCents,
        deliveryAddress: addressJson,
        contactName,
        contactPhone: user.phone.trim(),
        contactEmail: user.email,
        serviceName: quote.serviceName,
        serviceCode: priced.serviceCode,
        providerSlug: priced.providerSlug,
        serviceLevelCode: priced.serviceLevelCode,
        ...(quote.deliveryDaysMin != null
          ? { deliveryDaysMin: quote.deliveryDaysMin }
          : {}),
        ...(quote.deliveryDaysMax != null
          ? { deliveryDaysMax: quote.deliveryDaysMax }
          : {}),
      },
    });
    return {
      orderId: order.id,
      reference: order.reference,
      printFeeCents: order.printFeeCents,
      shippingCents: order.shippingCents,
      totalCents: order.totalCents,
    };
  }

  /**
   * The document is written. Render it and send it to the desk.
   *
   * Fire-and-forget from the generation success path: a mail or render failure
   * must never fail the write. The order stays PAID and the Desk can resend.
   */
  async onGenerationComplete(motivationId: string): Promise<void> {
    try {
      const order = await this.prisma.motivationPrintOrder.findFirst({
        where: {
          motivationId,
          status: MotivationPrintStatus.PAID,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!order) return;

      const motivation = await this.prisma.motivation.findUnique({
        where: { id: motivationId },
        select: {
          id: true,
          referenceNumber: true,
          outputMode: true,
          status: true,
          completedAt: true,
          userId: true,
          user: { select: { username: true } },
        },
      });
      if (!motivation || motivation.status !== MotivationStatus.COMPLETED) {
        return;
      }
      if (!order.userId) return;
      if (
        order.pdfEmailedAt &&
        motivation.completedAt &&
        order.pdfEmailedAt >= motivation.completedAt
      ) {
        return;
      }

      const pdf = await this.render.renderPdf(order.userId, motivationId);
      await this.notifications.motivationPrintOrderForOperator(
        {
          email: printDeskEmail(),
          printReference: order.reference,
          motivationReference: motivation.referenceNumber,
          outputMode: motivation.outputMode,
          username: motivation.user?.username ?? null,
          customerName: order.contactName,
          customerEmail: order.contactEmail,
          customerPhone: order.contactPhone,
          address: order.deliveryAddress as unknown as PrintDeliveryAddress,
          printFeeCents: order.printFeeCents,
          shippingCents: order.shippingCents,
          totalCents: order.totalCents,
          serviceName: order.serviceName,
        },
        pdf.pdf,
      );
      await this.prisma.motivationPrintOrder.update({
        where: { id: order.id },
        data: { pdfEmailedAt: new Date(), failureReason: null },
      });
      this.logger.log(
        `Print order ${order.reference}: PDF emailed to the desk for ${motivation.referenceNumber}`,
      );
    } catch (err) {
      this.logger.error(
        `Print order email failed for ${motivationId}: ${(err as Error).message}`,
      );
      await this.alert(
        'MOTIVATION_PRINT_EMAIL_FAILED',
        motivationId,
        `The paid print order for ${motivationId} could not be emailed to the desk: ${(err as Error).message}. The member's digital document is unaffected.`,
      );
    }
  }

  /** Re-render and re-send the operator email. */
  async resendPdf(orderId: string): Promise<void> {
    const order = await this.prisma.motivationPrintOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, motivationId: true },
    });
    if (!order) throw new NotFoundException('Print order not found');
    if (
      order.status !== MotivationPrintStatus.PAID &&
      order.status !== MotivationPrintStatus.BOOKING
    ) {
      throw new ConflictException('Only a paid, unbooked order can be re-sent.');
    }
    if (!order.motivationId) throw new ConflictException('Application missing.');
    await this.prisma.motivationPrintOrder.update({
      where: { id: orderId },
      data: { pdfEmailedAt: null },
    });
    await this.onGenerationComplete(order.motivationId);
  }

  /**
   * The desk has printed it. Claim the row, book Bob Go, tell the buyer.
   *
   * Only SUBMITTED is a booking. Bob Go answers 201 for shipments no courier
   * has accepted; that stays in BOOKING with the ids recorded so the recheck
   * cron (or the button) can resolve it without creating a second shipment.
   */
  async book(orderId: string): Promise<{
    status: MotivationPrintStatus;
    trackingReference?: string;
  }> {
    const claimed = await this.prisma.motivationPrintOrder.updateMany({
      where: {
        id: orderId,
        status: MotivationPrintStatus.PAID,
        pdfEmailedAt: { not: null },
      },
      data: { status: MotivationPrintStatus.BOOKING, failureReason: null },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.motivationPrintOrder.findUnique({
        where: { id: orderId },
        select: { status: true, pdfEmailedAt: true },
      });
      if (!existing) throw new NotFoundException('Print order not found');
      throw new ConflictException(
        existing.pdfEmailedAt
          ? `This order is ${existing.status.toLowerCase()} and cannot be booked again.`
          : 'The PDF has not reached the desk yet — resend it first.',
      );
    }

    const order = await this.prisma.motivationPrintOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Print order not found');

    try {
      const contact = printPickupContact();
      if (!contact.mobile) {
        throw new ConflictException({
          code: 'motivation-print-phone-missing',
          message:
            'MOTIVATION_PRINT_PHONE is not configured, so Bob Go has no collection number. Set it in the backend environment and retry.',
        });
      }
      if (
        !order.serviceCode ||
        !order.providerSlug ||
        !order.serviceLevelCode
      ) {
        throw new ConflictException(
          'This order has no courier quote stored — it cannot be booked. Contact support.',
        );
      }
      const address = order.deliveryAddress as unknown as PrintDeliveryAddress;
      const result = await this.shipping.bookPrivateDelivery({
        collection: printPickupAddress(),
        delivery: {
          streetAddress: address.streetAddress,
          suburb: address.suburb,
          city: address.city,
          postalCode: address.postalCode,
          // Bob Go booking wants the LONG province; the snapshot holds the
          // Prisma enum. The quote path already converts it the same way.
          province: PROVINCE_LONG[address.province] ?? address.province,
          type: 'residential',
        },
        collectionContact: contact,
        deliveryContact: {
          name: order.contactName,
          mobile: order.contactPhone,
          email: order.contactEmail,
        },
        parcel: printParcel(),
        declaredValueCents: order.motivationCents + order.printFeeCents,
        serviceCode: order.serviceCode,
        providerSlug: order.providerSlug,
        serviceLevelCode: order.serviceLevelCode,
        customerReference: order.reference,
        instructionsCollection:
          'Printed motivation — A4 envelope, under 1 kg. Please collect from reception.',
        instructionsDelivery: 'Documents — please do not bend.',
      });

      if (result.submission === 'SUBMITTED') {
        await this.prisma.motivationPrintOrder.update({
          where: { id: order.id },
          data: {
            status: MotivationPrintStatus.BOOKED,
            bookedAt: new Date(),
            bobgoShipmentId: result.shipmentId,
            bobgoTrackingReference: result.trackingReference,
            waybillPin: result.pin ?? null,
            failureReason: null,
          },
        });
        await this.notifyBuyerBooked(order, result.trackingReference);
        this.logger.log(
          `Print order ${order.reference}: Bob Go booked, tracking ${result.trackingReference}`,
        );
        return {
          status: MotivationPrintStatus.BOOKED,
          trackingReference: result.trackingReference,
        };
      }

      // PENDING or FAILED — never claim a shipment the courier has not accepted.
      await this.prisma.motivationPrintOrder.update({
        where: { id: order.id },
        data: {
          status:
            result.submission === 'PENDING'
              ? MotivationPrintStatus.BOOKING
              : MotivationPrintStatus.PAID,
          bobgoShipmentId: result.shipmentId || null,
          bobgoTrackingReference: result.trackingReference || null,
          waybillPin: result.pin ?? null,
          failureReason:
            result.failedReason ??
            (result.submission === 'PENDING'
              ? 'Bob Go has not assigned a courier yet.'
              : 'Bob Go refused the collection.'),
        },
      });
      await this.alert(
        'MOTIVATION_PRINT_BOOKING_PENDING',
        order.motivationId ?? order.id,
        `Bob Go returned ${result.submission} for print order ${order.reference}${
          result.failedReason ? `: ${result.failedReason}` : ''
        }.`,
        result.submission === 'FAILED',
      );
      return {
        status:
          result.submission === 'PENDING'
            ? MotivationPrintStatus.BOOKING
            : MotivationPrintStatus.PAID,
      };
    } catch (err) {
      // Never leave a claimed row that nobody can retry.
      await this.prisma.motivationPrintOrder
        .updateMany({
          where: { id: order.id, status: MotivationPrintStatus.BOOKING },
          data: {
            status: MotivationPrintStatus.PAID,
            failureReason: (err as Error).message.slice(0, 500),
          },
        })
        .catch(() => undefined);
      await this.alert(
        'MOTIVATION_PRINT_BOOKING_FAILED',
        order.motivationId ?? order.id,
        `Bob Go booking failed for print order ${order.reference}: ${(err as Error).message}`,
        true,
      );
      if (err instanceof ConflictException) throw err;
      throw new ServiceUnavailableException(
        'Bob Go could not book the collection. The order is still paid — try again or check the courier portal.',
      );
    }
  }

  /** 5-minute backstop for a booking Bob Go had not accepted yet. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async resolvePendingBookings(): Promise<void> {
    try {
      const pending = await this.prisma.motivationPrintOrder.findMany({
        where: {
          status: MotivationPrintStatus.BOOKING,
          bobgoShipmentId: { not: null },
          updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
        },
        take: 10,
        orderBy: { updatedAt: 'asc' },
      });
      for (const order of pending) {
        try {
          const result = await this.shipping.recheckPrivateDelivery(
            Number(order.bobgoShipmentId),
          );
          if (result.submission === 'SUBMITTED') {
            await this.prisma.motivationPrintOrder.update({
              where: { id: order.id },
              data: {
                status: MotivationPrintStatus.BOOKED,
                bookedAt: new Date(),
                bobgoTrackingReference: result.trackingReference,
                waybillPin: result.pin ?? null,
                failureReason: null,
              },
            });
            await this.notifyBuyerBooked(order, result.trackingReference);
          } else if (result.submission === 'FAILED') {
            await this.prisma.motivationPrintOrder.update({
              where: { id: order.id },
              data: {
                status: MotivationPrintStatus.PAID,
                failureReason:
                  result.failedReason ?? 'Bob Go refused the collection.',
              },
            });
            await this.alert(
              'MOTIVATION_PRINT_BOOKING_FAILED',
              order.motivationId ?? order.id,
              `Bob Go refused print order ${order.reference}: ${
                result.failedReason ?? 'no reason given'
              }`,
              true,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Print order ${order.reference}: booking recheck failed — ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Print booking recheck sweep failed: ${(err as Error).message}`,
      );
    }
  }

  /** Re-read a BOOKING order on demand (the Desk's Re-check button). */
  async recheckBooking(orderId: string): Promise<{ status: MotivationPrintStatus }> {
    const order = await this.prisma.motivationPrintOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Print order not found');
    if (order.status !== MotivationPrintStatus.BOOKING || !order.bobgoShipmentId) {
      return { status: order.status };
    }
    const result = await this.shipping.recheckPrivateDelivery(
      Number(order.bobgoShipmentId),
    );
    if (result.submission === 'SUBMITTED') {
      await this.prisma.motivationPrintOrder.update({
        where: { id: order.id },
        data: {
          status: MotivationPrintStatus.BOOKED,
          bookedAt: new Date(),
          bobgoTrackingReference: result.trackingReference,
          waybillPin: result.pin ?? null,
          failureReason: null,
        },
      });
      await this.notifyBuyerBooked(order, result.trackingReference);
      return { status: MotivationPrintStatus.BOOKED };
    }
    if (result.submission === 'FAILED') {
      await this.prisma.motivationPrintOrder.update({
        where: { id: order.id },
        data: {
          status: MotivationPrintStatus.PAID,
          failureReason:
            result.failedReason ?? 'Bob Go refused the collection.',
        },
      });
      await this.alert(
        'MOTIVATION_PRINT_BOOKING_FAILED',
        order.motivationId ?? order.id,
        `Bob Go refused print order ${order.reference}: ${
          result.failedReason ?? 'no reason given'
        }`,
        true,
      );
      return { status: MotivationPrintStatus.PAID };
    }
    return { status: MotivationPrintStatus.BOOKING };
  }

  /** The pack screen's print status: fee plus the latest non-pending order. */
  async state(userId: string, motivationId: string) {
    const motivation = await this.prisma.motivation.findFirst({
      where: { id: motivationId, userId },
      select: { id: true },
    });
    if (!motivation) throw new NotFoundException('Motivation not found');
    return {
      feeCents: await this.feeCents(),
      order: await this.stateForSheet(motivationId),
    };
  }

  /** The desk queue. */
  async listForAdmin(statuses?: MotivationPrintStatus[]) {
    const where = statuses?.length ? { status: { in: statuses } } : {};
    return this.prisma.motivationPrintOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        reference: true,
        status: true,
        totalCents: true,
        printFeeCents: true,
        shippingCents: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        deliveryAddress: true,
        serviceName: true,
        pdfEmailedAt: true,
        bookedAt: true,
        bobgoTrackingReference: true,
        deliveredAt: true,
        failureReason: true,
        createdAt: true,
        motivation: {
          select: {
            id: true,
            referenceNumber: true,
            outputMode: true,
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  /** The summary the pack screen renders. Null when no print order exists. */
  async stateForSheet(motivationId: string) {
    const order = await this.prisma.motivationPrintOrder.findFirst({
      where: {
        motivationId,
        status: { not: MotivationPrintStatus.AWAITING_PAYMENT },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        reference: true,
        status: true,
        totalCents: true,
        pdfEmailedAt: true,
        bobgoTrackingReference: true,
        deliveredAt: true,
      },
    });
    return order;
  }

  /**
   * One print order per paid application: once one is PAID, the attempt that
   * captured the money cancels every sibling still waiting.
   */
  async markPaid(printOrderId: string): Promise<void> {
    await this.prisma.motivationPrintOrder.updateMany({
      where: { id: printOrderId, status: MotivationPrintStatus.AWAITING_PAYMENT },
      data: { status: MotivationPrintStatus.PAID },
    });
    const order = await this.prisma.motivationPrintOrder.findUnique({
      where: { id: printOrderId },
      select: { motivationId: true },
    });
    if (order?.motivationId) {
      await this.prisma.motivationPrintOrder.updateMany({
        where: {
          motivationId: order.motivationId,
          status: MotivationPrintStatus.AWAITING_PAYMENT,
          id: { not: printOrderId },
        },
        data: { status: MotivationPrintStatus.CANCELLED },
      });
    }
  }

  /** Called by the payments service when a pending checkout is superseded. */
  async cancelPending(motivationId: string): Promise<void> {
    await this.prisma.motivationPrintOrder.updateMany({
      where: {
        motivationId,
        status: MotivationPrintStatus.AWAITING_PAYMENT,
      },
      data: { status: MotivationPrintStatus.CANCELLED },
    });
  }

  private async notifyBuyerBooked(
    order: {
      reference: string;
      motivationId: string | null;
      contactEmail: string;
      contactName: string;
      contactPhone: string;
      deliveryAddress: unknown;
      serviceName: string | null;
      bobgoTrackingReference?: string | null;
    },
    trackingReference: string,
  ): Promise<void> {
    try {
      await this.notifications.motivationPrintBookedBuyer({
        email: order.contactEmail,
        name: order.contactName,
        phone: order.contactPhone,
        printReference: order.reference,
        trackingReference,
        serviceName: order.serviceName,
        address: order.deliveryAddress as unknown as PrintDeliveryAddress,
      });
    } catch (err) {
      this.logger.warn(
        `Print order ${order.reference}: buyer booked email failed — ${(err as Error).message}`,
      );
    }
  }

  private normalise(mode: string | null | undefined): MotivationFulfilmentMode {
    return mode === 'DELIVER' ? 'DELIVER' : 'DIGITAL';
  }

  private requireAddress(
    address: PrintDeliveryAddress | null | undefined,
  ): PrintDeliveryAddress {
    if (!address) {
      throw new ConflictException({
        code: 'motivation-print-address-required',
        message: 'Add the address the printed copy should be delivered to.',
      });
    }
    const required: (keyof PrintDeliveryAddress)[] = [
      'streetAddress',
      'suburb',
      'city',
      'postalCode',
      'province',
    ];
    for (const key of required) {
      const value = address[key];
      if (!value || !String(value).trim()) {
        throw new ConflictException({
          code: 'motivation-print-address-incomplete',
          message:
            'The delivery address is incomplete — street, suburb, city, postal code and province are all needed.',
        });
      }
    }
    if (!ADDRESS_PROVINCES.has(address.province)) {
      throw new ConflictException({
        code: 'motivation-print-province-invalid',
        message: 'Choose a South African province for the delivery address.',
      });
    }
    return address;
  }

  private async alert(
    type: string,
    referenceId: string,
    context: string,
    urgent = false,
  ): Promise<void> {
    await this.prisma.adminAlert
      .create({ data: { type, referenceId, urgent, context } })
      .catch(() => undefined);
  }
}
