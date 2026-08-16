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
import { BobGoService } from './bobgo.service';
import type { BobGoAddress, BobGoRate } from './bobgo.types';
import {
  pickupPointOptions,
  rateToQuote,
  selectRateForSlot,
} from './bobgo-adapter';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { displayShippingCents } from '../payments/fee.calculator';
import { CarrierContact, CarrierShipmentResult } from './carrier.types';
import { shiplogicToShippingStatus } from './status-map';
import {
  failedShipmentChargeCents,
  requiresRemeasure,
  sellerPaysFor,
  type ShipmentFailureReason,
} from '../common/shipment-failure-policy';

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

/**
 * The two courier delivery shapes. Everything else on ShippingMethod
 * (DEALER_TRANSFER, PRIVATE_ARRANGE, COLLECTION, ON_SITE_SERVICE) is a
 * non-courier hand-over and is NOT the buyer's to choose.
 */
const COURIER_METHODS = ['PUDO', 'TCG'] as const;

/**
 * Does this listing offer couriering at all?
 *
 * Operator decision (2026-08-13): the DELIVERY OPTION IS THE BUYER'S TO
 * DECIDE. A seller who has opted into couriering no longer curates *which*
 * courier option the buyer gets — door versus collection point is the buyer's
 * call, and Bob Go's rate response is the authority on what is actually
 * possible for that parcel and route.
 *
 * What the seller (and the law, and physics) still decide is whether the item
 * is couriered AT ALL: firearms are dealer-transfer only, collection-only and
 * dangerous-goods items stay collection-only, and a parcel too big for a
 * locker simply never comes back with a pickup-point rate because Bob Go is
 * size-aware. Those constraints enforce themselves; seller preference between
 * two courier options does not need to.
 *
 * So: if a seller offered NO courier method, that is respected absolutely. If
 * they offered ANY, the buyer gets the full set.
 *
 * ONLY ON THE BOB GO RAIL. On the legacy rail the seller's pick is not a
 * preference between two deliveries — it is a choice about their OWN
 * hand-over: PUDO means they drop at a locker and need no pickup address at
 * all, TCG means a courier comes to them. Letting a buyer pick PUDO on a
 * TCG-only listing would quote a locker drop the seller never agreed to, and
 * picking TCG on a PUDO-only listing would quote against a pickup address that
 * does not exist. Bob Go removes the distinction — it collects from an address
 * either way — which is exactly what makes the choice the buyer's to make.
 */
function offersCourier(shippingMethods: string[]): boolean {
  if (shippingMethods.length === 0) return true; // unset = no restriction
  return shippingMethods.some((m) => (COURIER_METHODS as readonly string[]).includes(m));
}

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


/**
 * What a courier option COSTS THE BUYER: the carrier's rate with our 10%
 * delivery margin already folded in.
 *
 * ONE figure, never "quote + 10%". The margin has always been charged — it was
 * just added at checkout, after the buyer had chosen from a list showing the
 * bare carrier rate, so the delivery line jumped at the last step. That is the
 * same surprise the built-in-markup item pricing exists to remove, and it is
 * removed the same way: quote the real number.
 *
 * The split is preserved SERVER-SIDE (Transaction.shippingCost is the pure
 * carrier remittance, shippingHandlingCents is ours) because those are two
 * different obligations at payout time. This only changes what is displayed;
 * checkout recomputes both parts itself, so the figures agree without
 * double-counting.
 *
 * Applies to door and collection point alike — both produce a waybill.
 */
