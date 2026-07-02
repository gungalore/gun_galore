import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Province } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PudoService,
  type ParcelDims,
  type ResidentialAddress,
  type ShippingQuote,
} from './pudo.service';
import { TcgService, type TcgResidentialAddress } from './tcg.service';
import { CarrierContact, CarrierShipmentResult } from './carrier.types';

export type ShippingMethod = 'PUDO' | 'TCG' | 'DEALER_TRANSFER';

// Province enum → Pudo's two-letter "zone" code. Pudo's rate engine
// uses the abbreviation to apply cross-province surcharges + estimate
// transit time. Names match SA Post Office / SAPS conventions.
const PROVINCE_ZONE: Record<Province, string> = {
  EASTERN_CAPE: 'EC',
  FREE_STATE: 'FS',
  GAUTENG: 'GP',
  KWAZULU_NATAL: 'KZN',
  LIMPOPO: 'LP',
  MPUMALANGA: 'MP',
  NORTH_WEST: 'NW',
  NORTHERN_CAPE: 'NC',
  WESTERN_CAPE: 'WC',
};

// TCG / Shiplogic expects the full province NAME (e.g. "Western Cape")
// in its `zone` field, not the abbreviation Pudo uses. Confirmed from
// the TCG Postman collection's "Getting rates" example.
const PROVINCE_LONG: Record<Province, string> = {
  EASTERN_CAPE: 'Eastern Cape',
  FREE_STATE: 'Free State',
  GAUTENG: 'Gauteng',
  KWAZULU_NATAL: 'KwaZulu-Natal',
  LIMPOPO: 'Limpopo',
  MPUMALANGA: 'Mpumalanga',
  NORTH_WEST: 'North West',
  NORTHERN_CAPE: 'Northern Cape',
  WESTERN_CAPE: 'Western Cape',
};

export interface QuoteRequestBody {
  listingId: string;
  shippingMethod: ShippingMethod;
  /** When PUDO — the buyer's chosen destination locker. */
  toLockerId?: string;
  /** When TCG — the buyer's delivery address (with coords). */
  deliveryAddress?: {
    streetAddress: string;
    suburb: string;
    city: string;
    postalCode: string;
    province: Province;
    lat: number;
    lng: number;
  };
}

// Internal status enum mirroring Prisma ShippingStatus
export type ShippingStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURNED';

