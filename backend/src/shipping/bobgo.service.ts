import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  BobGoAddress,
  BobGoContact,
  BobGoLocation,
  BobGoParcel,
  BobGoQuote,
  BobGoRate,
  BobGoShipmentResult,
  BobGoSubmissionState,
  BobGoTracking,
} from './bobgo.types';

/**
 * Bob Go — the single courier rail, replacing BOTH Pudo and TCG.
 *
 * Why one service where there were two: Bob Go is an aggregator. A single
 * POST /rates-at-checkout returns door-to-door rates AND priced, distance-
 * ranked pickup-point rates in the same response, so the "quote TCG for
 * door, quote Pudo for lockers, merge" dance collapses into one call with
 * one wallet, one waybill format and one tracking vocabulary.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE THING TO KNOW BEFORE USING THIS CLASS
 *
 * `createShipment()` returning without throwing does NOT mean a courier is
 * collecting the parcel. Bob Go returns HTTP 201 for shipments the courier
 * subsequently refuses — the sandbox produced a 201 carrying
 * `submission_status: "no-rates"` and `app_status: "completed"` at the same
 * time. Callers MUST branch on `result.submission` and must not SMS the
 * buyer, print a waybill or mark the order shipped on anything other than
 * `'SUBMITTED'`.
 *
 * Both Pudo and TCG returned booked-or-threw, so every existing caller in
 * shipping.service.ts assumes success-on-return. That assumption is the
 * main thing the port has to unpick.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Config (backend/.env):
 *   BOBGO_API_KEY   Bearer token. Absent -> isConfigured false, service inert.
 *   BOBGO_BASE_URL  Defaults to sandbox. Set the production host at go-live.
 */
@Injectable()
export class BobGoService implements OnModuleInit {
  private readonly logger = new Logger(BobGoService.name);

  /**
   * Say out loud, at boot, which Bob Go we are pointed at.
   *
   * BOBGO_BASE_URL defaults to the SANDBOX, which is the opposite of every
   * other integration here (PUDO_BASE_URL and friends default to production).
   * Sandbox is the right default — you cannot accidentally spend real money or
   * dispatch a real parcel from it — but it makes the dangerous mistake the
   * quiet one: an operator who sets BOBGO_API_KEY and flips the admin switch,
   * which is an entirely reasonable go-live sequence, would have production
   * booking every parcel against a sandbox that accepts and then drops them.
   * A boot line naming the host is the cheapest way for that to be noticed.
   */
  onModuleInit(): void {
    if (!this.isConfigured) {
      this.logger.log('Bob Go inert — BOBGO_API_KEY not set');
      return;
    }
    if (this.isSandbox) {
      this.logger.warn(
        `Bob Go configured against the SANDBOX (${this.baseUrl}). ` +
          `No real parcel will ever move. Set BOBGO_BASE_URL to the ` +
          `production host before enabling the bobgo_enabled flag for real sales.`,
      );
    } else {
      this.logger.log(`Bob Go configured against ${this.baseUrl} (live)`);
    }
  }