function withHandling(carrierRateCents: number): number {
  return displayShippingCents(carrierRateCents);
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly pudo: PudoService,
    private readonly tcg: TcgService,
    private readonly bobgo: BobGoService,
    private readonly settings: SettingsService,
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
   * Quote a route through Bob Go and pick the rate for one slot.
   *
   * ONE call replaces the Pudo-or-TCG fork: Bob Go returns door and
   * pickup-point rates together, so the slot only decides which of them we
   * keep. Shared by quoteForListing and quoteCombined so the unit conversion
   * and the selection policy exist in exactly one place.
   *
   * Returns `outage` separately from an empty quote because the two mean
   * opposite things to a buyer. Both legacy clients returned null for
   * everything, which made "no rate for this route" and "the carrier is down"
   * indistinguishable — the buyer saw the same empty shipping list either way
   * and the sale was lost silently. The Bob Go client throws on an outage, and
   * this is where that distinction is preserved for callers to act on.
   */
  private async bobgoQuoteForSlot(input: {
    slot: 'PUDO' | 'TCG';
    collection: TcgResidentialAddress;
    delivery: {
      streetAddress: string;
      suburb: string;
      city: string;
      postalCode: string;
      province: Province;
    };
    parcel: ParcelDims;
    declaredValueCents: number;
    /** Pickup-point slot — the locker the buyer chose, when they chose one. */
    lockerId?: number;
    description?: string;
  }): Promise<{ quote: ShippingQuote | null; outage: boolean }> {
    const toBobGo = (a: {
      streetAddress: string;
      suburb: string;
      city: string;
      postalCode: string;
    }): BobGoAddress => ({
      streetAddress: a.streetAddress,
      suburb: a.suburb,
      city: a.city,
      postalCode: a.postalCode,
      province: '',
    });

    const collection: BobGoAddress = {
      ...toBobGo(input.collection),
      // The collection address already carries the LONG province name (it is
      // built for TCG, which wants the same form Bob Go does).
      province: input.collection.province,
      company: input.collection.company,
    };
    const delivery: BobGoAddress = {
      ...toBobGo(input.delivery),
      province: PROVINCE_LONG[input.delivery.province],
    };

    let rates: BobGoRate[];
    try {
      const q = await this.bobgo.getRates({
        collection,
        delivery,
        parcels: [
          {
            lengthCm: input.parcel.lengthCm,
            widthCm: input.parcel.widthCm,
            heightCm: input.parcel.heightCm,
            weightKg: input.parcel.weightGrams / 1000,
            description: input.description,
          },
        ],
        declaredValueCents: input.declaredValueCents,
      });
      rates = q.rates;
    } catch (err) {
      this.logger.warn(
        `Bob Go quote failed (${input.slot}): ${(err as Error).message}`,
      );
      return { quote: null, outage: true };
    }

    const rate = selectRateForSlot(rates, input.slot, {
      lockerId: input.lockerId,
    });
    return { quote: rate ? rateToQuote(rate) : null, outage: false };
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
    const useBobGo = await this.settings.get(FLAGS.bobgoEnabled);

    // On the Bob Go rail the buyer chooses the courier option — see
    // offersCourier(). A seller who offered no courier at all is still
    // respected; one who offered any gets the full set. On the legacy rail the
    // seller's pick is honoured exactly as before, because there it describes
    // their own hand-over rather than the buyer's preference.
    const courierRequested = (COURIER_METHODS as readonly string[]).includes(
      body.shippingMethod,
    );
    if (useBobGo && courierRequested) {
      if (!offersCourier(listing.shippingMethods)) {
        throw new BadRequestException(
          'This item is not available for courier delivery — arrange collection with the seller.',
        );
      }
    } else if (
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

    if (useBobGo && (body.shippingMethod === 'PUDO' || body.shippingMethod === 'TCG')) {
      // Bob Go needs a delivery address for BOTH slots — a pickup-point parcel
      // is still routed from the buyer's address, and the points it offers are
      // the ones near that address.
      //
      // THIS IS A REAL UX CHANGE for the locker slot. Today a buyer picks a
      // locker from a cached directory before entering an address; under Bob Go
      // the flow inverts to "quote the route, then choose from the points it
      // returns". Everything offered is then a point Bob Go has confirmed it
      // will carry this parcel to, which the Pudo directory could never
      // promise — but the address has to come first. Fail with a clear
      // instruction rather than silently quoting the wrong thing.
      if (!body.deliveryAddress) {
        throw new BadRequestException(
          'Enter your delivery address first so we can find the closest collection points and prices.',
        );
      }
      const from =
        listing.isDealListing
          ? await this.dealCollectionOrigin(listing.id)
          : ((): TcgResidentialAddress => {
              if (!listing.pickupStreet || !listing.pickupCity) {
                throw new BadRequestException(
                  "Seller hasn't provided a collection address yet.",
                );
              }
              return {
                streetAddress: listing.pickupStreet,
                suburb: listing.pickupSuburb ?? '',
                city: listing.pickupCity,
                postalCode: listing.pickupPostalCode ?? '',
                province: PROVINCE_LONG[listing.province],
                lat: listing.pickupLat ?? undefined,
                lng: listing.pickupLng ?? undefined,
              };
            })();

      const { quote, outage } = await this.bobgoQuoteForSlot({
        slot: body.shippingMethod,
        collection: from,
        delivery: body.deliveryAddress,
        parcel,
        declaredValueCents: listing.price ?? 0,
        lockerId: body.toLockerId ? Number(body.toLockerId) : undefined,
      });
      if (outage) {
        // Deliberately distinct from "no rate": an outage is temporary and the
        // buyer should be told to retry, not that we cannot deliver to them.
        throw new BadRequestException(
          'We could not reach the courier for a price just now. Please try again in a moment.',
        );
      }
      if (!quote) {
        throw new BadRequestException(
          body.shippingMethod === 'PUDO'
            ? 'No collection point near that address can take this parcel. Try door delivery instead.'
            : 'No door-delivery rate available for this route right now.',
        );
      }
      return quote;
    }

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

  /**
   * What the sell form should ask a seller about couriering.
   *
   * `sellerPicksOption: false` means: offer ONE "courier delivery" choice and
   * store both slots, because the buyer decides door versus collection point
   * and the seller's hand-over is the same either way.
   *
   * Returned from the server so the sell form never needs a feature flag —
   * same reasoning as the delivery menu.
   */
  async sellerCourierModel(): Promise<{
    sellerPicksOption: boolean;
    /** What to store on Listing.shippingMethods when they opt into couriering. */
    courierMethods: Array<'PUDO' | 'TCG'>;
    /** Copy for the single-option case. */
    label: string;
    hint: string;
  }> {
    if (await this.settings.get(FLAGS.bobgoEnabled)) {
      return {
        sellerPicksOption: false,
        courierMethods: ['PUDO', 'TCG'],
        label: 'Courier delivery',
        hint: 'A courier collects from your address between 08:00 and 17:00. The buyer chooses whether it goes to their door or to a collection point near them.',
      };
    }
    return {
      sellerPicksOption: true,
      courierMethods: ['PUDO', 'TCG'],
      label: 'Courier delivery',
      hint: 'Pick which couriers you offer.',
    };
  }

  /**
   * EVERY delivery option available to this buyer, priced, in one call.
   *
   * This is the buyer's menu, and it is deliberately the whole menu: the
   * operator's decision is that the delivery option is the BUYER'S to decide,
   * so the door option and the collection points are returned together and the
   * buyer picks. The seller does not curate it and neither does this method.
   *
   * Built from a QUOTE, not a directory. Bob Go returns options already priced,
   * already distance-ranked and already bookable (the location id is baked into
   * the service code), so there is no "find points, then price them" round
   * trip — and every point returned is one Bob Go has confirmed will take THIS
   * parcel, which the Pudo directory could never promise. A parcel too big for
   * a locker simply comes back with no pickup points, so the size limit
   * enforces itself rather than needing the seller to police it.
   *
   * An empty `door` AND empty `pickupPoints` means Bob Go serves neither for
   * this route — distinct from the throw below, which means we could not ask.
   */
  async deliveryOptions(
    listingId: string,
    deliveryAddress: NonNullable<QuoteRequestBody['deliveryAddress']>,
  ): Promise<{
    door: {
      /** What the buyer sees and pays — carrier rate + our 10% margin. */
      priceCents: number;
      /**
       * The carrier's own rate, margin excluded. NOT for display — the buyer
       * sees one delivery figure. It is here because the transaction fee is
       * charged on the carrier rate only (we do not charge a gateway
       * percentage on our own margin), and the checkout preview has to agree
       * with the server's arithmetic to the cent.
       */
      carrierRateCents: number;
      serviceName: string;
      serviceCode: string;
    } | null;
    pickupPoints: Array<{
      locationId: number;
      name: string;
      description?: string;
      distanceKm?: number;
      priceCents: number;
      carrierRateCents: number;
      serviceCode: string;
    }>;
  }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    // ITEM-CLASS GATE — if it can't be shipped, don't quote a courier for it.
    //
    // This runs BEFORE the parcel-dimension check on purpose, and covers both
    // rails (Bob Go and the legacy Pudo/TCG path below), because the dimension
    // check is not a class check and never was. A firearm carries weight and
    // dimensions — the sell form requires them — so a firearm listing sailed
    // straight past it and this endpoint returned live, priced, bookable-looking
    // door and pickup-point rates for a rifle. The route is unauthenticated
    // (shipping.controller.ts, no guard beyond the global throttler), so that
    // was reachable by anyone with a listing id.
    //
    // A firearm moves as dealer stock through a licensed dealer, or the parties
    // arrange privately and both attend one. It is never a parcel on our rail.
    if (listing.isFirearm) {
      throw new BadRequestException(
        'This item transfers through a licensed dealer, so no courier rate applies.',
      );
    }
    if (listing.collectionOnly) {
      throw new BadRequestException(
        'This item cannot be couriered — the buyer collects it from the seller.',
      );
    }
    if (listing.isExperience) {
      throw new BadRequestException(
        'This is an on-site booking, not a parcel — no courier rate applies.',
      );
    }
    if (!offersCourier(listing.shippingMethods)) {
      throw new BadRequestException(
        'This item is not available for courier delivery.',
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
    // RAIL-AGNOSTIC ON PURPOSE. The frontend has no way to read a feature flag
    // and should not be given one: that would make the checkout care which
    // carrier we use, and the whole point of the slot design is that it does
    // not have to. This answers for whichever rail is live, in one shape, so
    // the buyer's UI is written once and the swap is invisible to it.
    if (!(await this.settings.get(FLAGS.bobgoEnabled))) {
      return this.legacyDeliveryOptions(listing, deliveryAddress);
    }

    const from = listing.isDealListing
      ? await this.dealCollectionOrigin(listing.id)
      : {
          streetAddress: listing.pickupStreet ?? '',
          suburb: listing.pickupSuburb ?? '',
          city: listing.pickupCity ?? '',
          postalCode: listing.pickupPostalCode ?? '',
          province: PROVINCE_LONG[listing.province],
        };
    if (!from.streetAddress || !from.city) {
      throw new BadRequestException(
        "Seller hasn't provided a collection address yet.",
      );
    }

    let rates: BobGoRate[];
    try {
      const q = await this.bobgo.getRates({
        collection: { ...from, province: from.province },
        delivery: {
          streetAddress: deliveryAddress.streetAddress,
          suburb: deliveryAddress.suburb,
          city: deliveryAddress.city,
          postalCode: deliveryAddress.postalCode,
          province: PROVINCE_LONG[deliveryAddress.province],
        },
        parcels: [
          {
            lengthCm: listing.lengthCm,
            widthCm: listing.widthCm,
            heightCm: listing.heightCm,
            weightKg: listing.weightGrams / 1000,
          },
        ],
        declaredValueCents: listing.price ?? 0,
      });
      rates = q.rates;
    } catch (err) {
      this.logger.warn(
        `Bob Go pickup-point lookup failed: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'We could not reach the courier just now. Please try again in a moment.',
      );
    }

    const doorRate = selectRateForSlot(rates, 'TCG');
    return {
      door: doorRate
        ? {
            priceCents: withHandling(rateToQuote(doorRate).priceCents),
            carrierRateCents: rateToQuote(doorRate).priceCents,
            serviceName: doorRate.serviceName,
            serviceCode: doorRate.serviceCode,
          }
        : null,
      pickupPoints: pickupPointOptions(rates).map((r) => ({
        locationId: r.pickupPointLocationId!,
        name: r.serviceName,
        description: r.description,
        distanceKm: r.pickupPointDistanceKm,
        priceCents: withHandling(rateToQuote(r).priceCents),
        carrierRateCents: rateToQuote(r).priceCents,
        serviceCode: r.serviceCode,
      })),
    };
  }

  /**
   * The same menu, built from the legacy Pudo + TCG rails.
   *
   * Keeps the endpoint's contract identical while the old rail is live, so the
   * checkout is written once and the carrier swap is invisible to it.
   *
   * The shapes differ underneath, and the difference is the whole argument for
   * migrating: Pudo has no server-side proximity search, so collection points
   * come from a cached directory ranked by postal code, and every locker costs
   * the SAME flat locker-to-locker rate rather than carrying its own price.
   * Door needs a separate TCG call. Two round trips and a directory where Bob
   * Go needs one call.
   */
  private async legacyDeliveryOptions(
    listing: {
      id: string;
      isDealListing: boolean;
      weightGrams: number | null;
      lengthCm: number | null;
      widthCm: number | null;
      heightCm: number | null;
      price: number | null;
      province: Province;
      shippingMethods?: string[];
      pickupStreet: string | null;
      pickupSuburb: string | null;
      pickupCity: string | null;
      pickupPostalCode: string | null;
      pickupLat: number | null;
      pickupLng: number | null;
    },
    deliveryAddress: NonNullable<QuoteRequestBody['deliveryAddress']>,
  ): Promise<{
    door: {
      /** What the buyer sees and pays — carrier rate + our 10% margin. */
      priceCents: number;
      /**
       * The carrier's own rate, margin excluded. NOT for display — the buyer
       * sees one delivery figure. It is here because the transaction fee is
       * charged on the carrier rate only (we do not charge a gateway
       * percentage on our own margin), and the checkout preview has to agree
       * with the server's arithmetic to the cent.
       */
      carrierRateCents: number;
      serviceName: string;
      serviceCode: string;
    } | null;
    pickupPoints: Array<{
      locationId: number;
      name: string;
      description?: string;
      distanceKm?: number;
      priceCents: number;
      carrierRateCents: number;
      serviceCode: string;
    }>;
  }> {
    const parcel: ParcelDims = {
      lengthCm: listing.lengthCm!,
      widthCm: listing.widthCm!,
      heightCm: listing.heightCm!,
      weightGrams: listing.weightGrams!,
    };

    // HONOUR THE SELLER'S PICK HERE, unlike the Bob Go branch.
    //
    // The buyer-decides rule is Bob Go's, because there a courier collects from
    // an address either way so the seller has no stake in which shape the buyer
    // chooses. On this rail the pick describes the SELLER'S own hand-over, and
    // quoteForListing still enforces it — so offering an option they did not
    // agree to would hand the buyer a price and then refuse it at the Pay
    // button, which is the worst possible place to find out.
    const offered = listing.shippingMethods ?? [];
    const offers = (m: 'PUDO' | 'TCG') =>
      offered.length === 0 || offered.includes(m);

    // Door — one TCG quote. Null on failure is TcgService's own contract and
    // here means simply "no door option", matching the Bob Go branch.
    let door: {
      priceCents: number;
      carrierRateCents: number;
      serviceName: string;
      serviceCode: string;
    } | null = null;
    try {
      if (!offers('TCG')) throw new Error('seller does not offer door delivery');
      const from: TcgResidentialAddress = listing.isDealListing
        ? await this.dealCollectionOrigin(listing.id)
        : {
            streetAddress: listing.pickupStreet ?? '',
            suburb: listing.pickupSuburb ?? '',
            city: listing.pickupCity ?? '',
            postalCode: listing.pickupPostalCode ?? '',
            province: PROVINCE_LONG[listing.province],
            lat: listing.pickupLat ?? undefined,
            lng: listing.pickupLng ?? undefined,
          };
      if (from.streetAddress && from.city) {
        const q = await this.tcg.getQuote(
          from,
          {
            streetAddress: deliveryAddress.streetAddress,
            suburb: deliveryAddress.suburb,
            city: deliveryAddress.city,
            postalCode: deliveryAddress.postalCode,
            province: PROVINCE_LONG[deliveryAddress.province],
            lat: deliveryAddress.lat,
            lng: deliveryAddress.lng,
          },
          {
            weightKg: parcel.weightGrams / 1000,
            lengthCm: parcel.lengthCm,
            widthCm: parcel.widthCm,
            heightCm: parcel.heightCm,
          },
          listing.price ?? 0,
        );
        if (q) {
          door = {
            priceCents: withHandling(q.priceCents),
            carrierRateCents: q.priceCents,
            serviceName: q.serviceName,
            serviceCode: q.serviceCode,
          };
        }
      }
    } catch (err) {
      // Covers both a genuine quote failure and the seller simply not offering
      // door delivery — either way there is no door option, which is a valid
      // menu rather than an error.
      this.logger.debug(`No legacy door option: ${(err as Error).message}`);
    }

    // Collection points — nearest lockers from the cached directory. The L2L
    // rate is FLAT across lockers, so one quote prices the whole list; if that
    // one quote comes back null the parcel fits no locker at all and the list
    // is empty, which is the same answer Bob Go gives by returning no
    // pickup-point rates.
    const points: Array<{
      locationId: number;
      name: string;
      description?: string;
      distanceKm?: number;
      priceCents: number;
      carrierRateCents: number;
      serviceCode: string;
    }> = [];
    try {
      if (!offers('PUDO')) throw new Error('seller does not offer locker delivery');
      const lockers = await this.pudo.getNearbyLockers({
        lat: deliveryAddress.lat,
        lng: deliveryAddress.lng,
        postalCode: deliveryAddress.postalCode,
        limit: 10,
      });
      const flat = lockers.length
        ? await this.pudo.quoteL2L(lockers[0].lockerId, parcel)
        : null;
      if (flat) {
        for (const l of lockers) {
          points.push({
            // Pudo terminal codes are alphanumeric ("CG929") and this field is
            // numeric for Bob Go location ids. NaN would be worse than
            // useless, so the code travels in serviceCode and this stays 0 —
            // the legacy checkout keys on the code, never on this.
            locationId: 0,
            name: l.name,
            description: [l.address, l.suburb, l.city]
              .filter(Boolean)
              .join(', '),
            distanceKm: l.distanceKm,
            priceCents: withHandling(flat.priceCents),
            carrierRateCents: flat.priceCents,
            serviceCode: l.lockerId,
          });
        }
      }
    } catch (err) {
      this.logger.debug(
        `No legacy collection points: ${(err as Error).message}`,
      );
    }

    return { door, pickupPoints: points };
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
    const bobgoRail = await this.settings.get(FLAGS.bobgoEnabled);
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
      // Same rule as the single-line quote, and gated the same way: the
      // buyer's choice only overrides the seller's on the Bob Go rail.
      if (bobgoRail) {
        if (!offersCourier(l.shippingMethods)) return null;
      } else if (
        l.shippingMethods.length > 0 &&
        !l.shippingMethods.includes(method)
      ) {
        return null;
      }
      weightGrams += l.weightGrams * qty;
      lengthCm = Math.max(lengthCm, l.lengthCm);
      widthCm = Math.max(widthCm, l.widthCm);
      heightCm += l.heightCm * qty;
      declaredValueCents += (l.price ?? 0) * qty;
    }
    const parcel: ParcelDims = { lengthCm, widthCm, heightCm, weightGrams };

    if (await this.settings.get(FLAGS.bobgoEnabled)) {
      // Consolidated groups quote exactly like a single line, just with the
      // combined box. Everything here returns null rather than throwing —
      // including an outage — because this method's ONLY error contract is
      // null, and the caller (transactions.service.ts createOrderCheckout)
      // invokes it without a try/catch. A thrown error would turn a whole
      // multi-item cart checkout into a 500 instead of falling back to
      // per-line quoting, which is the designed behaviour.
      const first = byId.get(items[0].listingId)!;
      if (!dest.deliveryAddress) return null;
      let from: TcgResidentialAddress;
      try {
        from = first.isDealListing
          ? await this.dealCollectionOrigin(first.id)
          : {
              streetAddress: first.pickupStreet ?? '',
              suburb: first.pickupSuburb ?? '',
              city: first.pickupCity ?? '',
              postalCode: first.pickupPostalCode ?? '',
              province: PROVINCE_LONG[first.province],
              lat: first.pickupLat ?? undefined,
              lng: first.pickupLng ?? undefined,
            };
      } catch {
        return null;
      }
      if (!from.streetAddress || !from.city) return null;
      const { quote } = await this.bobgoQuoteForSlot({
        slot: method,
        collection: from,
        delivery: dest.deliveryAddress,
        parcel,
        declaredValueCents,
        lockerId: dest.toLockerId ? Number(dest.toLockerId) : undefined,
      });
      return quote;
    }

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

      // Which rail carries this parcel. Read ONCE and reused for the whole
      // booking, so a flag flip (or a transient DB error inside settings.get,
      // which fails back to the default) cannot have us quote against one
      // carrier and book against the other halfway through.
      const useBobGo = await this.settings.get(FLAGS.bobgoEnabled);

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

      // P6.2 — the physical parcel is the CARRIER line plus every live sibling
      // that ships with it. Combine into one conservative stacked box (max L,
      // max W, Σ height×qty; Σ weight×qty) so the booked shipment matches the
      // combined quote the buyer was charged. Declared value = Σ line totals.
      // A standalone tx has no siblings → identical to single-parcel behaviour.
      //
      // HOISTED out of the TCG branch (was inline there): Pudo never needed
      // dimensions because its service code already encodes the reserved box
      // size, but Bob Go's create call takes explicit parcel dimensions for
      // BOTH door and pickup-point shipments. Computing it once above the
      // branch keeps a single definition of "what is in the box" — the
      // alternative was a second copy that could drift from the quoted price.
      let weightGrams = (tx.listing.weightGrams ?? 0) * tx.quantity;
      let lengthCm = tx.listing.lengthCm ?? 0;
      let widthCm = tx.listing.widthCm ?? 0;
      let heightCm = (tx.listing.heightCm ?? 0) * tx.quantity;
      let declaredValueCents = tx.listingPrice;
      // Defensive: the loader above always includes shippedWith, but this
      // computation now runs for PUDO too, and the PUDO path never touched it
      // before. A missing relation must degrade to "no siblings" — a thrown
      // TypeError here would land in the catch below and downgrade a
      // perfectly bookable sale to manual dispatch.
      const siblings = Array.isArray(tx.shippedWith) ? tx.shippedWith : [];
      for (const s of siblings) {
        weightGrams += (s.listing.weightGrams ?? 0) * s.quantity;
        lengthCm = Math.max(lengthCm, s.listing.lengthCm ?? 0);
        widthCm = Math.max(widthCm, s.listing.widthCm ?? 0);
        heightCm += (s.listing.heightCm ?? 0) * s.quantity;
        declaredValueCents += s.listingPrice;
      }

      // Seller-side collection address, as a LAZY closure.
      //
      // Lazy on purpose: the legacy Pudo path never needed a street address
      // (L2L collects from any locker), so evaluating this eagerly would start
      // throwing 'seller pickup address incomplete' for Pudo sellers who have
      // always booked fine. Bob Go needs it for BOTH slots, so it has to be
      // reachable from both branches — but only actually run when asked.
      const collectionAddress = (): TcgResidentialAddress => {
        const L = tx.listing;
        // DD-F4 — deals collect from the supplier warehouse (a business
        // address); ordinary sales collect from the seller's pickup* columns.
        if (isDeal) {
          if (
            !supplier ||
            !supplier.warehouseStreet ||
            !supplier.warehouseCity ||
            !supplier.warehousePostalCode
          ) {
            throw new Error('supplier warehouse address incomplete');
          }
          return {
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
        }
        if (
          !L.pickupStreet ||
          !L.pickupCity ||
          L.pickupLat == null ||
          L.pickupLng == null
        ) {
          throw new Error('seller pickup address incomplete');
        }
        return {
          streetAddress: L.pickupStreet,
          suburb: L.pickupSuburb ?? '',
          city: L.pickupCity,
          postalCode: L.pickupPostalCode ?? '',
          province: PROVINCE_LONG[L.province],
          lat: L.pickupLat,
          lng: L.pickupLng,
        };
      };

      let result: CarrierShipmentResult;
      if (useBobGo) {
        // ONE call books either slot — Bob Go carries both door and
        // pickup-point shipments, and the chosen locker (when there is one) is
        // baked into the service code rather than passed separately.
        //
        // The rate snapshot must be COMPLETE. Bob Go needs provider_slug and
        // service_level_code alongside service_code, and both vary per rate
        // within a single quote response, so they cannot be inferred here. A
        // row quoted on the legacy rail (or through a path that only ever
        // snapshotted the service code) has no business being booked against
        // Bob Go days later with a guessed provider — throw, and let the catch
        // below hand it to the seller's manual dispatch fallback.
        if (!tx.shippingProviderSlug || !tx.shippingServiceLevelCode) {
          throw new Error(
            'order was quoted before the Bob Go rail was enabled (no provider/service-level snapshot) — book this one manually',
          );
        }
        const d = tx.deliveryAddress as {
          streetAddress: string;
          suburb: string;
          city: string;
          province: Province;
          postalCode: string;
        } | null;
        // Bob Go needs a delivery address for BOTH slots — a pickup-point
        // shipment is still routed from the buyer's address. Legacy Pudo orders
        // never captured one, which is exactly why this must fail loudly rather
        // than book the parcel to nowhere.
        if (!d?.streetAddress || !d.suburb || !d.city || !d.postalCode || !d.province) {
          throw new Error('delivery address is incomplete for courier booking');
        }
        if (!PROVINCE_LONG[d.province]) {
          throw new Error(`invalid delivery province on transaction: ${d.province}`);
        }
        const from = collectionAddress();
        result = await this.bookWithBobGo({
          slot: tx.shippingMethod,
          collection: {
            company: from.company,
            streetAddress: from.streetAddress,
            suburb: from.suburb,
            city: from.city,
            province: from.province,
            postalCode: from.postalCode,
          },
          delivery: {
            streetAddress: d.streetAddress,
            suburb: d.suburb,
            city: d.city,
            province: PROVINCE_LONG[d.province],
            postalCode: d.postalCode,
          },
          collectionContact,
          deliveryContact,
          parcel: {
            lengthCm,
            widthCm,
            heightCm,
            weightKg: weightGrams / 1000,
            description: isDeal
              ? `All Outdoor Daily Deal collection${dealRef ? ` (ref ${dealRef})` : ''}: ${tx.listing.title}`.slice(0, 120)
              : undefined,
          },
          declaredValueCents,
          serviceCode: tx.shippingServiceCode,
          providerSlug: tx.shippingProviderSlug,
          serviceLevelCode: tx.shippingServiceLevelCode,
          customerReference: transactionId,
          instructions: isDeal
            ? `Collection for All Outdoor Daily Deal${dealRef ? ` — ref ${dealRef}` : ''}.`
            : undefined,
        });
      } else if (tx.shippingMethod === 'PUDO') {
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
        const fromAddress = collectionAddress();
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
        // Parcel + declared value are computed once above the branch.
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
              ? `All Outdoor Daily Deal collection${dealRef ? ` (ref ${dealRef})` : ''}: ${tx.listing.title}`.slice(
                  0,
                  120,
                )
              : undefined,
          },
          declaredValueCents,
          collectionContact,
          deliveryContact,
          specialInstructions: isDeal
            ? `Collection for All Outdoor Daily Deal${dealRef ? ` — ref ${dealRef}` : ''}.`
            : undefined,
        });
      }

      // Persist the booking. trackingReference is the carrier waybill the
      // existing tracking poll/webhook already keys on.
      //
      // A carrier that RESPONDED is not the same as a carrier that AGREED.
      // Pudo and TCG are booked-or-throw, so for them reaching this line was
      // always the confirmation. Bob Go returns HTTP 201 for shipments the
      // courier then refuses, so the result has to be read, not assumed.
      if (result.submission === 'FAILED') {
        // Deliberately thrown rather than handled here: the catch below already
        // does exactly the right things — releases the booking claim so an
        // admin can retry, raises the dedup'd admin alert, and pings the seller
        // to dispatch manually. A second, parallel failure path would only be
        // a worse copy of it. The carrier's shipment id goes into the message
        // because the refused shipment still exists on their side.
        throw new Error(
          `carrier refused the shipment (${result.provider} #${result.shipmentId}): ${result.failedReason ?? result.status ?? 'no reason given'}`,
        );
      }

      if (result.submission === 'PENDING') {
        // Created but not yet accepted — a state neither legacy carrier could
        // produce. Record enough to poll and to cancel it, but do NOT stamp
        // shipmentBookedAt and do NOT notify anybody: to the seller, the buyer
        // and every cron, this order is still un-booked, which is the truth.
        //
        // The booking claim is deliberately NOT released. Releasing it would
        // let a retry create a SECOND shipment (and a second wallet charge)
        // while the first is still pending. resolvePendingBobGoBookings() owns
        // this row now and will either finish it or release it.
        await this.prisma.transaction.update({
          where: { id: transactionId },
          data: {
            carrierShipmentId: result.shipmentId,
            trackingReference: result.trackingReference,
            carrierProvider: result.provider,
          },
        });
        this.logger.warn(
          `Shipment ${result.shipmentId} for ${transactionId} created but NOT yet accepted by ${result.provider} ` +
            `(status "${result.status ?? 'unknown'}") — awaiting resolution, seller not notified`,
        );
        return result;
      }

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          carrierShipmentId: result.shipmentId,
          carrierDropoffPin: result.pin ?? null,
          trackingReference: result.trackingReference,
          carrierProvider: result.provider,
          shipmentBookedAt: new Date(),
        },
      });
      this.logger.log(
        `Shipment booked for ${transactionId}: ${result.provider} (${result.carrier} slot) waybill ${result.trackingReference}${result.pin ? ` (PIN ${result.pin})` : ''}`,
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

  /**
   * Book a shipment with Bob Go, for either slot.
   *
   * Bob Go carries both door and pickup-point parcels, and the chosen locker
   * (when there is one) is encoded in the service code, so unlike Pudo/TCG
   * there is no per-slot request shape — the slot only decides which enum
   * value we report back.
   *
   * IMPORTANT: this returns normally for refused shipments. The submission
   * state on the result is the answer; a resolved promise is not.
   */
  private async bookWithBobGo(input: {
    slot: 'PUDO' | 'TCG';
    collection: BobGoAddress;
    delivery: BobGoAddress;
    collectionContact: CarrierContact;
    deliveryContact: CarrierContact;
    parcel: {
      lengthCm: number;
      widthCm: number;
      heightCm: number;
      weightKg: number;
      description?: string;
    };
    declaredValueCents: number;
    serviceCode: string;
    providerSlug: string;
    serviceLevelCode: string;
    customerReference?: string;
    instructions?: string;
  }): Promise<CarrierShipmentResult> {
    const r = await this.bobgo.createShipment({
      collection: input.collection,
      delivery: input.delivery,
      collectionContact: input.collectionContact,
      deliveryContact: input.deliveryContact,
      parcels: [input.parcel],
      serviceCode: input.serviceCode,
      providerSlug: input.providerSlug,
      serviceLevelCode: input.serviceLevelCode,
      declaredValueCents: input.declaredValueCents,
      customerReference: input.customerReference,
      instructionsCollection: input.instructions,
    });
    return {
      carrier: input.slot,
      provider: 'BOBGO',
      submission: r.submission,
      failedReason: r.failedReason,
      shipmentId: String(r.shipmentId),
      trackingReference: r.trackingReference,
      pin: r.pin,
      // The RAW submission status, not a friendly one — when a booking sits
      // PENDING this string is the only clue to which unrecognised word Bob Go
      // used, and widening classifySubmission's allowlist depends on seeing it.
      status: r.rawSubmissionStatus,
    };
  }

  /**
   * Finish (or abandon) Bob Go bookings the courier had not yet accepted.
   *
   * A PENDING booking is a shipment Bob Go created and answered 201 for, but
   * which no courier has agreed to collect. bookForTransaction deliberately
   * leaves those rows un-stamped and un-announced, and deliberately KEEPS the
   * booking claim so nothing re-books them behind our back. That makes this
   * method the sole owner of those rows — without it they sit in limbo for
   * ever, and the seller is never told to dispatch manually.
   *
   * ONE list request per tick, matched locally. See BobGoService.listShipments.
   *
   * Never throws: it runs on a cron, and one bad row must not stop the rest.
   */
  async resolvePendingBobGoBookings(stuckAfterHours = 6): Promise<{
    checked: number;
    booked: number;
    failed: number;
    stillPending: number;
  }> {
    const out = { checked: 0, booked: 0, failed: 0, stillPending: 0 };
    const pending = await this.prisma.transaction
      .findMany({
        where: {
          carrierProvider: 'BOBGO',
          carrierShipmentId: { not: null },
          shipmentBookedAt: null,
          shipmentBookingStartedAt: { not: null },
        },
        select: {
          id: true,
          carrierShipmentId: true,
          shipmentBookingStartedAt: true,
        },
      })
      .catch(() => []);
    if (pending.length === 0) return out;
    out.checked = pending.length;

    let shipments: Awaited<ReturnType<BobGoService['listShipments']>>;
    try {
      shipments = await this.bobgo.listShipments();
    } catch (err) {
      // Bob Go unreachable — leave every row exactly as it is and try again
      // next tick. Treating an outage as a refusal would refund live parcels.
      this.logger.warn(
        `resolvePendingBobGoBookings: could not reach Bob Go (${(err as Error).message}) — no rows touched`,
      );
      out.stillPending = pending.length;
      return out;
    }
    const byId = new Map(shipments.map((s) => [String(s.shipmentId), s]));

    for (const tx of pending) {
      const live = byId.get(String(tx.carrierShipmentId));
      if (!live) {
        // The shipment we created is not in the account listing. That is not a
        // refusal we can act on — it could be pagination or a filter we do not
        // understand — so leave the row alone and surface it rather than
        // guessing at a parcel's fate.
        out.stillPending++;
        this.logger.warn(
          `resolvePendingBobGoBookings: shipment ${tx.carrierShipmentId} for ${tx.id} not present in the Bob Go listing`,
        );
        continue;
      }

      if (live.submission === 'SUBMITTED') {
        await this.prisma.transaction
          .update({
            where: { id: tx.id },
            data: {
              shipmentBookedAt: new Date(),
              carrierDropoffPin: live.pin ?? null,
              trackingReference: live.trackingReference || undefined,
            },
          })
          .catch(() => undefined);
        out.booked++;
        this.logger.log(
          `Bob Go shipment ${live.shipmentId} accepted — ${tx.id} now booked`,
        );
        // Only NOW does the seller get the waybill: this is the first moment a
        // courier has actually agreed to collect.
        await this.notifySellerShipmentBooked(tx.id).catch(() => undefined);
        continue;
      }

      if (live.submission === 'FAILED') {
        // Release the claim so the order can be retried or dispatched by hand,
        // and clear the carrier fields — keeping a tracking reference for a
        // refused shipment is what puts a dead waybill in front of a buyer.
        await this.prisma.transaction
          .update({
            where: { id: tx.id },
            data: {
              shipmentBookingStartedAt: null,
              carrierShipmentId: null,
              trackingReference: null,
              carrierProvider: null,
            },
          })
          .catch(() => undefined);
        out.failed++;
        this.logger.error(
          `Bob Go refused shipment ${live.shipmentId} for ${tx.id}: ${live.failedReason ?? live.rawSubmissionStatus}`,
        );
        await this.raiseBookingFailedAlert(
          tx.id,
          `Bob Go refused the shipment after creating it: ${live.failedReason ?? live.rawSubmissionStatus}`,
        );
        void this.notifyBookingFailedSeller(tx.id).catch(() => undefined);
        continue;
      }

      out.stillPending++;
      // A booking that never resolves is worse than one that fails, because
      // nothing else in the system will ever look at it again. Escalate once
      // it has outlived any plausible courier response time.
      const startedAt = tx.shipmentBookingStartedAt?.getTime() ?? Date.now();
      const ageHours = (Date.now() - startedAt) / 3_600_000;
      if (ageHours >= stuckAfterHours) {
        await this.raiseBookingFailedAlert(
          tx.id,
          `Bob Go shipment ${live.shipmentId} has been awaiting courier acceptance for ${Math.floor(ageHours)}h (status "${live.rawSubmissionStatus}") — check the Bob Go portal`,
        );
      }
    }

    this.logger.log(
      `resolvePendingBobGoBookings: ${out.checked} checked, ${out.booked} booked, ${out.failed} failed, ${out.stillPending} still pending`,
    );
    return out;
  }

  /**
   * Record WHY a courier shipment failed, and bill the seller when it was
   * their error.
   *
   * Called by an admin working a failed shipment, so the reason is a human's
   * judgement rather than a carrier string — the carrier tells us THAT a
   * delivery failed, almost never whose fault it was.
   *
   * The charge accumulates on the transaction and is subtracted at payout. It
   * does NOT touch sellerPayout, which stays a snapshot of the agreed sale.
   */
  async recordShipmentFailure(
    transactionId: string,
    reason: ShipmentFailureReason,
    note?: string,
  ): Promise<{ charged: boolean; chargeCents: number }> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        shippingCost: true,
        failedShipmentChargeCents: true,
        sellerId: true,
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const charge = sellerPaysFor(reason) ? failedShipmentChargeCents(tx) : 0;

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        shipmentFailureReason: reason,
        shipmentFailureNote: note?.slice(0, 500) ?? null,
        shipmentFailureAt: new Date(),
        // ACCUMULATES — a second failure adds a second wasted courier charge.
        failedShipmentChargeCents: { increment: charge },
      },
    });

    this.logger.warn(
      `Shipment failed for ${transactionId}: ${reason}` +
        (charge > 0
          ? ` — R${(charge / 100).toFixed(2)} charged to the seller (deducted at payout)`
          : ' — no seller charge'),
    );
    return { charged: charge > 0, chargeCents: charge };
  }

  /**
   * Clear a failed booking so the sale can be booked with the carrier again.
   *
   * Does NOT itself call the carrier. It returns the sale to the state
   * bookForTransaction expects — no shipment, no claim — and that one method
   * stays the only thing that ever books, keeping the idempotency claim and
   * the three-way submission handling in a single place.
   *
   * Refuses when the seller has not fixed what broke it. A parcel that did not
   * fit will not fit the second time, and rebooking without corrected
   * measurements just burns another courier charge (theirs) and delays the
   * buyer again.
   */
  async rebookShipment(transactionId: string): Promise<{ rebooked: boolean; reason?: string }> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        paymentStatus: true,
        shipmentFailureReason: true,
        shipmentFailureAt: true,
        listing: {
          select: { weightGrams: true, lengthCm: true, widthCm: true, heightCm: true, updatedAt: true },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    // Same money backstop bookForTransaction uses: never re-book a sale whose
    // funds are not held.
    if (tx.paymentStatus !== 'HELD') {
      return { rebooked: false, reason: 'Funds are no longer held for this sale.' };
    }
    if (!tx.shipmentFailureAt || !tx.shipmentFailureReason) {
      return { rebooked: false, reason: 'This shipment has not been marked as failed.' };
    }

    const failureReason = tx.shipmentFailureReason as ShipmentFailureReason;
    if (requiresRemeasure(failureReason)) {
      const L = tx.listing;
      const measured =
        !!L.weightGrams && !!L.lengthCm && !!L.widthCm && !!L.heightCm;
      // The measurements must have been touched SINCE the failure — merely
      // having dimensions is what got us here.
      const remeasured = measured && L.updatedAt > tx.shipmentFailureAt;
      if (!remeasured) {
        return {
          rebooked: false,
          reason:
            'Update the parcel size and weight on the listing first — the parcel did not fit the measurements given.',
        };
      }
    }

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        // Release the booking so bookForTransaction can claim it afresh. The
        // old carrier shipment is dead — it already failed — so its id and
        // waybill must go, or the seller's UI keeps showing a dead waybill and
        // cancelForTransaction would chase a shipment that no longer matters.
        carrierShipmentId: null,
        carrierDropoffPin: null,
        trackingReference: null,
        carrierProvider: null,
        shipmentBookedAt: null,
        shipmentBookingStartedAt: null,
        shippingStatus: null,
        shipmentRebookCount: { increment: 1 },
        // The failure itself is deliberately NOT cleared: the reason, the note
        // and the accumulated charge are the record of what happened and why
        // the seller is being billed. Only the booking is reset.
      },
    });

    const result = await this.bookForTransaction(transactionId);
    if (!result) {
      return { rebooked: false, reason: 'The courier could not be booked. Try again shortly.' };
    }
    this.logger.log(`Shipment re-booked for ${transactionId} after ${failureReason}`);
    return { rebooked: true };
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
          carrierProvider: true,
          carrierShipmentId: true,
          shipmentBookedAt: true,
          shippingStatus: true,
        },
      })
      .catch(() => null);
    // Gate on the SHIPMENT ID, not on shipmentBookedAt. A Bob Go booking that
    // is still awaiting the courier's acceptance deliberately has no
    // shipmentBookedAt — but it does have a real shipment on the carrier's
    // side, and a reversed sale must still cancel it. Gating on the booked
    // stamp (as this did) would silently walk past exactly those rows and
    // leave a live parcel against a refunded order.
    if (!tx?.carrierShipmentId) return; // nothing was ever created

    const moving =
      tx.shippingStatus && tx.shippingStatus !== 'PENDING';
    if (moving) {
      await this.raiseBookingFailedAlert(
        transactionId,
        `Sale reversed but parcel already ${tx.shippingStatus} — cancel/recover with the carrier manually`,
      );
      return;
    }

    // Route on the carrier that actually HOLDS the parcel, never on the enum
    // slot — Bob Go sits behind both slots, so shippingMethod no longer names
    // an API. Null carrierProvider means a row booked before the column
    // existed, which can only be Pudo or TCG, so the slot is the right
    // fallback for those and only those.
    const provider = tx.carrierProvider ?? tx.shippingMethod;

    let ok = false;
    if (provider === 'BOBGO') {
      // Bob Go exposes no cancel endpoint that we have been able to verify, so
      // there is nothing honest to call here. Say so loudly rather than
      // returning a quiet false that reads like "the carrier declined": an
      // operator has to reclaim this one by hand, and the wallet charge and a
      // collectable parcel are both still live until they do.
      await this.raiseBookingFailedAlert(
        transactionId,
        `Sale reversed but Bob Go shipment ${tx.carrierShipmentId} cannot be cancelled automatically (no cancel API) — cancel it in the Bob Go portal to reclaim the charge and stop the collection`,
      );
      return;
    }
    try {
      ok =
        provider === 'PUDO'
          ? await this.pudo.cancelShipment(tx.carrierShipmentId)
          : provider === 'TCG'
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
        `Shipment cancelled for ${transactionId} (${provider} ${tx.carrierShipmentId})`,
      );
    } else {
      // Keep the marker (so the orphan stays visible) + alert for manual cleanup.
      await this.raiseBookingFailedAlert(
        transactionId,
        'Shipment cancel failed — cancel manually with the carrier to reclaim the wallet charge',
      );
    }
  }

  /**
   * Send the seller their "ship it now" pack (inbox + email + critical SMS).
   *
   * Loads its own row rather than taking a payload, because it is called from
   * two places that know very different things: bookForTransaction, which has
   * everything in hand, and resolvePendingBobGoBookings, which is finishing a
   * booking made minutes or hours earlier in a different process.
   *
   * The SMS this triggers is sent `critical: true` — it bypasses the seller's
   * SMS mute. Only ever call it once a courier has actually accepted the job.
   */
  private async notifySellerShipmentBooked(
    transactionId: string,
  ): Promise<void> {
    const tx = await this.prisma.transaction
      .findUnique({
        where: { id: transactionId },
        select: {
          shippingMethod: true,
          carrierProvider: true,
          trackingReference: true,
          carrierDropoffPin: true,
          listing: { select: { title: true, isDealListing: true } },
          seller: {
            select: {
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
        },
      })
      .catch(() => null);
    if (!tx?.trackingReference) return;

    const sellerName =
      [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
      tx.seller.username ||
      'Seller';
    try {
      await this.notifications.shipmentBooked({
        sellerEmail: tx.seller.email,
        sellerName,
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        transactionId,
        carrier: tx.shippingMethod as 'PUDO' | 'TCG',
        // Decides what the seller is actually told to DO — see the copy branch
        // in notifications.service. Without it a Bob Go pickup-point sale would
        // tell them to walk the parcel to a locker while a courier is on its
        // way to their door.
        provider: tx.carrierProvider as 'PUDO' | 'TCG' | 'BOBGO' | null,
        trackingReference: tx.trackingReference,
        dropoffPin: tx.carrierDropoffPin ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `shipmentBooked notify failed for ${transactionId}: ${(e as Error).message}`,
      );
      await this.raiseBookingFailedAlert(
        transactionId,
        'Shipment booked but seller notification failed: ' + (e as Error).message,
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
          buyer: { select: { email: true, firstName: true, phone: true } },
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
      const buyerPhone = transaction.buyer.phone;
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
          void this.notifications.shippingOutForDelivery(buyerEmail, buyerName, title, transactionId, buyerPhone);
          break;
        case 'DELIVERED':
          void this.notifications.shippingDelivered(buyerEmail, buyerName, title, transactionId, buyerPhone);
          break;
        case 'DELIVERY_FAILED':
          void this.notifications.shippingFailed(buyerEmail, buyerName, title, transactionId);
          break;
        case 'RETURNED':
          // The parcel went BACK to the sender — tell the buyer their money
          // is safe and support will sort delivery/refund (was fully silent).
          void this.notifications.shippingFailed(buyerEmail, buyerName, title, transactionId);
          break;
      }

      // DELIVERY_FAILED / RETURNED are money-critical dead ends: deliveredAt
      // never gets set, so the stuck-held-funds sweep never sees the order and
      // the buyer's money stays HELD with ZERO admin signal. Raise an
      // AdminAlert IN THE SAME DB TRANSACTION as the status write (atomic).
      // The current!==newStatus guard above makes this once-per-status.
      if (newStatus === 'DELIVERY_FAILED' || newStatus === 'RETURNED') {
        await tx.adminAlert.create({
          data: {
            type:
              newStatus === 'RETURNED'
                ? 'SHIPMENT_RETURNED'
                : 'SHIPMENT_DELIVERY_FAILED',
            referenceId: transactionId,
            urgent: newStatus === 'RETURNED',
            context: `Courier reports ${newStatus === 'RETURNED' ? 'parcel RETURNED to sender' : 'delivery FAILED'} for "${title}" (${transactionId}). Buyer's payment is still HELD and no sweep will pick this up — decide redeliver vs refund.`,
          },
        });
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

    // Single source of truth in status-map.ts (shared with the polling path)
    // so the webhook + poll can never disagree on what a status means.
    const status: ShippingStatus | null = shiplogicToShippingStatus(
      String(payload.status ?? ''),
    );
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
}
