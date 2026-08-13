import { Injectable, Logger } from '@nestjs/common';
import { CarrierContact, CarrierShipmentResult } from './carrier.types';

// TCG (The Courier Guy) door-to-door quote + shipment integration.
// IMPORTANT: TCG and Pudo are SEPARATE businesses with SEPARATE wallets
// and SEPARATE rate cards, even though TCG owns Pudo. Pudo's API
// returns wholesale-merchant rates (~R200 minimum for a small parcel
// cross-province); TCG's own retail-customer API returns much
// cheaper rates (R123 for the same shipment) because they sell
// flat-rate "Economy" tiers Pudo doesn't expose.
//
// Use:
//   - PudoService.quoteL2L → locker-to-locker (Pudo network)
//   - TcgService.getQuote  → door-to-door (TCG retail rates)
//
// TCG API docs (Postman collection): runs on Shiplogic-style endpoints
// at api.portal.thecourierguy.co.za. Auth is Bearer <TCG_API_KEY>.

export interface TcgResidentialAddress {
  /** Street + number; required. */
  streetAddress: string;
  /** Suburb / sub-locality — sent as `local_area`. */
  suburb: string;
  /** City / town. */
  city: string;
  /** SA province as a long-form name (e.g. "Western Cape", "Gauteng").
   *  Shiplogic accepts both the long name and the 2-letter abbreviation;
   *  the long name is what TCG's own examples use. */
  province: string;
  /** 4-digit SA postal code. */
  postalCode: string;
  /** Coordinates — Shiplogic uses these for distance + suburb
   *  validation; omit and the API may still quote but routing
   *  accuracy drops. */
  lat?: number;
  lng?: number;
  /** "residential" or "business". Defaults to residential. */
  type?: 'residential' | 'business';
  /** Company name when type==='business'. */
  company?: string;
}

export interface TcgParcel {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description?: string;
}

export interface TcgQuote {
  /** Service-level code, e.g. "ECO" / "OVN". Echo back into create-shipment
   *  to lock the chosen tier without re-quoting. */
  serviceCode: string;
  /** Human-friendly name, e.g. "Economy (4000)" / "Overnight". */
  serviceName: string;
  /** ZAR cents, VAT-INCLUSIVE (matches what Peach charges the buyer). */
  priceCents: number;
  /** Promised transit days, 1–14. Approximate — TCG returns delivery
   *  date ranges; we round to the upper bound. */
  estimatedDays: number;
}

// Subset of the Shiplogic /rates response we actually read. Full
// schema in the TCG Postman collection.
interface RawRate {
  rate: number; // VAT-inclusive
  rate_excluding_vat?: number;
  service_level: {
    code: string;
    name: string;
    description?: string;
    delivery_date_from?: string;
    delivery_date_to?: string;
  };
}

@Injectable()
export class TcgService {
  private readonly logger = new Logger(TcgService.name);

  /** Base URL — TCG's branded portal endpoint. Override via env in
   *  case the operator points us at a Shiplogic-direct or sandbox
   *  base later. */
  private get baseUrl(): string {
    return (
      process.env.TCG_BASE_URL ??
      'https://api.portal.thecourierguy.co.za'
    );
  }