  /** Sandbox by default — production must be set explicitly, never inferred. */
  private get baseUrl(): string {
    return (
      process.env.BOBGO_BASE_URL ?? 'https://api.sandbox.bobgo.co.za/v2'
    ).replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return process.env.BOBGO_API_KEY ?? '';
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** True when pointed at the sandbox — callers may want to refuse real money. */
  get isSandbox(): boolean {
    return this.baseUrl.includes('sandbox');
  }

  // ───────────────────────────── transport ─────────────────────────────

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new Error('BOBGO_API_KEY not configured');
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network failure or timeout. Deliberately NOT swallowed: a caller that
      // cannot tell "no rates" from "Bob Go is down" will quietly show a buyer
      // an empty shipping list during an outage and lose the sale.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Bob Go ${method} ${path} unreachable: ${reason}`);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Bob Go ${method} ${path} ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Bob Go ${method} ${path} returned non-JSON: ${text.slice(0, 200)}`,
      );
    }
  }

  private addressPayload(a: BobGoAddress) {
    return {
      company: a.company ?? '',
      street_address: a.streetAddress,
      local_area: a.suburb,
      city: a.city,
      // Long-form province ("Western Cape"). The API echoes back "WC".
      zone: a.province,
      country: a.country ?? 'ZA',
      code: a.postalCode,
    };
  }

  private parcelPayload(p: BobGoParcel) {
    return {
      submitted_length_cm: p.lengthCm,
      submitted_width_cm: p.widthCm,
      submitted_height_cm: p.heightCm,
      submitted_weight_kg: p.weightKg,
      ...(p.description ? { description: p.description } : {}),
    };
  }

  // ────────────────────────────── quoting ──────────────────────────────

  /**
   * Quote a route. Returns door and pickup-point options in one list.
   *
   * `items` is REQUIRED by the API even though it duplicates the parcel
   * dimensions — omitting it returns a 400, which cost a probe cycle to
   * discover. We derive it from the parcels rather than making callers
   * supply it twice.
   */
  async getRates(input: {
    collection: BobGoAddress;
    delivery: BobGoAddress;
    parcels: BobGoParcel[];
    /**
     * ZAR **CENTS**, matching every other price in this codebase and
     * TcgService.getQuote's declaredValueCents. Bob Go wants whole rand on the
     * wire, so the conversion happens here, once.
     *
     * The unit is in the NAME on purpose: shipping.service.ts:293 passes
     * `listing.price` (cents) straight into the TCG quote, and a client that
     * silently expected rand would declare a R1,500 parcel as R150,000 —
     * inflating liability cover and any value-based surcharge on every quote.
     */
    declaredValueCents: number;
    /** Optional line items; synthesised from parcels when absent. */
    items?: { description: string; price: number; quantity: number; sku?: string }[];
  }): Promise<BobGoQuote> {
    const declaredValueRand = toWholeRand(input.declaredValueCents);
    const items =
      input.items?.map((it, i) => ({
        description: it.description,
        price: it.price,
        quantity: it.quantity,
        sku: it.sku ?? `AO-${i + 1}`,
        length_cm: input.parcels[0]?.lengthCm ?? 1,
        width_cm: input.parcels[0]?.widthCm ?? 1,
        height_cm: input.parcels[0]?.heightCm ?? 1,
        weight_kg: input.parcels[0]?.weightKg ?? 0.1,
      })) ??
      input.parcels.map((p, i) => ({
        description: p.description ?? 'Parcel',
        price: declaredValueRand,
        quantity: 1,
        sku: `AO-${i + 1}`,
        length_cm: p.lengthCm,
        width_cm: p.widthCm,
        height_cm: p.heightCm,
        weight_kg: p.weightKg,
      }));

    const body = {
      collection_address: this.addressPayload(input.collection),
      delivery_address: this.addressPayload(input.delivery),
      parcels: input.parcels.map((p) => this.parcelPayload(p)),
      declared_value: declaredValueRand,
      items,
    };

    const raw = await this.call<{ rates?: unknown[] }>(
      'POST',
      '/rates-at-checkout',
      body,
    );

    const rates = (raw.rates ?? [])
      .map((r) => this.normaliseRate(r as Record<string, any>))
      .filter((r): r is BobGoRate => r !== null);

    return { rates, pricingVerified: false };
  }

  private normaliseRate(r: Record<string, any>): BobGoRate | null {
    const serviceCode = r.service_code;
    if (typeof serviceCode !== 'string' || !serviceCode) {
      // Without a service_code the rate cannot be booked, so it is not an
      // option — dropping it beats offering a price we cannot honour.
      this.logger.warn(`Bob Go rate ${r.id} has no service_code; dropped`);
      return null;
    }

    const rawType = String(r.type ?? '').toLowerCase();
    const type: 'door' | 'pickup-point' =
      rawType === 'pickup-point' || rawType === 'pickup_point'
        ? 'pickup-point'
        : 'door';

    // `surcharges` is [] on door rates and null on pickup-point rates —
    // two spellings of "none", so both must be tolerated.
    const surcharges: any[] = Array.isArray(r.surcharges) ? r.surcharges : [];

    return {
      id: Number(r.id ?? 0),
      serviceName: String(r.service_name ?? r.service_level_name ?? 'Delivery'),
      serviceCode,
      totalPrice: Number(r.total_price ?? r.rate ?? 0),
      baseRate: Number(r.base_rate ?? r.total_price ?? 0),
      currency: String(r.currency ?? 'ZAR'),
      type,
      serviceLevelCode: String(r.service_level_code ?? ''),
      providerSlug: String(r.provider_slug ?? ''),
      serviceLevelPriority:
        r.service_level_priority == null
          ? undefined
          : Number(r.service_level_priority),
      minDeliveryDate: r.min_delivery_date ?? undefined,
      maxDeliveryDate: r.max_delivery_date ?? undefined,
      pickupPointLocationId:
        r.pickup_point_location_id == null
          ? undefined
          : Number(r.pickup_point_location_id),
      pickupPointDistanceKm:
        r.pickup_point_location_distance == null
          ? undefined
          : Number(r.pickup_point_location_distance),
      description: r.description ?? undefined,
      liabilityCoverPrice: Number(r.liability_cover?.price ?? 0),
      surchargeTotal: surcharges.reduce(
        (sum, s) => sum + Number(s?.price ?? 0),
        0,
      ),
    };
  }

  // ─────────────────────────── pickup points ───────────────────────────

  /**
   * Pickup points near a coordinate.
   *
   * Coordinates are mandatory — /locations without them returns nothing
   * useful. For a buyer who has typed an address but not shared GPS, quote
   * first: the pickup-point rates from getRates() already carry the locker,
   * its distance and its price, so this endpoint is only needed when the
   * buyer wants to browse a map before committing to a rate.
   */
  async getLocations(input: {
    lat: number;
    lng: number;
    /** Straight-line cut-off applied client-side; the API does not take one. */
    radiusKm?: number;
  }): Promise<BobGoLocation[]> {
    const raw = await this.call<{ locations?: unknown[] }>(
      'GET',
      `/locations?lat=${encodeURIComponent(input.lat)}&lng=${encodeURIComponent(input.lng)}`,
    );

    const out = (raw.locations ?? []).map((l) => {
      const o = l as Record<string, any>;
      const lat = Number(o.latitude ?? o.lat ?? 0);
      const lng = Number(o.longitude ?? o.lng ?? 0);
      return {
        id: Number(o.id ?? 0),
        name: String(o.name ?? ''),
        humanName: o.human_name ?? undefined,
        lat,
        lng,
        type: String(o.type ?? ''),
        address: String(o.address ?? o.street_address ?? ''),
        fullAddress: o.full_address ?? undefined,
        tradingHours: o.trading_hours ?? undefined,
        providerName: o.provider_name ?? undefined,
        active: o.active !== false,
        compartmentErrors: Array.isArray(o.compartment_errors)
          ? o.compartment_errors.map(String)
          : [],
        distanceKm: haversineKm(input.lat, input.lng, lat, lng),
      } satisfies BobGoLocation;
    });

    const withinRadius =
      input.radiusKm == null
        ? out
        : out.filter((l) => (l.distanceKm ?? Infinity) <= input.radiusKm!);

    return dedupeLocations(withinRadius).sort(
      (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    );
  }

  /**
   * Locations that can actually take this parcel.
   *
   * Keep this separate from getLocations() so the caller can still show a
   * greyed-out "full" locker on a map if it wants to, rather than silently
   * hiding a site the buyer knows is round the corner.
   */
  async getUsableLocations(input: {
    lat: number;
    lng: number;
    radiusKm?: number;
  }): Promise<BobGoLocation[]> {
    const all = await this.getLocations(input);
    return all.filter((l) => l.active && l.compartmentErrors.length === 0);
  }

  // ─────────────────────────────── booking ─────────────────────────────

  /**
   * Book a collection.
   *
   * One call — unlike TCG there is no order-then-shipment two-step.
   *
   * READ THE `submission` FIELD ON THE RESULT. See the class docblock.
   */
  async createShipment(input: {
    collection: BobGoAddress;
    delivery: BobGoAddress;
    collectionContact: BobGoContact;
    deliveryContact: BobGoContact;
    parcels: BobGoParcel[];
    /** The `serviceCode` from the quote the buyer chose. Replayable. */
    serviceCode: string;
    /**
     * Both of these must be copied from the CHOSEN rate — never hard-coded.
     * A single sandbox quote returned providerSlug "sandbox" on the door rate
     * and "demo" on the pickup-point rate, so the underlying courier differs
     * per option within one response. Persist them next to serviceCode at
     * checkout so the booking replays the exact rate the buyer paid for.
     */
    providerSlug: string;
    serviceLevelCode: string;
    /** ZAR CENTS — see getRates. Converted to whole rand on the wire. */
    declaredValueCents: number;
    /** Our own reference — the order number. Shown on the waybill. */
    customerReference?: string;
    instructionsCollection?: string;
    instructionsDelivery?: string;
  }): Promise<BobGoShipmentResult> {
    const body = {
      collection_address: this.addressPayload(input.collection),
      delivery_address: this.addressPayload(input.delivery),

      // Contacts are flat scalars here, NOT the nested {name, mobile_number}
      // objects /rates-at-checkout accepts. Discovered by probing; sending the
      // nested form yields "collection contact name is required".
      collection_contact_name: input.collectionContact.name,
      collection_contact_mobile_number: input.collectionContact.mobile,
      collection_contact_email: input.collectionContact.email ?? '',
      delivery_contact_name: input.deliveryContact.name,
      delivery_contact_mobile_number: input.deliveryContact.mobile,
      delivery_contact_email: input.deliveryContact.email ?? '',

      parcels: input.parcels.map((p) => this.parcelPayload(p)),
      service_code: input.serviceCode,
      provider_slug: input.providerSlug,
      service_level_code: input.serviceLevelCode,
      declared_value: toWholeRand(input.declaredValueCents),
      ...(input.customerReference
        ? { customer_reference: input.customerReference }
        : {}),
      ...(input.instructionsCollection
        ? { instructions_collection: input.instructionsCollection }
        : {}),
      ...(input.instructionsDelivery
        ? { instructions_delivery: input.instructionsDelivery }
        : {}),
    };

    const raw = await this.call<Record<string, any>>('POST', '/shipments', body);
    const s = raw.shipment ?? raw;
    const result = this.normaliseShipment(s);

    if (result.submission !== 'SUBMITTED') {
      this.logger.warn(
        `Bob Go shipment ${result.shipmentId} created but NOT submitted ` +
          `(status="${result.rawSubmissionStatus}"` +
          `${result.failedReason ? `, reason="${result.failedReason}"` : ''}). ` +
          `Do not treat as booked.`,
      );
    }
    return result;
  }

  /**
   * Re-read a shipment. Use to resolve a PENDING submission, either on a
   * timer or when the shipment.update webhook fires.
   */
  async getShipment(shipmentId: number): Promise<BobGoShipmentResult> {
    // Only the unfiltered GET /shipments was exercised against the sandbox.
    // `?id=` is the obvious filter and is worth trying first — scanning the
    // whole account's shipment list on every poll does not scale — but we
    // must not depend on a parameter we have never seen accepted, so an
    // unrecognised-filter error falls back to the call we know works.
    let raw: Record<string, any>;
    try {
      raw = await this.call<Record<string, any>>(
        'GET',
        `/shipments?id=${encodeURIComponent(shipmentId)}`,
      );
    } catch (err) {
      this.logger.debug(
        `Bob Go /shipments?id= rejected (${err instanceof Error ? err.message : err}); ` +
          `falling back to full list`,
      );
      raw = await this.call<Record<string, any>>('GET', '/shipments');
    }
    const list = Array.isArray(raw.shipments) ? raw.shipments : [];
    // Match strictly on the id. There is deliberately NO "…else take the first
    // one" fallback: this method exists to resolve whether ONE shipment was
    // accepted, and handing back a different shipment's submission status would
    // mark an order booked on the strength of somebody else's parcel. Not
    // finding it is a real answer; guessing is not.
    const s = list.find((x: any) => Number(x?.id) === shipmentId);
    if (!s) throw new Error(`Bob Go shipment ${shipmentId} not found`);
    return this.normaliseShipment(s);
  }

  /**
   * Every shipment on the account, normalised.
   *
   * Exists because resolving N pending bookings must cost ONE request, not N.
   * The `?id=` filter has never been observed to work, so `getShipment` may
   * fall back to pulling the whole list — doing that per row would re-download
   * the account once per pending order per tick, which at any real volume is a
   * rate-limit incident. Callers with more than one row to resolve should call
   * this once and match locally.
   */
  async listShipments(): Promise<BobGoShipmentResult[]> {
    const raw = await this.call<Record<string, any>>('GET', '/shipments');
    const list = Array.isArray(raw.shipments) ? raw.shipments : [];
    return list.map((s: any) => this.normaliseShipment(s));
  }

  private normaliseShipment(s: Record<string, any>): BobGoShipmentResult {
    const rawStatus = String(s.submission_status ?? '');
    return {
      shipmentId: Number(s.id ?? 0),
      trackingReference: String(s.tracking_reference ?? ''),
      submission: classifySubmission(rawStatus, s.failed_reason),
      rawSubmissionStatus: rawStatus,
      failedReason: s.failed_reason || undefined,
      // Speculative field names — no successful sandbox booking has yet shown
      // where a locker PIN lives, or whether one exists at all. Reading a few
      // plausible keys costs nothing and means the day a real booking succeeds
      // we see the value rather than a silent undefined.
      pin:
        s.collection_pin ??
        s.pickup_point_pin ??
        s.pin ??
        s.reservation_details?.pin ??
        undefined,
      reservationDetails: s.reservation_details ?? undefined,
      providerSlug: s.provider_slug ?? undefined,
      serviceLevelCode: s.service_level_code ?? undefined,
    };
  }

  // ────────────────────────────── tracking ─────────────────────────────

  async getTracking(trackingReference: string): Promise<BobGoTracking | null> {
    const raw = await this.call<unknown>(
      'GET',
      `/tracking?tracking_reference=${encodeURIComponent(trackingReference)}`,
    );
    const rec = (Array.isArray(raw) ? raw[0] : raw) as
      | Record<string, any>
      | undefined;
    if (!rec) return null;

    const events = rec.shipment_movement_events ?? {};
    // The keys carry a `_time` suffix and unset ones are EMPTY STRINGS, not
    // null — verified against an accepted shipment. Reading `events.collected`
    // (no suffix) silently yields undefined for every parcel, and passing ""
    // through would make `if (collectedTime)` read as "not collected" while
    // still being a string. Both are the kind of bug that looks like the
    // courier never scanned anything.
    const t = (v: unknown): string | undefined => {
      const s = typeof v === 'string' ? v.trim() : '';
      return s === '' ? undefined : s;
    };
    return {
      trackingReference: String(rec.tracking_reference ?? trackingReference),
      status: String(rec.status ?? ''),
      statusFriendly: String(rec.status_friendly ?? rec.status ?? ''),
      courierName: rec.courier_name ?? rec.provider_name ?? undefined,
      readyForPickup: Boolean(rec.has_ready_for_pickup_status),
      collectedTime: t(events.collected_time),
      inTransitTime: t(events.in_transit_time),
      outForDeliveryTime: t(events.out_for_delivery_time),
      readyForPickupTime: t(events.ready_for_pickup_time),
      deliveredTime: t(events.delivered_time),
      checkpoints: Array.isArray(rec.checkpoints)
        ? rec.checkpoints.map((c: any) => ({
            time: c?.time ?? c?.date ?? undefined,
            status: c?.status ?? undefined,
            message: c?.message ?? c?.description ?? undefined,
          }))
        : [],
    };
  }
}

