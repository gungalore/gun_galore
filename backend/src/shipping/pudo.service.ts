import { Injectable, Logger } from '@nestjs/common';
import { SearchService, INDEXES } from '../search/search.service';
import { PostalCodesService } from './postal-codes.service';
import { CarrierContact, CarrierShipmentResult } from './carrier.types';

export interface PudoLocker {
  lockerId: string;
  name: string;
  address: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number;
  lng: number;
  distanceKm?: number;
}

// Locker codes Pudo's feed claims are online but which buyers have
// confirmed don't physically exist at the listed address. Hand-curated;
// extend as we find more phantoms. Trust me — Pudo's API will happily
// quote rates for these (their rates engine doesn't know about the
// problem), but a real shipment would get stuck.
const PHANTOM_LOCKER_CODES = new Set<string>([
  // Okavango Crossing — claimed at -33.83925 / 18.69644 but the
  // underground parking address has no Pudo unit. Confirmed by buyer
  // on 2026-05-20.
  'RVM00111',
  // Motus Toyota Cape Gate — listed at the car dealership but no
  // physical Pudo locker on site. Confirmed by buyer on 2026-05-20.
  'RVM00658',
]);

export interface ParcelDims {
  /** centimetres */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** grams */
  weightGrams: number;
}

export interface ResidentialAddress {
  streetAddress: string;
  suburb: string;
  city: string;
  postalCode: string;
  province: string; // 'WC' / 'GP' etc (Pudo's "zone")
  lat: number;
  lng: number;
}

export interface ShippingQuote {
  /** Pudo service_level code, e.g. "L2LXS - ECO". Echoed into the
   *  shipment-create call later — saves us re-quoting. */
  serviceCode: string;
  /** Human-friendly name e.g. "Locker to Locker Extra Small" */
  serviceName: string;
  /** ZAR cents — VAT-INCLUSIVE (matches what Peach charges). */
  priceCents: number;
  /** The box size Pudo will reserve at the source locker (L2L only). */
  boxName?: string;
  /**
   * Bob Go only. Booking needs the provider and service tier REPLAYED from the
   * quote alongside serviceCode, and both vary per rate within a single quote
   * response — one sandbox reply carried provider "sandbox" on its door rate
   * and "demo" on its pickup-point rate. Pudo and TCG each had exactly one
   * provider, so serviceCode alone was enough for them; it is not enough here.
   * Optional so the legacy carriers are untouched.
   */
  providerSlug?: string;
  serviceLevelCode?: string;
  /** Bob Go pickup-point rates — the locker this rate delivers to. */
  pickupPointLocationId?: number;
}

