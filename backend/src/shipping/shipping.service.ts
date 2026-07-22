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

  // DD-F4 — collection origin for a Daily Deal (isDealListing) TCG shipment.
  // A deal listing carries NO pickup* columns: The Courier Guy collects from
  // the deal's SUPPLIER warehouse. We load the supplier in a SEPARATE query
  // (supplier data must never ride a public/listing payload — leak-fix rule)
  // and return it as a TCG business-type address. Throws a clear BadRequest —
  // mirroring the seller pickup-incomplete failure — when the deal, its
  // supplier, or a required warehouse field is missing, so a mis-configured
  // deal fails loudly at quote/book time rather than shipping from nowhere.
  private async dealCollectionOrigin(
    listingId: string,
  ): Promise<TcgResidentialAddress> {
    const deal = await this.prisma.deal.findUnique({
      where: { listingId },
      select: {
        supplier: {
          select: {
            name: true,
            warehouseStreet: true,
            warehouseSuburb: true,
            warehouseCity: true,
            warehouseProvince: true,
            warehousePostalCode: true,
            warehouseLat: true,
            warehouseLng: true,
          },
        },
      },
    });
    const s = deal?.supplier;
    if (
      !s ||
      !s.warehouseStreet ||
      !s.warehouseCity ||
      !s.warehousePostalCode ||
      !s.warehouseProvince
    ) {
      throw new BadRequestException(
        'This deal has no complete supplier collection address yet.',
      );
    }
    return {
      streetAddress: s.warehouseStreet,
      suburb: s.warehouseSuburb ?? '',
      city: s.warehouseCity,
      postalCode: s.warehousePostalCode,
      province: PROVINCE_LONG[s.warehouseProvince],
      lat: s.warehouseLat ?? undefined,
      lng: s.warehouseLng ?? undefined,
      type: 'business',
      company: s.name,
    };
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
      // DD-F4 — a Daily Deal listing has NO pickup* columns; the courier
      // collects from the deal's SUPPLIER warehouse. Resolve the origin from
      // the supplier for deals; ordinary listings keep the seller's pickup
      // address (byte-identical).
      let from: TcgResidentialAddress;
      if (listing.isDealListing) {
        from = await this.dealCollectionOrigin(listing.id);
      } else {
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
        from = {
          streetAddress: listing.pickupStreet,
          suburb: listing.pickupSuburb ?? '',
          city: listing.pickupCity,
          postalCode: listing.pickupPostalCode ?? '',
          province: PROVINCE_LONG[listing.province],
          lat: listing.pickupLat,
          lng: listing.pickupLng,
        };
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

  // P6.2 — quote ONE consolidated parcel for 2+ items from the SAME seller,
  // shipping via the SAME method to the SAME destination. Combined weight =
  // Σ(item weight × qty); combined box = a conservative STACKED bounding box
  // (max length, max width, Σ height) so we never UNDER-quote (GG remits the
  // real carrier cost). Returns null when the combined parcel is too big for
  // the method (e.g. exceeds a Pudo locker) — the caller then falls back to
  // per-line quoting so checkout never breaks. All items must be the same
  // seller's non-firearm, non-collection, method-offering listings.
  async quoteCombined(
    items: Array<{ listingId: string; quantity: number }>,
    method: 'PUDO' | 'TCG',
    dest: {
      toLockerId?: string;
      deliveryAddress?: QuoteRequestBody['deliveryAddress'];
    },
  ): Promise<ShippingQuote | null> {
    if (items.length === 0) return null;
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: items.map((i) => i.listingId) } },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    let weightGrams = 0;
    let lengthCm = 0;
    let widthCm = 0;
    let heightCm = 0;
    let declaredValueCents = 0;
    for (const it of items) {
      const l = byId.get(it.listingId);
      const qty = Math.max(1, it.quantity);
      if (
        !l ||
        l.isFirearm ||
        l.collectionOnly ||
        !l.weightGrams ||
        !l.lengthCm ||
        !l.widthCm ||
        !l.heightCm
      ) {
        // Any ineligible / dimensionless item → don't consolidate this group.
        return null;
      }
      if (l.shippingMethods.length > 0 && !l.shippingMethods.includes(method)) {
        return null;
      }
      weightGrams += l.weightGrams * qty;
      lengthCm = Math.max(lengthCm, l.lengthCm);
      widthCm = Math.max(widthCm, l.widthCm);
      heightCm += l.heightCm * qty;
      declaredValueCents += (l.price ?? 0) * qty;
    }
    const parcel: ParcelDims = { lengthCm, widthCm, heightCm, weightGrams };

    if (method === 'PUDO') {
      if (!dest.toLockerId) return null;
      return this.pudo.quoteL2L(dest.toLockerId, parcel);
    }

    // TCG door-to-door. Pickup is the (shared) seller's address — take it off
    // the first listing (same seller, so same pickup). DD-F4 — a consolidated
    // DEAL group is same-supplier (checkout keys consolidation by supplierId
    // for deals), so its origin is that supplier's warehouse, not a seller
    // pickup address. Ordinary groups are byte-identical.
    const pickup = listings[0];
    let from: TcgResidentialAddress;
    if (pickup?.isDealListing) {
      // incomplete supplier address → null so the caller falls back to per-line
      const dealFrom = await this.dealCollectionOrigin(pickup.id).catch(
        () => null,
      );
      if (!dealFrom) return null;
      from = dealFrom;
    } else {
      if (
        !pickup?.pickupStreet ||
        !pickup.pickupCity ||
        pickup.pickupLat == null ||
        pickup.pickupLng == null
      ) {
        return null;
      }
      from = {
        streetAddress: pickup.pickupStreet,
        suburb: pickup.pickupSuburb ?? '',
        city: pickup.pickupCity,
        postalCode: pickup.pickupPostalCode ?? '',
        province: PROVINCE_LONG[pickup.province],
        lat: pickup.pickupLat,
        lng: pickup.pickupLng,
      };
    }
    if (!dest.deliveryAddress) return null;
    const to: TcgResidentialAddress = {
      streetAddress: dest.deliveryAddress.streetAddress,
      suburb: dest.deliveryAddress.suburb,
      city: dest.deliveryAddress.city,
      postalCode: dest.deliveryAddress.postalCode,
      province: PROVINCE_LONG[dest.deliveryAddress.province],
      lat: dest.deliveryAddress.lat,
      lng: dest.deliveryAddress.lng,
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
      declaredValueCents,
    );
    if (!tcgQuote) return null;
    return {
      serviceCode: tcgQuote.serviceCode,
      serviceName: tcgQuote.serviceName,
      priceCents: tcgQuote.priceCents,
    };
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
    // P6.2 — a consolidated SIBLING line has no shipment of its own; it ships
    // inside its carrier's one parcel. Never book (or even claim) it — the
    // carrier books the whole group. (accept cascades booking to the carrier.)
    const shipsWith = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { shipsWithId: true },
    });
    if (shipsWith?.shipsWithId) {
      this.logger.log(
        `bookForTransaction ${transactionId}: consolidated sibling — ships with ${shipsWith.shipsWithId}, no own booking`,
      );
      return null;
    }

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
        include: {
          listing: true,
          buyer: true,
          seller: true,
          // P6.2 — the sibling lines that ship inside THIS carrier's parcel.
          // Only still-live ones count toward the combined weight/dims: a
          // sibling refunded/cancelled/rejected before booking is no longer
          // HELD, so it drops out of the parcel automatically.
          shippedWith: {
            where: { paymentStatus: 'HELD' },
            include: { listing: true },
          },
        },
      });
      if (!tx) throw new Error('transaction not found');

      // Money backstop (P6.2 review) — NEVER book a shipment for a sale whose
      // funds aren't currently HELD. A refunded/rejected/disputed/released
      // order must not (re)book + (re)bill the courier wallet. This also closes
      // the consolidated-carrier orphan path: if an admin refunds a carrier and
      // a sibling is later accepted (which books the carrier), this refuses.
      if (tx.paymentStatus !== 'HELD') {
        this.logger.warn(
          `bookForTransaction ${transactionId}: paymentStatus is ${tx.paymentStatus} (not HELD) — refusing to book`,
        );
        await this.releaseBookingClaim(transactionId);
        return null;
      }

      // Courier sales only. Release the claim for everything else so the
      // row never looks like a stuck in-progress booking.
      if (tx.shippingMethod !== 'PUDO' && tx.shippingMethod !== 'TCG') {
        await this.releaseBookingClaim(transactionId);
        return null;
      }

      // DD-F4 — a Daily Deal collects from the SUPPLIER's warehouse (the house
      // seller has no address/phone), so load the deal's supplier once up
      // front. SEPARATE query — supplier data never rides a listing payload.
      const isDeal = tx.listing.isDealListing === true;
      let supplier: {
        name: string;
        contactPerson: string;
        email: string;
        phone: string;
        warehouseStreet: string;
        warehouseSuburb: string;
        warehouseCity: string;
        warehouseProvince: Province;
        warehousePostalCode: string;
        warehouseLat: number | null;
        warehouseLng: number | null;
      } | null = null;
      let dealRef = '';
      if (isDeal) {
        const deal = await this.prisma.deal.findUnique({
          where: { listingId: tx.listingId },
          select: {
            id: true,
            supplierRef: true,
            supplier: {
              select: {
                name: true,
                contactPerson: true,
                email: true,
                phone: true,
                warehouseStreet: true,
                warehouseSuburb: true,
                warehouseCity: true,
                warehouseProvince: true,
                warehousePostalCode: true,
                warehouseLat: true,
                warehouseLng: true,
              },
            },
          },
        });
        supplier = deal?.supplier ?? null;
        dealRef =
          deal?.supplierRef ||
          (deal?.id ? deal.id.slice(-8).toUpperCase() : '');
      }
      if (!tx.shippingServiceCode) {
        throw new Error(
          `${tx.shippingMethod} order has no service code — the shipping quote may be stale`,
        );
      }
      // The carrier SMSes the hand-over PIN (Pudo) / collection notice (TCG),
      // so a real mobile for BOTH parties is required. Missing → fail-safe to
      // the manual-dispatch fallback rather than book a contactless shipment
      // the carrier can't coordinate. DD-F4 — a house deal collects from the
      // SUPPLIER (the house seller has no phone), so validate the SUPPLIER's
      // phone for deals; ordinary sales validate the seller's exactly as before.
      if (isDeal) {
        if (!supplier?.phone?.trim()) {
          throw new Error(
            'supplier has no phone on file — cannot book a deal courier collection',
          );
        }
      } else if (!tx.seller.phone?.trim()) {
        throw new Error('seller has no phone on file — cannot book a courier shipment');
      }
      if (!tx.buyer.phone?.trim()) {
        throw new Error('buyer has no phone on file — cannot book a courier shipment');
      }

      // Contacts go to the CARRIER (collection/delivery coordination + the
      // PIN SMS), never exposed to the other party — so real names + phones
      // are correct and required here.
      // DD-F4 — for a house deal the collection party is the SUPPLIER (the
      // courier phones them at the warehouse), not the phantom house seller.
      const collectionContact: CarrierContact = isDeal
        ? {
            name: supplier!.contactPerson || supplier!.name || 'Supplier',
            email: supplier!.email ?? undefined,
            mobile: supplier!.phone.trim(),
          }
        : {
            name:
              [tx.seller.firstName, tx.seller.lastName]
                .filter(Boolean)
                .join(' ') ||
              tx.seller.username ||
              'Seller',
            email: tx.seller.email ?? undefined,
            mobile: tx.seller.phone!.trim(),
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
        // DD-F4 — deals collect from the supplier warehouse (a business
        // address); ordinary sales collect from the seller's pickup* columns.
        let fromAddress: TcgResidentialAddress;
        if (isDeal) {
          if (
            !supplier ||
            !supplier.warehouseStreet ||
            !supplier.warehouseCity ||
            !supplier.warehousePostalCode
          ) {
            throw new Error('supplier warehouse address incomplete');
          }
          fromAddress = {
            streetAddress: supplier.warehouseStreet,
            suburb: supplier.warehouseSuburb ?? '',
            city: supplier.warehouseCity,
            postalCode: supplier.warehousePostalCode,
            province: PROVINCE_LONG[supplier.warehouseProvince],
            lat: supplier.warehouseLat ?? undefined,
            lng: supplier.warehouseLng ?? undefined,
            type: 'business',
            company: supplier.name,
          };
        } else {
          if (
            !L.pickupStreet ||
            !L.pickupCity ||
            L.pickupLat == null ||
            L.pickupLng == null
          ) {
            throw new Error('seller pickup address incomplete');
          }
          fromAddress = {
            streetAddress: L.pickupStreet,
            suburb: L.pickupSuburb ?? '',
            city: L.pickupCity,
            postalCode: L.pickupPostalCode ?? '',
            province: PROVINCE_LONG[L.province],
            lat: L.pickupLat,
            lng: L.pickupLng,
          };
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
        // P6.2 — the physical parcel is the CARRIER line plus every live
        // sibling that ships with it. Combine into one conservative stacked
        // box (max L, max W, Σ height×qty; Σ weight×qty) so the booked
        // shipment matches the combined quote the buyer was charged. Declared
        // value = Σ line totals. A standalone tx has no siblings → identical
        // to the old single-parcel behaviour.
        let weightGrams = (L.weightGrams ?? 0) * tx.quantity;
        let lengthCm = L.lengthCm ?? 0;
        let widthCm = L.widthCm ?? 0;
        let heightCm = (L.heightCm ?? 0) * tx.quantity;
        let declaredValueCents = tx.listingPrice;
        for (const s of tx.shippedWith) {
          weightGrams += (s.listing.weightGrams ?? 0) * s.quantity;
          lengthCm = Math.max(lengthCm, s.listing.lengthCm ?? 0);
          widthCm = Math.max(widthCm, s.listing.widthCm ?? 0);
          heightCm += (s.listing.heightCm ?? 0) * s.quantity;
          declaredValueCents += s.listingPrice;
        }
        result = await this.tcg.createShipment({
          serviceCode: tx.shippingServiceCode,
          from: fromAddress,
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
            weightKg: weightGrams / 1000,
            lengthCm,
            widthCm,
            heightCm,
            // DD-F4 — give a Daily Deal collection a supplier-recognisable
            // parcel label + reference so the warehouse knows what TCG is
            // collecting; ordinary sales keep TCG's default description.
            description: isDeal
              ? `Gun Galore Daily Deal collection${dealRef ? ` (ref ${dealRef})` : ''}: ${L.title}`.slice(
                  0,
                  120,
                )
              : undefined,
          },
          declaredValueCents,
          collectionContact,
          deliveryContact,
          specialInstructions: isDeal
            ? `Collection for Gun Galore Daily Deal${dealRef ? ` — ref ${dealRef}` : ''}.`
            : undefined,
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
      // DD-F3 — for a house deal this SMS/email goes to the operator (the house
      // seller row's phone is set to the operator's number at deploy), and the
      // copy should be collection-voiced ("Collection booked from <supplier> —
      // The Courier Guy will collect. Waybill <ref>.") rather than the
      // seller-voiced "Drop your parcel…". The copy literal lives in
      // notifications.service.ts, which is OUTSIDE this wave's file set, so we
      // forward the supplier name here (non-fresh payload → no excess-property
      // error); Wave 3 branches shipmentBooked's copy on it. Until then the
      // generic TCG "The Courier Guy will collect" copy is used.
      const bookedPayload = {
        sellerEmail: tx.seller.email,
        sellerName,
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        transactionId,
        carrier: result.carrier,
        trackingReference: result.trackingReference,
        dropoffPin: result.pin ?? null,
        ...(isDeal && supplier ? { dealSupplierName: supplier.name } : {}),
      };
      void this.notifications
        .shipmentBooked(bookedPayload)
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

      // P6.2 — mirror the carrier's shipping state onto its consolidated
      // siblings (they ride in this one parcel), so their status + dispatched/
      // delivered timestamps track the carrier for display, and nothing sees a
      // sibling as un-dispatched while the shared parcel is on its way.
      await tx.transaction.updateMany({
        where: { shipsWithId: transactionId },
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
          // Fire the buyer "on its way" notice ONCE — on the first move into a
          // collected-or-later state. TCG scans a parcel through several hubs
          // (collected → at-hub → in-transit → at-destination-hub), and all of
          // those land here; without this guard the buyer would be emailed +
          // pushed on every hub scan.
          if (!current || STATUS_RANK[current] < STATUS_RANK.COLLECTED) {
            void this.notifications.shippingDispatched(buyerEmail, buyerName, title, transactionId);
          }
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
  // Shiplogic tracking webhook — SHARED by TCG and Pudo. Both couriers run
  // on the Shiplogic platform, so the tracking payload is identical: a
  // top-level HYPHENATED `status` slug + the tracking reference under
  // short_/custom_tracking_reference (or parcel_tracking_references). There
  // is NO `event`/`eventType` field. Non-tracking topics (notes, invoices,
  // dimension-change arrays, address-changes) carry no status → ignored.
  // ------------------------------------------------------------------
  private async processShiplogicWebhook(
    payload: Record<string, unknown>,
    carrier: 'TCG' | 'Pudo',
  ): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    const status = this.mapShiplogicStatus(payload);
    if (!status) {
      // Not an actionable tracking status (e.g. collection-assigned, an
      // internal hub state, a note/invoice topic, or an unknown slug).
      this.logger.log(
        `${carrier} webhook: status "${String(payload.status ?? 'none')}" is not customer-actionable — ignoring`,
      );
      return;
    }

    // The trackable reference is what we stored at booking — TCG stores
    // short_tracking_reference, Pudo stores custom_tracking_reference. Try
    // every field the webhook might carry it under (shipment- vs parcel-
    // level + legacy Pudo names) until one matches. Parcel refs look like
    // "SLXS7GL/1" — strip the "/N" parcel suffix.
    const parcelRef = Array.isArray(payload.parcel_tracking_references)
      ? String(payload.parcel_tracking_references[0] ?? '').split('/')[0]
      : undefined;
    const candidates = [
      payload.short_tracking_reference,
      payload.custom_tracking_reference,
      payload.shipment_short_tracking_reference,
      payload.shipment_custom_tracking_reference,
      parcelRef,
      payload.trackingCode,
      payload.barcode,
    ].filter((r): r is string => typeof r === 'string' && r.length > 0);

    if (candidates.length === 0) {
      this.logger.warn(`${carrier} webhook missing a tracking reference — ignoring`);
      return;
    }

    let transaction: Awaited<
      ReturnType<typeof this.findTransactionByTrackingNumber>
    > = null;
    for (const ref of candidates) {
      transaction = await this.findTransactionByTrackingNumber(ref);
      if (transaction) break;
    }
    if (!transaction) {
      this.logger.warn(
        `${carrier} webhook refs [${candidates.join(', ')}] matched no transaction — ignoring`,
      );
      return;
    }

    await this.applyShippingUpdate(transaction.id, status);
  }

  async processTcgEvent(payload: Record<string, unknown>): Promise<void> {
    return this.processShiplogicWebhook(payload, 'TCG');
  }

  async processPudoEvent(payload: Record<string, unknown>): Promise<void> {
    // Pudo runs on the SAME Shiplogic platform as TCG — identical tracking
    // payload (hyphenated `status` slug + custom_/short_tracking_reference).
    return this.processShiplogicWebhook(payload, 'Pudo');
  }

  // ------------------------------------------------------------------
  // Status mapping helpers
  // ------------------------------------------------------------------
  // The Courier Guy + Pudo both run on Shiplogic and share ONE tracking-status
  // vocabulary of HYPHENATED slugs (verified against TCG's official "Shipment
  // statuses" + webhook docs and Pudo's dev.api-pudo.co.za tracking docs).
  // Explicit allow-list → our 6 customer-facing states. Anything NOT listed
  // (collection-assigned/-unassigned/-rejected/-exception/-failed-attempt,
  // awaiting-dropoff, created, label-created, submitted, deposit-pending,
  // on-hold(-internal), delivery-assigned/-unassigned/-rejected, cancelled,
  // floor-check, …) is a pre-movement or internal state we deliberately do
  // NOT surface to the customer → returns null (leaves shippingStatus alone).
  //
  // SAFETY: this replaced substring matching that mapped BOTH "out-for-delivery"
  // and "delivery-failed-attempt" to DELIVERED (both contain "deliver"), which
  // would have falsely told the buyer their parcel arrived — and, on a failed
  // delivery, started the payout auto-release countdown. Only the two
  // unambiguous "buyer has it" slugs map to DELIVERED here.
  private mapShiplogicStatus(
    payload: Record<string, unknown>,
  ): ShippingStatus | null {
    // Normalise casing/separators so IN_TRANSIT / "In Transit" / in-transit
    // all resolve to the hyphenated key.
    const slug = String(payload.status ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    const map: Record<string, ShippingStatus> = {
      // collected / in the network
      collected: 'COLLECTED',
      'dropped-off': 'COLLECTED',
      // moving between hubs / lockers (non-terminal)
      'in-transit': 'IN_TRANSIT',
      'at-hub': 'IN_TRANSIT',
      'at-destination-hub': 'IN_TRANSIT',
      'ready-for-dispatch': 'IN_TRANSIT',
      manifested: 'IN_TRANSIT',
      'returned-to-hub': 'IN_TRANSIT',
      // non-terminal exception — courier follows up; keep it "in transit" from
      // a notification POV (matches the polling path's DELIVERY_EXCEPTION rule)
      // rather than falsely alarming the buyer with a "delivery failed".
      'delivery-exception': 'IN_TRANSIT',
      exception: 'IN_TRANSIT',
      // arrived, awaiting the recipient
      'out-for-delivery': 'OUT_FOR_DELIVERY',
      'ready-for-pickup': 'OUT_FOR_DELIVERY',
      'ready-for-collection': 'OUT_FOR_DELIVERY',
      'arrived-at-locker': 'OUT_FOR_DELIVERY',
      'at-locker': 'OUT_FOR_DELIVERY',
      // the buyer has it (ONLY these two trigger the payout-release gate)
      delivered: 'DELIVERED',
      'collected-by-recipient': 'DELIVERED',
      // terminal failures
      'delivery-failed-attempt': 'DELIVERY_FAILED',
      failed: 'DELIVERY_FAILED',
      undeliverable: 'DELIVERY_FAILED',
      expired: 'DELIVERY_FAILED', // Pudo collection-PIN window lapsed
      // return to sender
      'returned-to-sender': 'RETURNED',
      returned: 'RETURNED',
    };
    return map[slug] ?? null;
  }
}