/**
 * Map Bob Go's `submission_status` onto something we can act on.
 *
 * FAIL-CLOSED BY DESIGN. Only a string we positively recognise as success
 * yields 'SUBMITTED'; anything unrecognised yields 'PENDING', which tells
 * callers to wait and tell nobody. The full vocabulary is unknown — only
 * "no-rates" has been seen in the wild — so an allowlist is the only safe
 * shape here. Getting this backwards would mean SMSing a buyer a tracking
 * number for a parcel no courier ever agreed to fetch.
 *
 * Exported for testing.
 */
export function classifySubmission(
  rawStatus: string,
  failedReason?: string | null,
): BobGoSubmissionState {
  const s = rawStatus.trim().toLowerCase().replace(/[\s_]+/g, '-');

  // A failure reason is decisive regardless of what the status says — the
  // sandbox pairs `failed_reason` with `app_status: "completed"`.
  if (failedReason) return 'FAILED';

  // "complete"/"completed" is deliberately ABSENT from this list. The sandbox
  // shipment carried `app_status: "completed"` while the courier had refused
  // it, so on this API "completed" means "we finished processing your request",
  // not "the courier took it". If submission_status ever uses the same word we
  // want PENDING and a human, not a false green light.
  if (['submitted', 'success', 'successful', 'accepted'].includes(s)) {
    return 'SUBMITTED';
  }
  if (
    s === 'no-rates' ||
    s.includes('fail') ||
    s.includes('error') ||
    s.includes('reject') ||
    s.includes('cancel')
  ) {
    return 'FAILED';
  }
  return 'PENDING';
}