@Injectable()
export class PudoService {
  private readonly logger = new Logger(PudoService.name);
  private cache: PudoLocker[] | null = null;
  private cacheAt = 0;
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly search: SearchService,
    private readonly postalCodes: PostalCodesService,
  ) {}

  // Tiered locker matching. Three signals, in priority order:
  //
  //   Tier 1 — EXACT postal code match
  //     Lockers whose postal_code === user's postal code. Sorted
  //     within tier by distance from lat/lng if we have it; else
  //     stable cache order. This is the strongest "in my area"
  //     signal — a user with postal code 7570 wants to see their
  //     Durbanville lockers first.
  //
  //   Tier 2 — NEIGHBOURING postal codes (Delaunay-adjacent)
  //     Pre-computed at build time by scripts/build-postal-neighbours.mjs
  //     (see PostalCodesService). The neighbour list is the natural
  //     geographic adjacency derived from a Voronoi tessellation of
  //     SA postal-code centroids; same accuracy as polygon overlap
  //     without needing to ship 50 MB of GeoJSON. Sorted within tier
  //     by distance from lat/lng if we have it.
  //
  //   Tier 3 — DISTANCE fallback
  //     If we still don't have `limit` results AND lat/lng is given,
  //     fill from the nearest remaining lockers within `radiusKm`.
  //     This covers users whose postal code isn't in the neighbour
  //     map (rural / not in GeoNames) and users at the edge of
  //     their postal code who'd happily walk to the next district.
  //
  // All callers should pass postalCode when they have it. lat/lng is
  // optional but used for in-tier ordering. The old contract — call
  // with lat/lng only — still works and falls through to the legacy
  // distance-only behaviour.
  async getNearbyLockers(
    params: {
      lat?: number;
      lng?: number;
      postalCode?: string;
      radiusKm?: number;
      limit?: number;
    } = {},
  ): Promise<PudoLocker[]> {
    const { lat, lng, postalCode, radiusKm = 30, limit = 20 } = params;
    const all = await this.getAll();

    // No signals at all → first N from the cache (legacy degraded path).
    if (!lat && !lng && !postalCode) return all.slice(0, limit);

    // Helper: rank within a tier — by distance when we have coords,
    // else by name for stable ordering.
    const sortByDistance = (list: PudoLocker[]): PudoLocker[] => {
      if (!lat || !lng) return list;
      return [...list].sort((a, b) => {
        const da = this.haversine(lat, lng, a.lat, a.lng);
        const db = this.haversine(lat, lng, b.lat, b.lng);
        return da - db;
      });
    };

    // Annotate every locker with distance when we have lat/lng so the
    // frontend can show "12 km from you" without re-computing.
    const annotate = (l: PudoLocker): PudoLocker => {
      if (lat == null || lng == null) return l;
      return { ...l, distanceKm: this.haversine(lat, lng, l.lat, l.lng) };
    };

    const seen = new Set<string>();
    const out: PudoLocker[] = [];
    const take = (rows: PudoLocker[]) => {
      for (const l of rows) {
        if (out.length >= limit) return;
        if (seen.has(l.lockerId)) continue;
        seen.add(l.lockerId);
        out.push(annotate(l));
      }
    };

    if (postalCode && postalCode.trim().length > 0) {
      const trimmed = postalCode.trim();
      const neighbourSet = this.postalCodes.getNeighbours(trimmed);

      // Tier 1: exact match
      const exact = all.filter((l) => l.postalCode === trimmed);
      take(sortByDistance(exact));

      // Tier 2: Delaunay neighbours
      if (out.length < limit && neighbourSet.length > 0) {
        const neighbourCodes = new Set(neighbourSet);
        const nbrs = all.filter((l) => neighbourCodes.has(l.postalCode));
        take(sortByDistance(nbrs));
      }
    }

    // Tier 3: distance fallback — fills any remaining slots from the
    // closest still-unseen lockers within radiusKm. Skipped when we
    // don't have coords (no way to rank).
    if (out.length < limit && lat != null && lng != null) {
      const distanceRanked = all
        .filter((l) => !seen.has(l.lockerId))
        .map((l) => ({ l, d: this.haversine(lat, lng, l.lat, l.lng) }))
        .filter((x) => x.d <= radiusKm)
        .sort((a, b) => a.d - b.d)
        .map((x) => x.l);
      take(distanceRanked);
    }

    return out;
  }

  // Free-text locker search. Goes through Meilisearch when connected
  // (typo-tolerant, ranks by relevance). Falls back to a substring scan
  // over the in-memory cache if Meilisearch isn't running — keeps the
  // override picker usable in dev without the search container up.
  async searchLockers(query: string, limit = 10): Promise<PudoLocker[]> {
    const q = query.trim();
    if (!q) return [];

    if (this.search.isConnected) {
      const res = await this.search.search<PudoLocker>(
        INDEXES.PUDO_LOCKERS,
        q,
        { limit },
      );
      return res.hits as PudoLocker[];
    }

    const lower = q.toLowerCase();
    const all = await this.getAll();
    return all
      .filter((l) => {
        return (
          l.name.toLowerCase().includes(lower) ||
          l.suburb.toLowerCase().includes(lower) ||
          l.city.toLowerCase().includes(lower) ||
          l.postalCode.includes(lower) ||
          l.lockerId.toLowerCase().includes(lower)
        );
      })
      .slice(0, limit);
  }

  // ──────────────────── Tracking lookups (live) ───────────────────
  //
  // Pudo's GET /api/v1/tracking/shipments endpoint accepts several
  // identifiers — we use `waybill` (the tracking reference we stamp on
  // Transaction.trackingReference at shipment-create time). The response
  // payload contains a `tracking_events[]` array which the polling
  // cron diffs against our TrackingEvent log.
  //
  // Returns the raw `tracking_events` array (oldest → newest) on
  // success, or null when:
  //   - PUDO_API_KEY isn't configured (local dev),
  //   - the lookup 404'd (waybill unknown to Pudo yet — the shipment
  //     was created but hasn't propagated to tracking),
  //   - the HTTP call failed (network / 5xx).
  //
  // Each element of the returned array is forwarded verbatim to the
  // caller; the cron is responsible for picking out `status`,
  // `event_time`, and `description` fields.
  async fetchTrackingEvents(
    waybill: string,
  ): Promise<RawTrackingEvent[] | null> {
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';
    const bearer = this.buildBearer();
    if (!bearer) return null;
    try {
      const url = `${baseUrl}/api/v1/tracking/shipments?waybill=${encodeURIComponent(waybill)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: 'application/json',
        },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `Pudo tracking ${res.status} for ${waybill}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      const data = (await res.json()) as {
        shipments?: { tracking_events?: RawTrackingEvent[] }[];
        tracking_events?: RawTrackingEvent[];
      };
      // Pudo wraps the events under a `shipments[]` array when the lookup
      // is by tracking_reference / parcel_id, but returns the events at
      // the top level when filtered by waybill. We handle both shapes.
      if (Array.isArray(data.tracking_events)) return data.tracking_events;
      if (Array.isArray(data.shipments) && data.shipments.length > 0) {
        return data.shipments[0].tracking_events ?? [];
      }
      return [];
    } catch (err) {
      this.logger.warn(
        `Pudo tracking fetch failed for ${waybill}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ──────────────────── Shipment booking (live, real money) ───────────
  //
  // Books a Locker-to-Locker shipment on Pudo/ShipLogic. This SPENDS the
  // merchant wallet — only call it once per transaction, after payment.
  //
  // collection_address.type='locker' with NO terminal_id is the documented
  // L2L pattern: the seller drops at ANY Pudo locker using the `pincode`
  // we get back, and Pudo routes from there to the buyer's locker
  // (`delivery_address.terminal_id`). `service_level_code` is echoed
  // straight from the quote (e.g. "L2LXS - ECO") so we never re-quote.
  //
  // Endpoint, request body, and response fields verified against the Pudo
  // Postman collection (POST /api/v1/shipments → { id, custom_tracking_
  // reference, pincode, status }). NB: same host + /api/v1 prefix as the
  // rates/tracking/lockers calls — the old stub's api.pudo.co.za/v2 was a
  // guess and was wrong.
  async createShipment(input: {
    /** Pudo service_level_code from the quote, e.g. "L2LXS - ECO". */
    serviceCode: string;
    /** Buyer's destination locker terminal id. */
    toLockerId: string;
    collectionContact: CarrierContact;
    deliveryContact: CarrierContact;
    specialInstructions?: string;
  }): Promise<CarrierShipmentResult> {
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';
    const bearer = this.buildBearer();
    if (!bearer) throw new Error('PUDO_API_KEY not configured');

    const body = {
      collection_address: { type: 'locker' },
      special_instructions_collection: input.specialInstructions ?? 'None',
      collection_contact: contactBody(input.collectionContact),
      delivery_address: { terminal_id: input.toLockerId },
      delivery_contact: contactBody(input.deliveryContact),
      service_level_code: input.serviceCode,
    };

    const res = await fetch(`${baseUrl}/api/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Pudo shipment create ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as {
      id?: number | string;
      custom_tracking_reference?: string;
      short_tracking_reference?: string;
      tracking_reference?: string;
      pincode?: string | number;
      status?: string;
    };
    const trackingReference =
      json.custom_tracking_reference ??
      json.short_tracking_reference ??
      json.tracking_reference ??
      '';
    if (!json.id || !trackingReference) {
      throw new Error(
        `Pudo shipment create: missing id/tracking in response: ${JSON.stringify(
          json,
        ).slice(0, 300)}`,
      );
    }
    return {
      carrier: 'PUDO',
      provider: 'PUDO',
      // Booked-or-throw: reaching this line IS the confirmation. Any
      // non-2xx or unparseable response threw above, so there is no
      // created-but-unaccepted state to report the way Bob Go has.
      submission: 'SUBMITTED',
      shipmentId: String(json.id),
      trackingReference,
      pin: json.pincode != null ? String(json.pincode) : undefined,
      status: json.status,
    };
  }

  // Cancel a booked Pudo shipment (PUT /api/v1/shipments/{id}). Best-effort
  // — used on the seller-reject path so a cancelled sale doesn't leave a
  // live waybill. Returns true on success. The exact cancel body is
  // finalised when this is wired into the reject flow (Phase 5).
  async cancelShipment(shipmentId: string): Promise<boolean> {
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';
    const bearer = this.buildBearer();
    if (!bearer) return false;
    try {
      const res = await fetch(
        `${baseUrl}/api/v1/shipments/${encodeURIComponent(shipmentId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ status: 'cancelled' }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Pudo cancel ${res.status} for ${shipmentId}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Pudo cancel failed for ${shipmentId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // Server-side ONLY — the waybill PDF URL carries the api_key as a query
  // param, so this must never be handed to a seller/buyer directly. The
  // label is proxied through our own auth-checked endpoint (Phase 3) which
  // fetches this URL server-side and streams the PDF back.
  waybillUrl(shipmentId: string): string {
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';
    const key = process.env.PUDO_API_KEY ?? '';
    return `${baseUrl}/generate/waybill/${encodeURIComponent(
      shipmentId,
    )}?api_key=${encodeURIComponent(key)}`;
  }

  // Fetch the waybill PDF server-side (the api_key stays on the server).
  // Streamed back to the seller via our own auth-checked proxy endpoint.
  async fetchWaybillPdf(shipmentId: string): Promise<Buffer> {
    const res = await fetch(this.waybillUrl(shipmentId), {
      headers: { Accept: 'application/pdf' },
    });
    if (!res.ok) {
      throw new Error(`Pudo waybill ${res.status} for ${shipmentId}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Invalidate cache manually (useful after admin override)
  invalidateCache(): void {
    this.cache = null;
    this.cacheAt = 0;
  }

  // ──────────────────── Rate quotes (live) ─────────────────────────
  //
  // Pudo's rates API at POST /api/v1/rates accepts four variants:
  //   • L2L  collection.type=locker  + delivery.terminal_id
  //   • L2D  collection.terminal_id  + delivery=residential
  //   • D2L  collection=residential  + delivery.terminal_id
  //   • D2D  collection=residential  + delivery=residential  + parcels[]
  //
  // L2L returns ALL five box sizes in one shot (XS / S / M / L / XL).
  // We pick the smallest box that fits the parcel's dims + weight, then
  // return its serviceCode + price. If nothing fits → null (the caller
  // is expected to fall back to TCG D2D).
  //
  // Both rate calls return VAT-INCLUSIVE prices in the `rate` string —
  // we parse to cents.

  /**
   * Quote a Locker-to-Locker shipment. Pudo doesn't bind L2L to a
   * specific source locker — the seller drops at any locker with the
   * delivery PIN we issue at dispatch time, and Pudo routes from
   * there to `toLockerId`. Rates are flat per box-size regardless of
   * source, so the body sends `collection_address: { type: 'locker' }`
   * with no terminal_id (mirrors the docs' L2L example exactly).
   *
   * Returns null if the parcel exceeds all five box sizes (Pudo's
   * largest is 60×41×69 cm, 20 kg) — caller should fall back to D2D.
   */
  async quoteL2L(
    toLockerId: string,
    parcel: ParcelDims,
  ): Promise<ShippingQuote | null> {
    const rates = await this.fetchRates({
      collection_address: { type: 'locker' },
      delivery_address: { terminal_id: toLockerId },
    });
    if (!rates || rates.length === 0) return null;

    // Pick the rate whose box physically holds the parcel. Sort by
    // price ascending so we serve the cheapest fit.
    //
    // NOTE on can_book — Pudo flags can_book=false on EVERY rate when
    // the request omits a source terminal_id (which we do, because the
    // seller drops at any locker with their delivery PIN). That flag
    // would only be meaningful if we pre-committed to a specific source
    // locker. The actual bookability check happens at shipment-create
    // time, so we ignore can_book here.
    const candidates: { rate: RawRate; priceCents: number }[] = [];
    for (const r of rates) {
      const dims = r.service_level?.dimensions;
      if (!dims) continue;
      if (!fitsBox(parcel, dims)) continue;
      candidates.push({ rate: r, priceCents: parseRandToCents(r.rate) });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.priceCents - b.priceCents);
    const winner = candidates[0];
    return {
      serviceCode: winner.rate.service_level.code,
      serviceName: winner.rate.service_level.name,
      priceCents: winner.priceCents,
      boxName: winner.rate.service_level.box_type_name,
    };
  }

  /**
   * Quote a Door-to-Door shipment (TCG residential courier). Rates are
   * distance + weight based, so we must pass parcel dims as `parcels[]`.
   * Returns null if Pudo refuses to quote.
   */
  async quoteD2D(
    from: ResidentialAddress,
    to: ResidentialAddress,
    parcel: ParcelDims,
  ): Promise<ShippingQuote | null> {
    const rates = await this.fetchRates({
      collection_address: residentialBody(from),
      delivery_address: residentialBody(to),
      parcels: [
        {
          submitted_length_cm: String(parcel.lengthCm),
          submitted_width_cm: String(parcel.widthCm),
          submitted_height_cm: String(parcel.heightCm),
          submitted_weight_kg: String(parcel.weightGrams / 1000),
          parcel_description: 'All Outdoor marketplace parcel',
          alternative_tracking_reference: '',
        },
      ],
      opt_in_rates: [],
      opt_in_time_based_rates: [],
    });
    if (!rates || rates.length === 0) return null;

    // NOTE on can_book — Pudo returns can_book.status=false with
    // various reasons that don't apply at quote time (e.g.
    // "zero_balance" when the merchant account is unfunded, or no
    // source confirmation). The price is still valid. We ignore the
    // flag here and let the actual /shipments call surface the real
    // bookability error if it can't go through.
    const candidates = rates
      .map((r) => ({ rate: r, priceCents: parseRandToCents(r.rate) }))
      .sort((a, b) => a.priceCents - b.priceCents);
    if (candidates.length === 0) return null;
    const winner = candidates[0];
    return {
      serviceCode: winner.rate.service_level.code,
      serviceName: winner.rate.service_level.name,
      priceCents: winner.priceCents,
    };
  }

  private async fetchRates(
    body: Record<string, unknown>,
  ): Promise<RawRate[] | null> {
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';
    const bearer = this.buildBearer();
    if (!bearer) return null;
    try {
      const res = await fetch(`${baseUrl}/api/v1/rates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `Pudo rates API ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      const data = (await res.json()) as { rates?: RawRate[] };
      return Array.isArray(data.rates) ? data.rates : null;
    } catch (err) {
      this.logger.warn(`Pudo rates fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  private buildBearer(): string | null {
    const apiKey = process.env.PUDO_API_KEY;
    if (!apiKey) return null;
    const apiSecret = process.env.PUDO_API_SECRET ?? '';
    return apiKey.includes('|')
      ? apiKey
      : apiSecret
        ? `${apiKey}|${apiSecret}`
        : apiKey;
  }

  private async getAll(): Promise<PudoLocker[]> {
    if (this.cache && Date.now() - this.cacheAt < this.TTL_MS) return this.cache;

    if (!process.env.PUDO_API_KEY) {
      this.logger.warn('PUDO_API_KEY not set — locker list unavailable');
      return [];
    }

    // Pudo bearer token format is `<id>|<secret>`. The env can be either
    // the combined form (preferred) or the id alone with PUDO_API_SECRET
    // set separately. Endpoint + URL ported from the old project where
    // this was already working in production.
    const apiKey = process.env.PUDO_API_KEY;
    const apiSecret = process.env.PUDO_API_SECRET ?? '';
    const bearer = apiKey.includes('|')
      ? apiKey
      : apiSecret
        ? `${apiKey}|${apiSecret}`
        : apiKey;
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';

    try {
      const res = await fetch(`${baseUrl}/api/v1/lockers-data`, {
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `Pudo API ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        );
      }

      const raw = (await res.json()) as unknown;
      const list: unknown[] = Array.isArray(raw)
        ? raw
        : ((raw as { lockers?: unknown[] }).lockers ?? []);

      // Pudo's lockers-data feed mixes three categories of service points
      // AND two partner networks. We filter on three axes:
      //
      //   1. type.name === 'Locker'   — drop manned Pickup Points + Kiosks
      //   2. status === 'online'       — drop decommissioned / broken units
      //   3. NOT in PHANTOM_LOCKER_CODES — explicit blocklist of locker
      //      codes Pudo's data claims are online but don't physically
      //      exist (Pudo's ROVENMA network has ghost entries — see the
      //      list below). Hand-maintained; add codes as buyers report
      //      dead points.
      //
      // Earlier we filtered out ROVENMA entirely (provider !== 'TCG')
      // but that also dropped real ROVENMA lockers like Langeberg Ridge
      // Shopping Centre that buyers DO want. The blocklist is more
      // surgical: trust the feed, except for the specific codes we've
      // verified are phantoms.
      //
      // After filtering the feed shrinks from ~2,700 rows to ~1,800
      // real online lockers. The detailed-address mapping below also
      // resolves the old "address vs lat/lng mismatch" because the
      // dropped counters/kiosks were what reported partner-shop
      // addresses that didn't match their actual coords.
      this.cache = list
        .map((l: any) => {
          const detailed = (l.detailed_address ?? {}) as Record<string, string>;
          return {
            // Detailed-address fields are reliable (Pudo standardises them).
            // The flat `address` is a comma-joined string sometimes — use
            // detailed_address when available, fall back to the flat string.
            lockerId:
              l.code ?? l.locker_code ?? l.terminal_id ?? l.id ?? l.lockerId ?? '',
            name: l.name ?? l.locker_name ?? l.description ?? '',
            typeName: l.type?.name ?? l.type?.code ?? '',
            // Pudo's `status` is "online" / "offline" — anything other
            // than online is excluded. We tolerate missing/empty for
            // forward-compat with feed schema changes.
            status: (l.status ?? '').toString().toLowerCase(),
            // TCG = original Pudo network (codes start with CG). ROVENMA
            // is a partner network whose listings include phantom points.
            provider: (l.provider ?? '').toString().toUpperCase(),
            address:
              detailed.formatted_address ??
              l.address ??
              l.street_address ??
              l.full_address ??
              l.streetAddress ??
              '',
            suburb: detailed.sublocality ?? l.suburb ?? '',
            city: detailed.locality ?? l.city ?? l.town ?? '',
            province: detailed.province ?? l.province ?? l.region ?? '',
            postalCode:
              detailed.postal_code ?? l.postal_code ?? l.postalCode ?? l.zip ?? '',
            lat: parseFloat(l.latitude ?? l.lat ?? 0),
            lng: parseFloat(l.longitude ?? l.lng ?? l.lon ?? 0),
          };
        })
        .filter((l) => {
          // Real lockers only…
          if (l.typeName !== 'Locker') return false;
          // …and accepting parcels right now. SANDBOX QUIRK: the test
          // environment marks every locker as `offline` so we relax
          // the status check when the base URL points at sandbox.
          // Production behaviour is unchanged (online-only).
          const isSandbox = baseUrl.includes('sandbox');
          if (!isSandbox && l.status !== 'online') return false;
          // …not on the hand-curated phantom blocklist. See the const
          // at the top of the file for context.
          if (PHANTOM_LOCKER_CODES.has(l.lockerId)) return false;
          // Sanity: coords + identifiers must be present.
          if (!l.lockerId || !l.name) return false;
          if (Number.isNaN(l.lat) || Number.isNaN(l.lng)) return false;
          if (l.lat === 0 || l.lng === 0) return false;
          return true;
        })
        // Drop helper fields before caching — keeps the row shape
        // identical to PudoLocker for downstream consumers.
        .map(({ typeName: _t, status: _s, provider: _p, ...rest }) => rest);

      this.cacheAt = Date.now();
      this.logger.log(`Pudo locker cache refreshed: ${this.cache.length} lockers`);

      // Push to Meilisearch so the locker-search endpoint has fresh
      // data. Wipe first so non-Locker rows (Pickup Points, Kiosks)
      // that may have been indexed before the type filter was added
      // don't linger as ghost search hits. The full delete-then-add is
      // fast (~1s for 2k rows) and runs at most once per 24h.
      if (this.search.isConnected && this.cache.length > 0) {
        try {
          await this.search.deleteAllDocuments(INDEXES.PUDO_LOCKERS);
          await this.search.updateDocuments(
            INDEXES.PUDO_LOCKERS,
            this.cache,
          );
        } catch (err) {
          this.logger.warn(
            `Pudo locker re-index failed: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Failed to fetch Pudo lockers: ${(err as Error).message}`);
      if (this.cache) {
        this.logger.warn('Serving stale Pudo locker cache');
        return this.cache;
      }
    }

    return this.cache ?? [];
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

// ─────────────────────── Helpers + raw types ─────────────────────────

interface RawRateDimensions {
  length: number;
  width: number;
  height: number;
  weight: number; // kg
}

interface RawServiceLevel {
  code: string;
  name: string;
  box_type_name?: string;
  dimensions?: RawRateDimensions;
}

interface RawRate {
  rate: string; // "50.00" — VAT-inclusive ZAR
  rate_excluding_vat?: number;
  service_level: RawServiceLevel;
  can_book?: { status: boolean };
}

/**
 * One row of Pudo's `tracking_events[]` array. Field names match
 * Pudo's API docs verbatim. Only `status` + `event_time` are
 * guaranteed — everything else may be null/missing depending on the
 * event type.
 */
export interface RawTrackingEvent {
  status: string;
  event_time?: string; // ISO 8601
  description?: string;
  terminal_id?: string;
  terminal_name?: string;
  location?: string;
}

/**
 * Box-fit check. We sort BOTH the parcel dims and the box dims
 * descending and compare axis-by-axis — that way the caller doesn't
 * have to worry about which way the parcel goes in. Weight checked
 * separately against the box's max-weight rating.
 */
function fitsBox(parcel: ParcelDims, box: RawRateDimensions): boolean {
  const p = [parcel.lengthCm, parcel.widthCm, parcel.heightCm].sort(
    (a, b) => b - a,
  );
  const b = [box.length, box.width, box.height].sort((a, b) => b - a);
  if (p[0] > b[0] || p[1] > b[1] || p[2] > b[2]) return false;
  if (parcel.weightGrams / 1000 > box.weight) return false;
  return true;
}

/** Pudo returns rates as strings like "50.00" (incl VAT). To cents. */
function parseRandToCents(raw: string | number | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Pudo's residential address body shape. Same on collection and
 * delivery legs of D2D/D2L/L2D rate requests. `zone` is the SA
 * province code (WC / GP / etc). `entered_address` is freeform —
 * Pudo only really uses lat/lng for distance maths.
 */
/**
 * ShipLogic collection/delivery contact body. `mobile_number` is what the
 * carrier SMSes the locker PIN / collection notice to.
 */
function contactBody(c: CarrierContact): Record<string, unknown> {
  return {
    name: c.name,
    email: c.email ?? '',
    mobile_number: c.mobile,
  };
}

function residentialBody(addr: ResidentialAddress): Record<string, unknown> {
  return {
    type: 'residential',
    street_address: addr.streetAddress,
    suburb: addr.suburb,
    local_area: addr.suburb,
    city: addr.city,
    code: addr.postalCode,
    zone: addr.province,
    country: 'South Africa',
    lat: addr.lat,
    lng: addr.lng,
    entered_address: `${addr.streetAddress}, ${addr.suburb}, ${addr.city}, ${addr.postalCode}, South Africa`,
  };
}
