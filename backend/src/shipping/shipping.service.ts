import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Province } from '@prisma/client';
// Shared so the address on a waybill and the location in a dispute record can
// never name different places. See common/province-labels.ts.
import { PROVINCE_LONG } from '../common/province-labels';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BobGoService } from './bobgo.service';
import { planShippingGroups } from './consolidation';
import type { BobGoAddress, BobGoRate } from './bobgo.types';
import {
  cheapestDoorRate,
  fastestDoorRate,
  pickupPointRates,
  rateToQuote,
} from './bobgo-adapter';
import { deliveryDaysFor } from './service-levels';
import { collectionMinDateFromDate, windowToBobGo } from './pickup-dates';
import type { ParcelDims, ShippingQuote } from './shipping.types';
import { displayShippingCents } from '../payments/fee.calculator';
import { CarrierAddress, CarrierContact, CarrierShipmentResult } from './carrier.types';
import {
  failedShipmentChargeCents,
  requiresRemeasure,
  sellerPaysFor,
  type ShipmentFailureReason,
} from '../common/shipment-failure-policy';

export type ShippingMethod = 'COURIER' | 'DEALER_TRANSFER';

/**
 * The courier delivery shapes. Everything else on ShippingMethod
 * (DEALER_TRANSFER, PRIVATE_ARRANGE, COLLECTION, ON_SITE_SERVICE) is a
 * non-courier hand-over and is NOT the buyer's to choose.
 *
 * Since 2026-09-24 there is exactly ONE courier shape: door-to-door via Bob Go.
 * Pudo lockers and The Courier Guy were retired.
 */
const COURIER_METHODS = ['COURIER'] as const;

/**
 * The stacked box a group of cart lines ships as.
 *
 * ONE implementation, shared by the delivery MENU and the checkout RE-QUOTE.
 * If these two ever computed different boxes, the buyer would be shown a price
 * for one parcel and charged for another — so this is deliberately the only
 * place the arithmetic exists.
 *
 * Widest footprint, summed height, summed weight: the conservative shape, and
 * the one booking already hands the carrier.
 */
export function stackParcel(
  items: Array<{ weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; priceCents: number; quantity: number }>,
): { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; declaredValueCents: number } {
  let weightGrams = 0, lengthCm = 0, widthCm = 0, heightCm = 0, declaredValueCents = 0;
  for (const it of items) {
    const qty = Math.max(1, it.quantity);
    weightGrams += it.weightGrams * qty;
    lengthCm = Math.max(lengthCm, it.lengthCm);
    widthCm = Math.max(widthCm, it.widthCm);
    heightCm += it.heightCm * qty;
    declaredValueCents += it.priceCents * qty;
  }
  return { weightGrams, lengthCm, widthCm, heightCm, declaredValueCents };
}

function offersCourier(shippingMethods: string[]): boolean {
  if (shippingMethods.length === 0) return true; // unset = no restriction
  return shippingMethods.some((m) => (COURIER_METHODS as readonly string[]).includes(m));
}

/**
 * One door option as the buyer sees it. `priceCents` already carries our 10%
 * margin; `carrierRateCents` is the pure remittance (the fee maths runs on it).
 * `deliveryDays*` come from the static service-level lookup so the UI can label
 * speed without another call.
 */
export interface DoorOption {
  priceCents: number;
  carrierRateCents: number;
  serviceName: string;
  serviceCode: string;
  providerSlug: string;
  serviceLevelCode: string;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
}

/** A Pargo counter option. Adds the location the booking must replay. */
export interface PickupPointOption extends DoorOption {
  pickupPointLocationId: number;
  pickupPointDistanceKm?: number;
  /** Address + trading hours, from Bob Go's rate description. */
  description?: string;
}

export interface DeliveryMenu {
  /** Cheapest door rate, retained as the menu's default. */
  door: DoorOption | null;
  fastestDoor: DoorOption | null;
  storePickup: PickupPointOption[];
}

export interface DeliverySelection {
  deliveryOption?: 'DOOR_CHEAPEST' | 'DOOR_FASTEST' | 'STORE_PICKUP';
  pickupPointLocationId?: number;
}

