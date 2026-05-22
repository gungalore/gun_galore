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
          listing: { select: { title: true } },
          buyer: { select: { email: true, firstName: true } },
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