/**
 * Collapse repeated entries for the same physical location.
 *
 * OBSERVED, not defensive: /locations returned locker #545 ("44 on Stanley")
 * twice in a single response. Left alone that shows the buyer the same locker
 * twice in a picker. Where duplicates disagree about availability we keep the
 * USABLE one — a duplicate that reports no free compartment alongside one that
 * reports space most likely describes a different compartment size at the same
 * site, and hiding a locker that can take the parcel is the worse error.
 *
 * Exported for testing.
 */
export function dedupeLocations(locations: BobGoLocation[]): BobGoLocation[] {
  const usable = (l: BobGoLocation) =>
    l.active && l.compartmentErrors.length === 0;

  const byId = new Map<number, BobGoLocation>();
  // An id we cannot trust is not a dedupe key. Without this, every location
  // with a missing or non-numeric id normalises to NaN, and Map treats all
  // NaNs as the same key — quietly merging unrelated lockers into one.
  const unkeyed: BobGoLocation[] = [];

  for (const l of locations) {
    if (!Number.isFinite(l.id) || l.id === 0) {
      unkeyed.push(l);
      continue;
    }
    const seen = byId.get(l.id);
    if (!seen || (usable(l) && !usable(seen))) byId.set(l.id, l);
  }
  return [...byId.values(), ...unkeyed];
}

/**
 * ZAR cents -> whole rand for Bob Go's `declared_value`.
 *
 * Identical to what TcgService puts on its wire (tcg.service.ts:135), so the
 * two carriers declare the same value for the same parcel and their quotes stay
 * comparable. Clamped at zero — a negative declared value would be nonsense to
 * price liability cover against.
 *
 * Exported for testing.
 */
export function toWholeRand(cents: number): number {
  return Math.max(0, Math.round(cents / 100));
}

/** Great-circle distance in km. Same formula PudoService uses for locker ranking. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