/**
 * One parcel's worth of delivery as the cart sees it. Mirrors the
 * single-listing `deliveryOptions` shape exactly so the same component renders
 * both.
 */
export interface CartDeliveryGroup {
  groupKey: string;
  listingIds: string[];
  /** True when these listings ship as ONE waybill - one delivery charge. */
  consolidated: boolean;
  /** Cheapest door rate (the default selection). Kept as `door` for every
   *  existing consumer; it IS cheapestDoor. */
  door: DoorOption | null;
  /** Fastest door rate (fewest business days, price tie-break). Null when no
   *  door rate exists. */
  fastestDoor?: DoorOption | null;
  /** Nearest Pargo counters (up to 5). Empty when the route has no pickup
   *  point or the caller did not request them. */
  storePickup?: PickupPointOption[];
  /** Set when THIS group alone could not be quoted; others still render. */
  unavailableReason?: string;
}

export interface QuoteRequestBody {
  listingId: string;
  shippingMethod: ShippingMethod;
  /** The buyer's delivery address (with coords). Required for a courier quote. */
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
  | 'READY_FOR_PICKUP'
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
  // At the counter awaiting the buyer — same tier as out-for-delivery: the
  // parcel is at its destination, just not in the buyer's hands yet.
  READY_FOR_PICKUP: 3,
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
    private readonly bobgo: BobGoService,
  ) {}

  /**
   * Returns allowed shipping methods for a listing.
   * Absolute rule (CLAUDE.md): firearms → DEALER_TRANSFER only.
   */
  getDeliveryOptions(isFirearm: boolean): ShippingMethod[] {
    if (isFirearm) return ['DEALER_TRANSFER'];
    return ['COURIER'];
  }

  /**
   * Quote a route through Bob Go and return the cheapest door-to-door rate.
   *
   * Shared by quoteForListing and quoteCombined so the unit conversion and the
   * selection policy exist in exactly one place.
   *
   * Returns `outage` separately from an empty quote because the two mean
   * opposite things to a buyer. A null quote means "no door rate for this
   * route"; `outage` means the carrier could not be reached, which is
   * temporary and the buyer should be told to retry.
   */
  private async bobgoQuoteForRoute(input: {
    collection: CarrierAddress;
    delivery: {
      streetAddress: string;
      suburb: string;
      city: string;
      postalCode: string;
      province: Province;
    };
    parcel: ParcelDims;
    declaredValueCents: number;
    description?: string;
    selection?: DeliverySelection;
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
      // The collection address already carries the LONG province name.
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
      this.logger.warn(`Bob Go quote failed: ${(err as Error).message}`);
      return { quote: null, outage: true };
    }

    const quote = this.quoteFromMenu(this.menuFromRates(rates), input.selection ?? {});
    return { quote, outage: false };
  }

  /**
   * Live rate quote for a listing. Resolves the seller-side collection
   * address from the listing row, asks Bob Go for rates, and returns the
   * cheapest door rate. Returns a ShippingQuote the buyer sees on the checkout
   * breakdown and that we snapshot into Transaction.shippingCost when they hit
   * Pay.
   *
   * Throws BadRequestException with a user-readable reason if the listing
   * isn't courierable, dimensions/weight are missing, the seller doesn't offer
   * couriering, the delivery address is missing, or no door rate exists.
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
    if (!offersCourier(listing.shippingMethods)) {
      throw new BadRequestException(
        'This item is not available for courier delivery — arrange collection with the seller.',
      );
    }
    if (body.shippingMethod !== 'COURIER') {
      throw new BadRequestException(
        `${body.shippingMethod} doesn't use a courier rate.`,
      );
    }

    const parcel: ParcelDims = {
      lengthCm: listing.lengthCm,
      widthCm: listing.widthCm,
      heightCm: listing.heightCm,
      weightGrams: listing.weightGrams,
    };

    if (!body.deliveryAddress) {
      throw new BadRequestException(
        'Enter your delivery address first so we can quote a courier.',
      );
    }
    if (!listing.pickupStreet || !listing.pickupCity) {
      throw new BadRequestException(
        "Seller hasn't provided a collection address yet.",
      );
    }
    const from: CarrierAddress = {
      streetAddress: listing.pickupStreet,
      suburb: listing.pickupSuburb ?? '',
      city: listing.pickupCity,
      postalCode: listing.pickupPostalCode ?? '',
      province: PROVINCE_LONG[listing.province],
      lat: listing.pickupLat ?? undefined,
      lng: listing.pickupLng ?? undefined,
    };

    const { quote, outage } = await this.bobgoQuoteForRoute({
      collection: from,
      delivery: body.deliveryAddress,
      parcel,
      declaredValueCents: listing.price ?? 0,
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
        'No door-delivery rate available for this route right now.',
      );
    }
    return quote;
  }

  /**
   * The delivery option for this buyer, priced, in one call.
   *
   * Door-to-door only: the cheapest Bob Go door rate for this parcel and route.
   * Bob Go returns every provider's rates together, and the platform's policy
   * is to charge the buyer the cheapest. A null `door` means no door rate
   * exists for the route — distinct from the throw, which means we could not
   * ask.
   */
  async deliveryOptions(
    listingId: string,
    deliveryAddress: NonNullable<QuoteRequestBody['deliveryAddress']>,
  ): Promise<{
    /** Cheapest door rate — the default selection. */
    door: DoorOption | null;
    /** Fastest door rate (fewest business days). */
    fastestDoor: DoorOption | null;
    /** Nearest Pargo counters (up to 5); empty when none cover the route. */
    storePickup: PickupPointOption[];
  }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    // ITEM-CLASS GATE — if it can't be shipped, don't quote a courier for it.
    //
    // This runs BEFORE the parcel-dimension check on purpose. A firearm
    // carries weight and dimensions — the sell form requires them — so a
    // firearm listing would sail straight past the dimension check and this
    // endpoint would return live, priced, bookable-looking rates for a rifle.
    // The route is unauthenticated (shipping.controller.ts, no guard beyond
    // the global throttler), so that was reachable by anyone with a listing id.
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

    const from = {
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
        `Bob Go door-rate lookup failed: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'We could not reach the courier just now. Please try again in a moment.',
      );
    }

    return this.menuFromRates(rates);
  }

  /**
   * Re-quote the buyer's selected delivery option at Pay. The browser only
   * submits the option kind and (for Store Pickup) a counter id — never a
   * price, provider or service code. We regenerate Bob Go's menu and resolve
   * that selection server-side so stale/tampered prices cannot be charged.
   */
  async quoteForSelection(
    listingId: string,
    deliveryAddress: NonNullable<QuoteRequestBody['deliveryAddress']>,
    selection: DeliverySelection,
  ): Promise<ShippingQuote> {
    const menu = await this.deliveryOptions(listingId, deliveryAddress);
    const quote = this.quoteFromMenu(menu, selection);
    if (quote) return quote;
    throw new BadRequestException(
      selection.deliveryOption === 'STORE_PICKUP'
        ? 'That pickup point is no longer available. Please choose another option.'
        : 'That delivery option is no longer available. Please refresh the quote.',
    );
  }

  private quoteFromMenu(
    menu: DeliveryMenu,
    selection: DeliverySelection = {},
  ): ShippingQuote | null {
    const kind = selection.deliveryOption ?? 'DOOR_CHEAPEST';
    if (kind === 'STORE_PICKUP') {
      const point = menu.storePickup.find(
        (candidate) =>
          candidate.pickupPointLocationId === selection.pickupPointLocationId,
      );
      if (!point?.pickupPointLocationId) return null;
      return {
        serviceCode: point.serviceCode,
        serviceName: point.serviceName,
        priceCents: point.carrierRateCents,
        providerSlug: point.providerSlug,
        serviceLevelCode: point.serviceLevelCode,
        deliveryOption: kind,
        pickupPointLocationId: point.pickupPointLocationId,
        pickupPointSnapshot: {
          providerSlug: point.providerSlug,
          locationId: point.pickupPointLocationId,
          name: point.serviceName,
          description: point.description ?? null,
          distanceKm: point.pickupPointDistanceKm ?? null,
        },
      };
    }

    const door = kind === 'DOOR_FASTEST' ? menu.fastestDoor : menu.door;
    if (!door) return null;
    return {
      serviceCode: door.serviceCode,
      serviceName: door.serviceName,
      // ShippingQuote.priceCents is the pure carrier rate. The handling margin
      // is stored separately on Transaction and only added for buyer display.
      priceCents: door.carrierRateCents,
      providerSlug: door.providerSlug,
      serviceLevelCode: door.serviceLevelCode,
      deliveryOption: kind,
    };
  }

  /**
   * Turn a Bob Go rate list into the buyer-facing menu — the cheapest door,
   * the fastest door, and the nearest Pargo counters.
   *
   * Shared by the single-listing endpoint and the cart endpoint so both answer
   * in one shape. Bob Go returns door and pickup-point rates in ONE reply, so
   * there is no second call.
   */
  private menuFromRates(rates: BobGoRate[]): DeliveryMenu {
    return {
      door: this.doorOption(cheapestDoorRate(rates)),
      fastestDoor: this.doorOption(fastestDoorRate(rates)),
      // Nearest first (the buyer travels), capped at 5. Price is shown too;
      // Pargo prices are usually flat across counters near one address.
      storePickup: [...pickupPointRates(rates)]
        .sort(
          (a, b) =>
            (a.pickupPointDistanceKm ?? Infinity) -
            (b.pickupPointDistanceKm ?? Infinity),
        )
        .slice(0, 5)
        .map((r) => this.pickupOption(r)),
    };
  }

  private doorOption(rate: BobGoRate | null): DoorOption | null {
    if (!rate) return null;
    const q = rateToQuote(rate);
    const days = deliveryDaysFor(rate.providerSlug, rate.serviceLevelCode);
    return {
      priceCents: withHandling(q.priceCents),
      carrierRateCents: q.priceCents,
      serviceName: rate.serviceName,
      serviceCode: rate.serviceCode,
      providerSlug: rate.providerSlug,
      serviceLevelCode: rate.serviceLevelCode,
      deliveryDaysMin: days.min,
      deliveryDaysMax: days.max,
      minDeliveryDate: rate.minDeliveryDate,
      maxDeliveryDate: rate.maxDeliveryDate,
    };
  }

  private pickupOption(rate: BobGoRate): PickupPointOption {
    const door = this.doorOption(rate)!;
    return {
      ...door,
      pickupPointLocationId: rate.pickupPointLocationId ?? 0,
      pickupPointDistanceKm: rate.pickupPointDistanceKm,
      description: rate.description,
    };
  }

  /**
   * The delivery menu for a whole CART - one menu per parcel it will ship as.
   *
   * WHY THIS EXISTS. `deliveryOptions` above takes exactly one listingId and
   * builds one parcel from it, so a cart could not use it: a cart consolidates
   * same-seller lines into a single waybill, and the price of that combined
   * box is arithmetically unrelated to the sum of its lines.
   *
   * Grouping comes from planShippingGroups, the SAME function checkout uses to
   * decide what to charge - see that module for why the frontend must not
   * compute these keys itself.
   *
   * A group that cannot be quoted degrades to `unavailableReason` rather than
   * failing the whole cart: with several sellers, one unservable parcel must
   * not hide the others.
   */
  async deliveryOptionsForCart(
    lines: Array<{ listingId: string; quantity?: number }>,
    // Only the fields Bob Go actually prices against. Deliberately NOT
    // NonNullable<QuoteRequestBody['deliveryAddress']>, which demands lat/lng:
    // Bob Go quotes off the address and drops coordinates entirely, so
    // requiring them here would force callers to invent 0,0 — which is exactly
    // how the legacy path ends up quoting the Gulf of Guinea.
    deliveryAddress: {
      streetAddress: string;
      suburb: string;
      city: string;
      postalCode: string;
      province: Province;
    },
  ): Promise<CartDeliveryGroup[]> {
    if (lines.length === 0) return [];

    const listings = await this.prisma.listing.findMany({
      where: { id: { in: lines.map((l) => l.listingId) } },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    const qtyById = new Map(
      lines.map((l) => [l.listingId, Math.max(1, l.quantity ?? 1)]),
    );

    const meta = new Map(
      listings.map((l) => [
        l.id,
        {
          sellerId: l.sellerId,
          isFirearm: l.isFirearm,
        },
      ]),
    );

    // Every courier line in a cart goes to ONE address, so the destination
    // half of the key is constant here and groups degenerate to owner|method —
    // which is exactly "one delivery charge per seller", what we want shown.
    const groups = planShippingGroups(
      lines.map((l) => ({
        listingId: l.listingId,
        shippingMethod: 'COURIER',
        quantity: qtyById.get(l.listingId),
        deliveryAddress,
      })),
      meta,
    );

    const out: CartDeliveryGroup[] = [];

    for (const g of groups) {
      const base = {
        groupKey: g.groupKey,
        listingIds: g.listingIds,
        consolidated: g.consolidated,
      };
      try {
        const items = g.listingIds.map((id) => byId.get(id)!);

        // Item-class gates, per listing. Same rules the single-listing
        // endpoint applies: a group is courierable only if every line is.
        const bad = items.find(
          (l) =>
            l.isFirearm ||
            l.collectionOnly ||
            l.isExperience ||
            !offersCourier(l.shippingMethods) ||
            !l.weightGrams ||
            !l.lengthCm ||
            !l.widthCm ||
            !l.heightCm,
        );
        if (bad) {
          out.push({
            ...base,
            door: null,
            fastestDoor: null,
            storePickup: [],
            unavailableReason:
              'One of these items cannot be sent by courier, so we cannot quote delivery for them together.',
          });
          continue;
        }

        const parcel = stackParcel(
          items.map((l) => ({
            weightGrams: l.weightGrams!,
            lengthCm: l.lengthCm!,
            widthCm: l.widthCm!,
            heightCm: l.heightCm!,
            priceCents: l.price ?? 0,
            quantity: qtyById.get(l.id) ?? 1,
          })),
        );

        const first = items[0];
        const from = {
          streetAddress: first.pickupStreet ?? '',
          suburb: first.pickupSuburb ?? '',
          city: first.pickupCity ?? '',
          postalCode: first.pickupPostalCode ?? '',
          province: PROVINCE_LONG[first.province],
          lat: first.pickupLat ?? undefined,
          lng: first.pickupLng ?? undefined,
        };

        const { rates } = await this.bobgo.getRates({
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
              weightKg: parcel.weightGrams / 1000,
              lengthCm: parcel.lengthCm,
              widthCm: parcel.widthCm,
              heightCm: parcel.heightCm,
              description: 'Order',
            },
          ],
          declaredValueCents: parcel.declaredValueCents,
        });

        const menu = this.menuFromRates(rates);

        out.push({
          ...base,
          door: menu.door,
          fastestDoor: menu.fastestDoor,
          storePickup: menu.storePickup,
          ...(menu.door === null
            ? {
                unavailableReason:
                  'No courier option for these items to that address.',
              }
            : {}),
        });
      } catch (err) {
        this.logger.warn(
          `deliveryOptionsForCart: group ${g.groupKey} failed: ${(err as Error).message}`,
        );
        out.push({
          ...base,
          door: null,
          fastestDoor: null,
          storePickup: [],
          unavailableReason:
            'Delivery options are briefly unavailable - please try again.',
        });
      }
    }

    return out;
  }


  // P6.2 — quote ONE consolidated parcel for 2+ items from the SAME seller,
  // shipping via the SAME method to the SAME destination. Combined weight =
  // Σ(item weight × qty); combined box = a conservative STACKED bounding box
  // (max length, max width, Σ height) so we never UNDER-quote (All Outdoor
  // remits the real carrier cost). Returns null when the combined parcel
  // cannot be quoted — the caller then falls back to per-line quoting so
  // checkout never breaks. All items must be the same seller's non-firearm,
  // non-collection, courier-offering listings.
  async quoteCombined(
    items: Array<{ listingId: string; quantity: number }>,
    method: 'COURIER',
    dest: {
      /** The buyer's address. REQUIRED — Bob Go quotes off it. */
      deliveryAddress?: QuoteRequestBody['deliveryAddress'];
    },
    selection: DeliverySelection = {},
  ): Promise<ShippingQuote | null> {
    if (items.length === 0) return null;
    if (method !== 'COURIER') return null;
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
      if (!offersCourier(l.shippingMethods)) return null;
      weightGrams += l.weightGrams * qty;
      lengthCm = Math.max(lengthCm, l.lengthCm);
      widthCm = Math.max(widthCm, l.widthCm);
      heightCm += l.heightCm * qty;
      declaredValueCents += (l.price ?? 0) * qty;
    }
    const parcel: ParcelDims = { lengthCm, widthCm, heightCm, weightGrams };

    // Consolidated groups quote exactly like a single line, just with the
    // combined box. Everything here returns null rather than throwing —
    // including an outage — because this method's ONLY error contract is null,
    // and the caller (transactions.service.ts createOrderCheckout) invokes it
    // without a try/catch. A thrown error would turn a whole multi-item cart
    // checkout into a 500 instead of falling back to per-line quoting.
    const first = byId.get(items[0].listingId)!;
    if (!dest.deliveryAddress) return null;
    const from: CarrierAddress = {
      streetAddress: first.pickupStreet ?? '',
      suburb: first.pickupSuburb ?? '',
      city: first.pickupCity ?? '',
      postalCode: first.pickupPostalCode ?? '',
      province: PROVINCE_LONG[first.province],
      lat: first.pickupLat ?? undefined,
      lng: first.pickupLng ?? undefined,
    };
    if (!from.streetAddress || !from.city) return null;
    const { quote } = await this.bobgoQuoteForRoute({
      collection: from,
      delivery: dest.deliveryAddress,
      parcel,
      declaredValueCents,
      selection,
    });
    return quote;
  }

  // ------------------------------------------------------------------
  // Platform-arranged shipment booking (P5.2)
  // ------------------------------------------------------------------
  // Books the real carrier shipment for a transaction and stamps the
  // waybill and any collection PIN onto it. Triggered when the seller
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
      if (tx.shippingMethod !== 'COURIER') {
        await this.releaseBookingClaim(transactionId);
        return null;
      }

      if (!tx.shippingServiceCode) {
        throw new Error(
          `${tx.shippingMethod} order has no service code — the shipping quote may be stale`,
        );
      }
      // The carrier coordinates collection + delivery, so a real mobile for
      // BOTH parties is required. Missing → fail-safe to the manual-dispatch
      // fallback rather than book a contactless shipment the carrier can't
      // coordinate.
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
      let weightGrams = (tx.listing.weightGrams ?? 0) * tx.quantity;
      let lengthCm = tx.listing.lengthCm ?? 0;
      let widthCm = tx.listing.widthCm ?? 0;
      let heightCm = (tx.listing.heightCm ?? 0) * tx.quantity;
      let declaredValueCents = tx.listingPrice;
      // Defensive: a missing relation must degrade to "no siblings" — a thrown
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

      // Seller-side collection address.
      const collectionAddress = (): CarrierAddress => {
        const L = tx.listing;
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

      // ONE call books a door shipment. The rate snapshot must be COMPLETE:
      // Bob Go needs provider_slug and service_level_code alongside
      // service_code, and both vary per rate within a single quote response, so
      // they cannot be inferred here. A row with no snapshot has no business
      // being booked — throw, and let the catch below hand it to the seller's
      // manual dispatch fallback.
      if (!tx.shippingProviderSlug || !tx.shippingServiceLevelCode) {
        throw new Error(
          'order has no provider/service-level snapshot — book this one manually',
        );
      }
      const d = tx.deliveryAddress as {
        streetAddress: string;
        suburb: string;
        city: string;
        province: Province;
        postalCode: string;
      } | null;
      // A courier needs a real delivery address — no legacy locker orders exist
      // any more, so this must fail loudly rather than book the parcel nowhere.
      if (!d?.streetAddress || !d.suburb || !d.city || !d.postalCode || !d.province) {
        throw new Error('delivery address is incomplete for courier booking');
      }
      if (!PROVINCE_LONG[d.province]) {
        throw new Error(`invalid delivery province on transaction: ${d.province}`);
      }
      const from = collectionAddress();
      // The seller's chosen pickup day/window (null when they accepted before
      // the picker existed or the sale wasn't couriered). Bob Go's own calendar
      // normalises the date.
      const collectionWin = windowToBobGo(tx.collectionWindow);
      const result = await this.bookWithBobGo({
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
        },
        declaredValueCents,
        serviceCode: tx.shippingServiceCode,
        providerSlug: tx.shippingProviderSlug,
        serviceLevelCode: tx.shippingServiceLevelCode,
        customerReference: transactionId,
        collectionMinDate: tx.collectionNotBeforeAt
          ? collectionMinDateFromDate(tx.collectionNotBeforeAt)
          : undefined,
        collectionAfter: collectionWin.after,
        collectionBefore: collectionWin.before,
        pickupPointLocationId:
          tx.deliveryOption === 'STORE_PICKUP'
            ? (tx.pickupPointLocationId ?? undefined)
            : undefined,
      });

      // Persist the booking. trackingReference is the carrier waybill the
      // webhook/poll already keys on.
      //
      // A carrier that RESPONDED is not the same as a carrier that AGREED.
      // Bob Go returns HTTP 201 for shipments the courier then refuses, so the
      // result has to be read, not assumed.
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
        `Shipment booked for ${transactionId}: ${result.provider} waybill ${result.trackingReference}${result.pin ? ` (PIN ${result.pin})` : ''}`,
      );

      // Notify the seller (SMS + email + inbox) with the waybill and the
      // "write it on the package" fallback. Best-effort — the booking already
      // succeeded; a notification hiccup must not undo it.
      const sellerName =
        [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
        tx.seller.username ||
        'Seller';
      const bookedPayload = {
        sellerEmail: tx.seller.email,
        sellerName,
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        transactionId,
        trackingReference: result.trackingReference,
        dropoffPin: result.pin ?? null,
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
   * Book a door shipment with Bob Go.
   *
   * IMPORTANT: this returns normally for refused shipments. The submission
   * state on the result is the answer; a resolved promise is not.
   */
  private async bookWithBobGo(input: {
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
    /** Earliest collection date (ISO +02:00) from the seller's pickup picker. */
    collectionMinDate?: string;
    /** Preferred window "HH:MM" → collection_after / collection_before. */
    collectionAfter?: string;
    collectionBefore?: string;
    /** Pargo counter id for a STORE_PICKUP booking. */
    pickupPointLocationId?: number;
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
      ...(input.collectionMinDate
        ? { collectionMinDate: input.collectionMinDate }
        : {}),
      ...(input.collectionAfter
        ? { collectionAfter: input.collectionAfter }
        : {}),
      ...(input.collectionBefore
        ? { collectionBefore: input.collectionBefore }
        : {}),
      ...(input.pickupPointLocationId != null
        ? { pickupPointLocationId: input.pickupPointLocationId }
        : {}),
    });
    return {
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

    // Bob Go exposes no cancel endpoint that we have been able to verify, so
    // there is nothing honest to call here. Say so loudly rather than
    // returning a quiet false that reads like "the carrier declined": an
    // operator has to reclaim this one by hand, and the wallet charge and a
    // collectable parcel are both still live until they do.
    await this.raiseBookingFailedAlert(
      transactionId,
      `Sale reversed but Bob Go shipment ${tx.carrierShipmentId} cannot be cancelled automatically (no cancel API) — cancel it in the Bob Go portal to reclaim the charge and stop the collection`,
    );
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
          trackingReference: true,
          carrierDropoffPin: true,
          listing: { select: { title: true } },
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
          deliveryOption: true, // STORE_PICKUP drives the ready/collected stamps
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
        readyForPickupAt?: Date;
        collectedAt?: Date;
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
        // On a STORE_PICKUP, DELIVERED means the BUYER collected it at the
        // counter — that is the event the payout clock's +24h runs from.
        if (transaction.deliveryOption === 'STORE_PICKUP') {
          dataPatch.collectedAt = now;
        }
      }
      if (newStatus === 'READY_FOR_PICKUP') {
        dataPatch.readyForPickupAt = now;
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
          // collected-or-later state. A carrier scans a parcel through several hubs
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
        case 'READY_FOR_PICKUP':
          // STORE_PICKUP: at the counter awaiting the buyer.
          void this.notifications.shippingReadyForPickup(buyerEmail, buyerName, title, transactionId, buyerPhone);
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

}