// Status precedence — used to reject backward transitions (a "collected"
// event should not overwrite "delivered" if it arrives out of order).
const STATUS_RANK: Record<ShippingStatus, number> = {
  PENDING: 0,
  COLLECTED: 1,
  IN_TRANSIT: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4,
  DELIVERY_FAILED: 4,
  RETURNED: 4,
};

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly pudo: PudoService,
    private readonly tcg: TcgService,
  ) {}

  /**
   * Returns allowed shipping methods for a listing.
   * Absolute rule (CLAUDE.md): firearms → DEALER_TRANSFER only.
   */
  getDeliveryOptions(isFirearm: boolean): ShippingMethod[] {
    if (isFirearm) return ['DEALER_TRANSFER'];
    return ['PUDO', 'TCG'];
  }

  /**
   * Live rate quote for a listing. Resolves seller-side address /
   * locker from the listing row, then asks Pudo for an L2L or D2D
   * price. Returns a ShippingQuote the buyer sees on the checkout
   * breakdown and that we snapshot into Transaction.shippingCost when
   * they hit Pay.
   *
   * Throws BadRequestException with a user-readable reason if:
   *   - the listing isn't priced for marketplace shipping (firearm),
   *   - dimensions/weight haven't been captured by the seller,
   *   - the chosen method isn't one the seller offered,
   *   - the request body is missing locker / address details,
   *   - or Pudo can't quote (no box fits L2L → caller falls back to TCG).
   */
  async quoteForListing(body: QuoteRequestBody): Promise<ShippingQuote> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: body.listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.isFirearm) {
      throw new BadRequestException(
        'Firearm transfers are handled by SAPS-licensed dealers; no courier rate applies.',
      );
    }
    if (listing.collectionOnly) {
      throw new BadRequestException(
        'This item is collection-only and cannot be couriered — arrange in-person collection with the seller.',
      );
    }
    if (
      !listing.weightGrams ||
      !listing.lengthCm ||
      !listing.widthCm ||
      !listing.heightCm
    ) {
      throw new BadRequestException(
        'This listing is missing parcel weight / dimensions. Ask the seller to update it.',
      );
    }
    if (
      listing.shippingMethods.length > 0 &&
      !listing.shippingMethods.includes(body.shippingMethod)
    ) {
      throw new BadRequestException(
        `Seller is not offering ${body.shippingMethod} for this listing.`,
      );
    }

    const parcel: ParcelDims = {
      lengthCm: listing.lengthCm,
      widthCm: listing.widthCm,
      heightCm: listing.heightCm,
      weightGrams: listing.weightGrams,
    };

    if (body.shippingMethod === 'PUDO') {
      // Pudo L2L doesn't bind the parcel to a specific SOURCE locker —
      // the seller drops at any Pudo locker with the delivery PIN we
      // issue at dispatch time, and Pudo routes it to the buyer's
      // chosen destination. Rates are flat across source choice, so we
      // only need the destination locker.
      if (!body.toLockerId) {
        throw new BadRequestException('Pick a collection locker first.');
      }
      const quote = await this.pudo.quoteL2L(body.toLockerId, parcel);
      if (!quote) {
        throw new BadRequestException(
          'This parcel is too large for Pudo locker shipping. Use door delivery instead.',
        );
      }
      return quote;
    }

    if (body.shippingMethod === 'TCG') {
      if (
        !listing.pickupStreet ||
        !listing.pickupCity ||
        listing.pickupLat == null ||
        listing.pickupLng == null
      ) {
        throw new BadRequestException(
          'Seller hasn\'t provided a collection address yet.',
        );
      }
      if (!body.deliveryAddress) {
        throw new BadRequestException('Provide a delivery address first.');
      }
      // TCG runs on Shiplogic at api.portal.thecourierguy.co.za —
      // SEPARATE wallet and SEPARATE rate card from Pudo. We used to
      // route D2D through Pudo's API, which gave merchant wholesale
      // rates (~R200 minimum); TCG's retail API quotes ~R124 for the
      // same parcel because their flat-rate Economy tier isn't
      // exposed via Pudo. See tcg.service.ts.
      const from: TcgResidentialAddress = {
        streetAddress: listing.pickupStreet,
        suburb: listing.pickupSuburb ?? '',
        city: listing.pickupCity,
        postalCode: listing.pickupPostalCode ?? '',
        province: PROVINCE_LONG[listing.province],
        lat: listing.pickupLat,
        lng: listing.pickupLng,
      };
      const to: TcgResidentialAddress = {
        streetAddress: body.deliveryAddress.streetAddress,
        suburb: body.deliveryAddress.suburb,
        city: body.deliveryAddress.city,
        postalCode: body.deliveryAddress.postalCode,
        province: PROVINCE_LONG[body.deliveryAddress.province],
        lat: body.deliveryAddress.lat,
        lng: body.deliveryAddress.lng,
      };
      const tcgQuote = await this.tcg.getQuote(
        from,
        to,
        {
          weightKg: parcel.weightGrams / 1000,
          lengthCm: parcel.lengthCm,
          widthCm: parcel.widthCm,
          heightCm: parcel.heightCm,
        },
        listing.price ?? 0, // declared value — item price drives liability cover
      );
      if (!tcgQuote) {
        throw new BadRequestException(
          'No door-delivery rate available for this route right now.',
        );
      }
      // Map TCG's response shape back to the shared ShippingQuote
      // shape PudoService uses, so the caller (TransactionsService,
      // checkout-form) doesn't need to branch on courier.
      return {
        serviceCode: tcgQuote.serviceCode,
        serviceName: tcgQuote.serviceName,
        priceCents: tcgQuote.priceCents,
      };
    }

    throw new BadRequestException(
      `${body.shippingMethod} doesn't use a courier rate.`,
    );
  }

  // ------------------------------------------------------------------
  // Platform-arranged shipment booking (P5.2)
  // ------------------------------------------------------------------
  // Books the real carrier shipment for a transaction and stamps the
  // waybill + (Pudo) drop-off PIN onto it. Triggered when the seller
  // ACCEPTS a courier sale. This SPENDS the carrier wallet, so it is built
  // to be safe under retries/races and to NEVER throw into its caller:
  //
  //   • Idempotency — an atomic claim on `shipmentBookingStartedAt` (set
  //     BEFORE the wallet-billed call) means only the first caller books;
  //     a concurrent accept / re-fire is a no-op.
  //   • Scope — courier sales only. Firearms (DEALER_TRANSFER) and
  //     PRIVATE_ARRANGE never auto-book.
  //   • Fail-safe — any error releases the claim, logs, and raises an admin
  //     alert; the seller still has the manual tracking-entry fallback, so a
  //     carrier outage can't freeze a sale. The method always resolves.
  //
  // Returns the booking result on success, or null when it skipped/failed
  // (caller treats both as "no booking happened, fall back to manual").
  async bookForTransaction(
    transactionId: string,
  ): Promise<CarrierShipmentResult | null> {
    // Atomic claim — only the first caller past this point books.
    const claim = await this.prisma.transaction.updateMany({
      where: {
        id: transactionId,
        shipmentBookingStartedAt: null,
        shipmentBookedAt: null,
      },
      data: { shipmentBookingStartedAt: new Date() },
    });
    if (claim.count === 0) {
      this.logger.log(
        `bookForTransaction ${transactionId}: already booked or in progress — skipping`,
      );
      return null;
    }

    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { listing: true, buyer: true, seller: true },
      });
      if (!tx) throw new Error('transaction not found');

      // Courier sales only. Release the claim for everything else so the
      // row never looks like a stuck in-progress booking.
      if (tx.shippingMethod !== 'PUDO' && tx.shippingMethod !== 'TCG') {
        await this.releaseBookingClaim(transactionId);
        return null;
      }
      if (!tx.shippingServiceCode) {
        throw new Error(
          `${tx.shippingMethod} order has no service code — the shipping quote may be stale`,
        );
      }
      // The carrier SMSes the hand-over PIN (Pudo) / collection notice (TCG),
      // so a real mobile for BOTH parties is required. Missing → fail-safe to
      // the manual-dispatch fallback rather than book a contactless shipment
      // the carrier can't coordinate.
      if (!tx.seller.phone?.trim()) {
        throw new Error('seller has no phone on file — cannot book a courier shipment');
      }
      if (!tx.buyer.phone?.trim()) {
        throw new Error('buyer has no phone on file — cannot book a courier shipment');
      }

      // Contacts go to the CARRIER (collection/delivery coordination + the
      // PIN SMS), never exposed to the other party — so real names + phones
      // are correct and required here.
      const collectionContact: CarrierContact = {
        name:
          [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
          tx.seller.username ||
          'Seller',
        email: tx.seller.email ?? undefined,
        mobile: tx.seller.phone.trim(),
      };
      const deliveryContact: CarrierContact = {
        name:
          [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') ||
          tx.buyer.username ||
          'Buyer',
        email: tx.buyer.email ?? undefined,
        mobile: tx.buyer.phone.trim(),
      };

      let result: CarrierShipmentResult;
      if (tx.shippingMethod === 'PUDO') {
        if (!tx.pudoPickupLockerId) {
          throw new Error('no destination locker on transaction');
        }
        result = await this.pudo.createShipment({
          serviceCode: tx.shippingServiceCode,
          toLockerId: tx.pudoPickupLockerId,
          collectionContact,
          deliveryContact,
        });
      } else {
        const L = tx.listing;
        if (
          !L.pickupStreet ||
          !L.pickupCity ||
          L.pickupLat == null ||
          L.pickupLng == null
        ) {
          throw new Error('seller pickup address incomplete');
        }
        const d = tx.deliveryAddress as {
          streetAddress: string;
          suburb: string;
          city: string;
          province: Province;
          postalCode: string;
          lat?: number;
          lng?: number;
        } | null;
        // deliveryAddress is stored JSON (untrusted) — validate every field
        // the carrier needs before the wallet-billed call, and that the
        // province maps to a name TCG accepts (an unmapped province would
        // otherwise be sent as `undefined` and rejected after billing).
        if (!d?.streetAddress || !d.suburb || !d.city || !d.postalCode || !d.province) {
          throw new Error('delivery address is incomplete for courier booking');
        }
        if (!PROVINCE_LONG[d.province]) {
          throw new Error(`invalid delivery province on transaction: ${d.province}`);
        }
        result = await this.tcg.createShipment({
          serviceCode: tx.shippingServiceCode,
          from: {
            streetAddress: L.pickupStreet,
            suburb: L.pickupSuburb ?? '',
            city: L.pickupCity,
            postalCode: L.pickupPostalCode ?? '',
            province: PROVINCE_LONG[L.province],
            lat: L.pickupLat,
            lng: L.pickupLng,
          },
          to: {
            streetAddress: d.streetAddress,
            suburb: d.suburb,
            city: d.city,
            postalCode: d.postalCode,
            province: PROVINCE_LONG[d.province],
            lat: d.lat,
            lng: d.lng,
          },
          parcel: {
            weightKg: (L.weightGrams ?? 0) / 1000,
            lengthCm: L.lengthCm ?? 0,
            widthCm: L.widthCm ?? 0,
            heightCm: L.heightCm ?? 0,
          },
          declaredValueCents: L.price ?? 0,
          collectionContact,
          deliveryContact,
        });
      }

      // Persist the booking. trackingReference is the carrier waybill the
      // existing tracking poll/webhook already keys on.
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          carrierShipmentId: result.shipmentId,
          carrierDropoffPin: result.pin ?? null,
          trackingReference: result.trackingReference,
          shipmentBookedAt: new Date(),
        },
      });
      this.logger.log(
        `Shipment booked for ${transactionId}: ${result.carrier} waybill ${result.trackingReference}${result.pin ? ` (PIN ${result.pin})` : ''}`,
      );

      // Notify the seller (SMS + email + inbox) with the waybill, Pudo PIN,
      // label link, and the "write it on the package" fallback. Best-effort —
      // the booking already succeeded; a notification hiccup must not undo it.
      const sellerName =
        [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
        tx.seller.username ||
        'Seller';
      void this.notifications
        .shipmentBooked({
          sellerEmail: tx.seller.email,
          sellerName,
          sellerPhone: tx.seller.phone,
          listingTitle: tx.listing.title,
          transactionId,
          carrier: result.carrier,
          trackingReference: result.trackingReference,
          dropoffPin: result.pin ?? null,
        })
        .catch((e) => {
          this.logger.warn(
            `shipmentBooked notify failed for ${transactionId}: ${(e as Error).message}`,
          );
          // Booking is charged + persisted but the seller has no PIN/waybill
          // in hand — surface to admins (same dedup'd queue) for manual
          // follow-up. Do NOT roll back the booking (the carrier is committed).
          void this.raiseBookingFailedAlert(
            transactionId,
            'Shipment booked but seller notification failed: ' + (e as Error).message,
          );
        });
      return result;
    } catch (err) {
      // Release the claim so an admin can retry + the seller keeps the
      // manual-dispatch fallback. Never rethrow — accept must not fail
      // because the carrier did.
      await this.releaseBookingClaim(transactionId);
      this.logger.error(
        `bookForTransaction ${transactionId} failed: ${(err as Error).message}`,
      );
      await this.raiseBookingFailedAlert(transactionId, (err as Error).message);
      // Tell the seller auto-booking failed so they know to arrange dispatch
      // manually (the page already shows the manual form, but a ping helps).
      void this.notifyBookingFailedSeller(transactionId).catch(() => undefined);
      return null;
    }
  }

  // Cancel a booked shipment when a sale is reversed before hand-over (admin
  // refund / seller reject / buyer cancel). Best-effort, idempotent, never
  // throws. Only cancels while the parcel hasn't entered the network yet —
  // once COLLECTED+ it's too late, so we alert an admin to handle it manually.
  async cancelForTransaction(transactionId: string): Promise<void> {
    const tx = await this.prisma.transaction
      .findUnique({
        where: { id: transactionId },
        select: {
          shippingMethod: true,
          carrierShipmentId: true,
          shipmentBookedAt: true,
          shippingStatus: true,
        },
      })
      .catch(() => null);
    if (!tx?.shipmentBookedAt || !tx.carrierShipmentId) return; // nothing booked

    const moving =
      tx.shippingStatus && tx.shippingStatus !== 'PENDING';
    if (moving) {
      await this.raiseBookingFailedAlert(
        transactionId,
        `Sale reversed but parcel already ${tx.shippingStatus} — cancel/recover with the carrier manually`,
      );
      return;
    }

    let ok = false;
    try {
      ok =
        tx.shippingMethod === 'PUDO'
          ? await this.pudo.cancelShipment(tx.carrierShipmentId)
          : tx.shippingMethod === 'TCG'
            ? await this.tcg.cancelShipment(tx.carrierShipmentId)
            : false;
    } catch {
      ok = false;
    }

    if (ok) {
      // Clear the booking marker so the seller UI stops showing the ship
      // panel and the shipment can't be cancelled twice.
      await this.prisma.transaction
        .update({
          where: { id: transactionId },
          data: { shipmentBookedAt: null },
        })
        .catch(() => undefined);
      this.logger.log(
        `Shipment cancelled for ${transactionId} (${tx.shippingMethod} ${tx.carrierShipmentId})`,
      );
    } else {
      // Keep the marker (so the orphan stays visible) + alert for manual cleanup.
      await this.raiseBookingFailedAlert(
        transactionId,
        'Shipment cancel failed — cancel manually with the carrier to reclaim the wallet charge',
      );
    }
  }

  private async notifyBookingFailedSeller(transactionId: string): Promise<void> {
    const tx = await this.prisma.transaction
      .findUnique({
        where: { id: transactionId },
        select: {
          listing: { select: { title: true } },
          seller: {
            select: { email: true, firstName: true, lastName: true, username: true, phone: true },
          },
        },
      })
      .catch(() => null);
    if (!tx?.seller?.email) return;
    const sellerName =
      [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
      tx.seller.username ||
      'Seller';
    await this.notifications.shipmentBookingFailed({
      sellerEmail: tx.seller.email,
      sellerName,
      sellerPhone: tx.seller.phone,
      listingTitle: tx.listing.title,
      transactionId,
    });
  }

  // Fetch a booked shipment's waybill/label PDF from the right carrier.
  // Auth (Pudo api_key / TCG bearer) is handled inside each carrier client,
  // so the key never reaches the seller — our proxy endpoint streams the
  // bytes back after checking ownership.
  async getWaybillPdf(
    carrier: 'PUDO' | 'TCG',
    shipmentId: string,
  ): Promise<Buffer> {
    return carrier === 'PUDO'
      ? this.pudo.fetchWaybillPdf(shipmentId)
      : this.tcg.fetchWaybillPdf(shipmentId);
  }

  private async releaseBookingClaim(transactionId: string): Promise<void> {
    await this.prisma.transaction
      .update({
        where: { id: transactionId },
        data: { shipmentBookingStartedAt: null },
      })
      .catch(() => undefined);
  }

  private async raiseBookingFailedAlert(
    transactionId: string,
    reason: string,
  ): Promise<void> {
    // Best-effort admin surface — dedup on the transaction (no compound
    // unique on AdminAlert) so repeated retries refresh one alert rather
    // than spamming the queue.
    const context = `Shipment booking failed: ${reason}`.slice(0, 500);
    try {
      const existing = await this.prisma.adminAlert.findFirst({
        where: {
          type: 'SHIPMENT_BOOKING_FAILED',
          referenceId: transactionId,
          resolved: false,
        },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.adminAlert.update({
          where: { id: existing.id },
          data: { context },
        });
      } else {
        await this.prisma.adminAlert.create({
          data: {
            type: 'SHIPMENT_BOOKING_FAILED',
            referenceId: transactionId,
            urgent: true,
            context,
          },
        });
      }
    } catch {
      // best-effort — never let alerting failure mask the booking failure
    }
  }

  // ------------------------------------------------------------------
  // Transaction lookup by tracking number — shared helper per CLAUDE.md.
  // ------------------------------------------------------------------
  async findTransactionByTrackingNumber(trackingNumber: string | unknown) {
    if (!trackingNumber || typeof trackingNumber !== 'string') return null;
    return this.prisma.transaction.findFirst({
      where: { trackingReference: trackingNumber },
      include: {
        listing: { select: { id: true, title: true } },
        buyer: { select: { email: true, firstName: true, phone: true } },
        seller: { select: { email: true, firstName: true } },
      },
    });
  }

  // ------------------------------------------------------------------
  // Idempotent status update. Returns the new status if applied, or null
  // if the event was a no-op (same status, or trying to go backwards).
  // ------------------------------------------------------------------
  async applyShippingUpdate(
    transactionId: string,
    newStatus: ShippingStatus,
  ): Promise<ShippingStatus | null> {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true,
          shippingStatus: true,
          dispatchedAt: true,
          deliveredAt: true,
          swapId: true, // SWOP S4 — drives the both-legs-delivered rollup
          listing: { select: { title: true } },
          buyer: { select: { email: true, firstName: true } },
          seller: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              username: true,
              phone: true,
            },
          },
        },
      });
      if (!transaction) return null;

      const current = transaction.shippingStatus as ShippingStatus | null;
      // No change → no-op
      if (current === newStatus) return null;
      // Backward transition → reject
      if (current && STATUS_RANK[newStatus] < STATUS_RANK[current]) {
        this.logger.warn(
          `Refusing backward shipping transition for ${transactionId}: ${current} → ${newStatus}`,
        );
        return null;
      }

      // Stamp timestamps on the relevant transitions
      const dataPatch: {
        shippingStatus: ShippingStatus;
        dispatchedAt?: Date;
        deliveredAt?: Date;
      } = { shippingStatus: newStatus };
      const now = new Date();
      // First forward transition past PENDING marks dispatched (in case the
      // seller's manual dispatch endpoint was never called).
      if (
        !transaction.dispatchedAt &&
        STATUS_RANK[newStatus] >= STATUS_RANK.COLLECTED
      ) {
        dataPatch.dispatchedAt = now;
      }
      if (newStatus === 'DELIVERED' && !transaction.deliveredAt) {
        dataPatch.deliveredAt = now;
      }

      await tx.transaction.update({
        where: { id: transactionId },
        data: dataPatch,
      });

      this.logger.log(
        `Transaction ${transactionId} shippingStatus: ${current ?? 'null'} → ${newStatus}`,
      );

      // Fire-and-forget notification for buyer
      const buyerEmail = transaction.buyer.email;
      const buyerName = transaction.buyer.firstName ?? 'there';
      const title = transaction.listing.title;
      switch (newStatus) {
        case 'COLLECTED':
        case 'IN_TRANSIT':
          void this.notifications.shippingDispatched(buyerEmail, buyerName, title, transactionId);
          break;
        case 'OUT_FOR_DELIVERY':
          void this.notifications.shippingOutForDelivery(buyerEmail, buyerName, title, transactionId);
          break;
        case 'DELIVERED':
          void this.notifications.shippingDelivered(buyerEmail, buyerName, title, transactionId);
          break;
        case 'DELIVERY_FAILED':
          void this.notifications.shippingFailed(buyerEmail, buyerName, title, transactionId);
          break;
        case 'RETURNED':
          // No notification for buyer on returned — admin handles it.
          break;
      }

      // Seller-side notifications (P5.2) — the seller wants to know when the
      // courier picks the parcel up and when it reaches the buyer. Only on
      // COLLECTED (pickup) + DELIVERED; other transitions stay buyer-only to
      // avoid noise.
      const seller = transaction.seller;
      if (seller?.email) {
        const sellerName =
          [seller.firstName, seller.lastName].filter(Boolean).join(' ') ||
          seller.username ||
          'Seller';
        if (newStatus === 'COLLECTED') {
          void this.notifications.sellerParcelCollected({
            sellerEmail: seller.email,
            sellerName,
            sellerPhone: seller.phone,
            listingTitle: title,
            transactionId,
          });
        } else if (newStatus === 'DELIVERED') {
          void this.notifications.sellerParcelDelivered({
            sellerEmail: seller.email,
            sellerName,
            sellerPhone: seller.phone,
            listingTitle: title,
            transactionId,
          });
        }
      }

      // SWOP S4 rollup — when a swap leg is delivered, flip the parent Swap to
      // AWAITING_VERIFICATION once BOTH legs are delivered. The current leg's
      // deliveredAt was just stamped in this tx, so we only check the sibling.
      // Status-guarded on IN_TRANSIT so it fires exactly once. (Cash release +
      // COMPLETED is S5.)
      if (newStatus === 'DELIVERED' && transaction.swapId) {
        // Only the two REAL legs carry a swapRole (synthetic settlement/refund
        // txs created later have swapRole null) — guard against them.
        const sibling = await tx.transaction.findFirst({
          where: {
            swapId: transaction.swapId,
            id: { not: transactionId },
            swapRole: { not: null },
          },
          select: { deliveredAt: true },
        });
        if (sibling?.deliveredAt) {
          // S5: open a 48h verification window. A recipient can flag "not as
          // described" before the auto-release cron settles the cash; after it
          // elapses with no dispute the swap completes + cash releases.
          const rolled = await tx.swap.updateMany({
            where: { id: transaction.swapId, status: 'IN_TRANSIT' },
            data: {
              status: 'AWAITING_VERIFICATION',
              verificationDeadlineAt: new Date(now.getTime() + 48 * 3_600_000),
            },
          });
          if (rolled.count > 0) {
            this.logger.log(
              `Swap ${transaction.swapId} both legs delivered → AWAITING_VERIFICATION (48h window)`,
            );
          }
        }
      }

      return newStatus;
    });
  }

  // ------------------------------------------------------------------
  // TCG webhook event processing
  // ------------------------------------------------------------------
  async processTcgEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`TCG webhook event: ${event}`);

    const status = this.mapTcgStatus(event, payload);
    const waybill = (payload.waybillNumber ?? payload.waybill) as string | undefined;
    if (!waybill) {
      this.logger.warn('TCG webhook missing waybill number — ignoring');
      return;
    }
    if (!status) {
      this.logger.warn(`TCG webhook for ${waybill} produced no mapped status — ignoring`);
      return;
    }

    const transaction = await this.findTransactionByTrackingNumber(waybill);
    if (!transaction) {
      this.logger.warn(`TCG waybill ${waybill} did not match any transaction — ignoring`);
      return;
    }

    await this.applyShippingUpdate(transaction.id, status);
  }

  // ------------------------------------------------------------------
  // Pudo webhook event processing
  // ------------------------------------------------------------------
  async processPudoEvent(payload: Record<string, unknown>): Promise<void> {
    this.logger.log('Pudo webhook received');

    const status = this.mapPudoStatus(payload);
    const trackingCode = (payload.trackingCode ?? payload.barcode) as string | undefined;
    if (!trackingCode) {
      this.logger.warn('Pudo webhook missing tracking code — ignoring');
      return;
    }
    if (!status) {
      this.logger.warn(`Pudo webhook for ${trackingCode} produced no mapped status — ignoring`);
      return;
    }

    const transaction = await this.findTransactionByTrackingNumber(trackingCode);
    if (!transaction) {
      this.logger.warn(`Pudo ${trackingCode} did not match any transaction — ignoring`);
      return;
    }

    await this.applyShippingUpdate(transaction.id, status);
  }

  // ------------------------------------------------------------------
  // Status mapping helpers
  // ------------------------------------------------------------------
  private mapTcgStatus(
    event: string,
    payload: Record<string, unknown>,
  ): ShippingStatus | null {
    // TCG event types from CLAUDE.md: shipment_note, shipment_tracking_event,
    // invoice_generated, parcel_tracking_event, shipment_file_upload.
    // TODO: verify exact status strings from TCG webhook docs.
    const statusStr = ((payload.status ?? '') as string).toLowerCase();

    if (event === 'parcel_tracking_event' || event === 'shipment_tracking_event') {
      if (statusStr.includes('collect')) return 'COLLECTED';
      if (statusStr.includes('in transit') || statusStr.includes('in_transit')) return 'IN_TRANSIT';
      if (statusStr.includes('out for delivery') || statusStr.includes('out_for_delivery')) return 'OUT_FOR_DELIVERY';
      if (statusStr.includes('delivered')) return 'DELIVERED';
      if (statusStr.includes('failed') || statusStr.includes('unsuccessful')) return 'DELIVERY_FAILED';
      if (statusStr.includes('return')) return 'RETURNED';
    }

    if (event === 'shipment_note') return 'PENDING';
    return null;
  }

  private mapPudoStatus(payload: Record<string, unknown>): ShippingStatus | null {
    const statusStr = ((payload.status ?? payload.eventCode ?? '') as string).toLowerCase();

    if (statusStr.includes('collect') || statusStr.includes('dropped')) return 'COLLECTED';
    if (statusStr.includes('in transit') || statusStr.includes('in_transit')) return 'IN_TRANSIT';
    if (statusStr.includes('ready') || statusStr.includes('out_for')) return 'OUT_FOR_DELIVERY';
    if (statusStr.includes('deliver') || statusStr.includes('collected by recipient')) return 'DELIVERED';
    if (statusStr.includes('fail') || statusStr.includes('expired')) return 'DELIVERY_FAILED';
    if (statusStr.includes('return')) return 'RETURNED';

    return null;
  }
}