  private get apiKey(): string {
    return process.env.TCG_API_KEY ?? '';
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // Rate quote — POST /rates. Returns the CHEAPEST available service
  // for the requested parcel + addresses (typically ECO). Returns
  // null if TCG can't quote the route (e.g. invalid postal code,
  // parcel below minimum weight, or service simply unavailable).
  //
  // Why we only return the cheapest: per operator decision, Gun
  // Galore always ships the cheapest D2D option with default
  // liability cover — no premium speed tiers. The full rate list is
  // logged at debug for audit but never surfaced to the buyer.
  // ──────────────────────────────────────────────────────────────────
  async getQuote(
    from: TcgResidentialAddress,
    to: TcgResidentialAddress,
    parcel: TcgParcel,
    declaredValueCents: number,
  ): Promise<TcgQuote | null> {
    if (!this.isConfigured) {
      this.logger.warn('TCG_API_KEY not set — door-to-door quote unavailable');
      return null;
    }

    const body = {
      collection_address: mapAddress(from),
      delivery_address: mapAddress(to),
      parcels: [
        {
          submitted_length_cm: parcel.lengthCm,
          submitted_width_cm: parcel.widthCm,
          submitted_height_cm: parcel.heightCm,
          submitted_weight_kg: parcel.weightKg,
          parcel_description:
            parcel.description ?? 'All Outdoor marketplace parcel',
        },
      ],
      declared_value: Math.max(0, Math.round(declaredValueCents / 100)),
    };

    let raw: { rates?: RawRate[]; message?: string } | null = null;
    try {
      const res = await fetch(`${this.baseUrl}/rates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `TCG rates API ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      raw = (await res.json()) as { rates?: RawRate[]; message?: string };
    } catch (err) {
      this.logger.warn(
        `TCG rates fetch failed: ${(err as Error).message}`,
      );
      return null;
    }

    if (!raw || !Array.isArray(raw.rates) || raw.rates.length === 0) {
      this.logger.warn(
        `TCG rates returned no usable rates (message: ${raw?.message ?? 'none'})`,
      );
      return null;
    }

    // Sort ascending by VAT-inclusive rate, return the cheapest.
    // Single-line debug log lets us audit which tier was picked + what
    // alternatives existed if the operator ever queries a specific
    // shipment.
    const sorted = [...raw.rates].sort((a, b) => a.rate - b.rate);
    this.logger.debug(
      `TCG rates (cheapest first): ${sorted
        .map((r) => `${r.service_level.code}=R${r.rate.toFixed(2)}`)
        .join(', ')}`,
    );
    const winner = sorted[0];

    return {
      serviceCode: winner.service_level.code,
      serviceName: winner.service_level.name,
      priceCents: Math.round(winner.rate * 100),
      estimatedDays: parseDays(winner.service_level.description) ?? 4,
    };
  }

  // ──────────────────── Shipment booking (live, real money) ───────────
  //
  // Books a door-to-door shipment on TCG/ShipLogic. SPENDS the merchant
  // wallet — call once per transaction, after payment. The courier
  // collects from the seller's pickup address (`from`) and delivers to the
  // buyer (`to`). `service_level_code` is echoed from the quote.
  //
  // Request/response verified against the ShipLogic "Create a shipment
  // D2D" example (POST /shipments → { id, *_tracking_reference, status }).
  // No locker PIN — door-to-door has none.
  async createShipment(input: {
    serviceCode: string;
    from: TcgResidentialAddress;
    to: TcgResidentialAddress;
    parcel: TcgParcel;
    declaredValueCents: number;
    collectionContact: CarrierContact;
    deliveryContact: CarrierContact;
    specialInstructions?: string;
  }): Promise<CarrierShipmentResult> {
    if (!this.isConfigured) throw new Error('TCG_API_KEY not configured');

    const nowIso = new Date().toISOString();
    const body = {
      collection_min_date: nowIso,
      collection_after: '08:00',
      collection_before: '17:00',
      collection_address: mapAddress(input.from),
      special_instructions_collection: input.specialInstructions ?? 'None',
      collection_contact: contactBody(input.collectionContact),
      delivery_min_date: nowIso,
      delivery_after: '08:00',
      delivery_before: '17:00',
      delivery_address: mapAddress(input.to),
      delivery_contact: contactBody(input.deliveryContact),
      parcels: [
        {
          submitted_length_cm: input.parcel.lengthCm,
          submitted_width_cm: input.parcel.widthCm,
          submitted_height_cm: input.parcel.heightCm,
          submitted_weight_kg: input.parcel.weightKg,
          parcel_description:
            input.parcel.description ?? 'All Outdoor marketplace parcel',
        },
      ],
      declared_value: Math.max(0, Math.round(input.declaredValueCents / 100)),
      service_level_code: input.serviceCode,
    };

    const res = await fetch(`${this.baseUrl}/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`TCG shipment create ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      id?: number | string;
      short_tracking_reference?: string;
      custom_tracking_reference?: string;
      tracking_reference?: string;
      status?: string;
    };
    const trackingReference =
      json.short_tracking_reference ??
      json.custom_tracking_reference ??
      json.tracking_reference ??
      '';
    if (!json.id || !trackingReference) {
      throw new Error(
        `TCG shipment create: missing id/tracking in response: ${JSON.stringify(
          json,
        ).slice(0, 300)}`,
      );
    }
    return {
      carrier: 'TCG',
      provider: 'TCG',
      // Booked-or-throw: reaching this line IS the confirmation. Any
      // non-2xx or unparseable response threw above, so there is no
      // created-but-unaccepted state to report the way Bob Go has.
      submission: 'SUBMITTED',
      shipmentId: String(json.id),
      trackingReference,
      status: json.status,
    };
  }

  // Cancel a booked TCG shipment (PUT /shipments/{id}). Best-effort — used
  // on the seller-reject path. Exact cancel body finalised when wired into
  // the reject flow (Phase 5).
  async cancelShipment(shipmentId: string): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      const res = await fetch(
        `${this.baseUrl}/shipments/${encodeURIComponent(shipmentId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ status: 'cancelled' }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`TCG cancel ${res.status} for ${shipmentId}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `TCG cancel failed for ${shipmentId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // Server-side ONLY — fetched by our auth-checked label proxy (Phase 3),
  // never handed to the seller directly. (TCG label auth confirmed when the
  // proxy is built.)
  waybillUrl(shipmentId: string): string {
    return `${this.baseUrl}/generate/waybill/${encodeURIComponent(shipmentId)}`;
  }

  // Fetch the waybill PDF server-side (Bearer auth stays on the server).
  // Streamed back to the seller via our own auth-checked proxy endpoint.
  async fetchWaybillPdf(shipmentId: string): Promise<Buffer> {
    const res = await fetch(this.waybillUrl(shipmentId), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/pdf',
      },
    });
    if (!res.ok) {
      throw new Error(`TCG waybill ${res.status} for ${shipmentId}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

// ────────────────────────── helpers ────────────────────────────────

function contactBody(c: CarrierContact): Record<string, unknown> {
  return { name: c.name, email: c.email ?? '', mobile_number: c.mobile };
}

function mapAddress(addr: TcgResidentialAddress): Record<string, unknown> {
  return {
    type: addr.type ?? 'residential',
    company: addr.company ?? undefined,
    street_address: addr.streetAddress,
    local_area: addr.suburb,
    city: addr.city,
    zone: addr.province,
    country: 'ZA',
    code: addr.postalCode,
    lat: addr.lat,
    lng: addr.lng,
  };
}

// Parse "Expect delivery between 3 - 4 business days." → 4.
// Returns null when the string doesn't match — caller falls back.
function parseDays(description?: string): number | null {
  if (!description) return null;
  const m = description.match(/(\d+)\s*[-–to]+\s*(\d+)\s*business\s*days/i);
  if (m) return parseInt(m[2], 10);
  const single = description.match(/(\d+)\s*business\s*days?/i);
  if (single) return parseInt(single[1], 10);
  return null;
}
