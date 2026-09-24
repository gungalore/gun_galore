// ─── Static service-level lookup (collection cut-offs / delivery days) ──────
//
// The platform books the cheapest/fastest door rate and the cheapest Pargo
// pickup-point rate, but it still has to KNOW a couple of facts about the
// service it is about to book:
//
//   - the collection cut-off, so the seller's "soonest pickup" date is real;
//   - the delivery business-day window, so the buyer's ETA copy is sane and
//     the "fastest" option can be ordered.
//
// Bob Go's rate response does NOT return either of those (it returns
// `min_delivery_date`/`max_delivery_date` only), so we keep a small reviewed
// table here, seeded from Bob Go's own published service-level guide.
//
// ⚠️ PROVIDER SLUGS ARE PROVISIONAL. The sandbox only ever quotes
// `sandbox`/`demo`, so the production slugs below (ie, tcg, pargo, ...) are
// best-effort and MUST be confirmed against a real `/rates-at-checkout`
// response before anyone relies on a per-service figure. Anything unmapped
// falls back to DEFAULT_COLLECTION_CUTOFF — deliberately conservative, so an
// unknown courier is never told it can collect later than it can.
//
// Dependency-free and pure: no Prisma, no Nest, so OffersService /
// ShippingService / the seller picker can all use it without wiring.

export interface ServiceLevelInfo {
  /** Bob Go `provider_slug`. */
  providerSlug: string;
  /**
   * Bob Go `service_level_code`. Omit for a provider-wide default that
   * applies to every service level the provider offers.
   */
  serviceLevelCode?: string;
  /** Human label for admin/diagnostics. */
  label: string;
  /** SAST "HH:MM" — a booking after this rolls collection to the next day. */
  collectionCutoff: string;
  /** Business days from collection to delivery. */
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  /** True for same-business-day services (none we offer today). */
  sameDay?: boolean;
  /** Operational constraints surfaced to sellers/admins. */
  requirements?: string;
}

/**
 * The conservative default applied to any unmapped provider/service. 14:00 is
 * the cut-off of most partners (RAM, Internet Express, Fastway, MTE, Citi LX),
 * so it is the safe floor for an unknown one.
 */
export const DEFAULT_COLLECTION_CUTOFF = '14:00';

/**
 * The table. Provider-level rows first (serviceLevelCode omitted), then any
 * per-service refinements. A more specific row always wins — see
 * `resolveServiceLevel`.
 */
const SERVICE_LEVELS: readonly ServiceLevelInfo[] = [
  // ── Pickup point (Pargo) ────────────────────────────────────────────
  {
    providerSlug: 'pargo',
    label: 'Pargo pickup point',
    collectionCutoff: '12:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
    requirements:
      'Parcel is delivered to a Pargo counter; the buyer collects. Receiver has 8 days.',
  },

  // ── Door couriers ───────────────────────────────────────────────────
  // Internet Express — all door services cut off at 14:00.
  {
    providerSlug: 'ie',
    label: 'Internet Express',
    collectionCutoff: '14:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  },
  // The Courier Guy — economy/priority at 15:00, local same-day at 10:30.
  {
    providerSlug: 'tcg',
    label: 'The Courier Guy',
    collectionCutoff: '15:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  },
  {
    providerSlug: 'tcg',
    serviceLevelCode: 'LSP',
    label: 'The Courier Guy — Local Same-day Parcel',
    collectionCutoff: '10:30',
    deliveryDaysMin: 0,
    deliveryDaysMax: 1,
    sameDay: true,
  },
  {
    providerSlug: 'tcg',
    serviceLevelCode: 'LSF',
    label: 'The Courier Guy — Local Same-day Flyer',
    collectionCutoff: '10:30',
    deliveryDaysMin: 0,
    deliveryDaysMax: 1,
    sameDay: true,
  },
  // RAM — next-day 12:00, economy 14:00.
  {
    providerSlug: 'ram',
    label: 'RAM',
    collectionCutoff: '14:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  },
  {
    providerSlug: 'ram',
    serviceLevelCode: 'ND',
    label: 'RAM — Next Day',
    collectionCutoff: '12:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 3,
  },
  // SkyNet — economy 14:30, express 13:00, same-day 09:00.
  {
    providerSlug: 'skynet',
    label: 'SkyNet',
    collectionCutoff: '14:30',
    deliveryDaysMin: 2,
    deliveryDaysMax: 5,
  },
  {
    providerSlug: 'skynet',
    serviceLevelCode: 'ON1L',
    label: 'SkyNet — Express',
    collectionCutoff: '13:00',
    deliveryDaysMin: 2,
    deliveryDaysMax: 3,
  },
  {
    providerSlug: 'skynet',
    serviceLevelCode: 'ON1M',
    label: 'SkyNet — Express',
    collectionCutoff: '13:00',
    deliveryDaysMin: 2,
    deliveryDaysMax: 3,
  },
  {
    providerSlug: 'skynet',
    serviceLevelCode: 'ON1R',
    label: 'SkyNet — Express',
    collectionCutoff: '13:00',
    deliveryDaysMin: 2,
    deliveryDaysMax: 3,
  },
  {
    providerSlug: 'skynet',
    serviceLevelCode: 'SDX',
    label: 'SkyNet — Same day',
    collectionCutoff: '09:00',
    deliveryDaysMin: 0,
    deliveryDaysMax: 1,
    sameDay: true,
  },
  // MTE Xpress — 14:00 except the overnight local.
  {
    providerSlug: 'mtexpress',
    label: 'MTE Xpress',
    collectionCutoff: '14:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  },
  {
    providerSlug: 'mtexpress',
    serviceLevelCode: 'LOVN',
    label: 'MTE Xpress — Local Overnight',
    collectionCutoff: '12:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 2,
  },
  // Fastway — everything 14:00.
  {
    providerSlug: 'fastway',
    label: 'Fastway',
    collectionCutoff: '14:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 6,
  },
  // City Logistics — economy 10:00, priority 15:00.
  {
    providerSlug: 'citylogistics',
    label: 'City Logistics',
    collectionCutoff: '10:00',
    deliveryDaysMin: 3,
    deliveryDaysMax: 5,
  },
  {
    providerSlug: 'citylogistics',
    serviceLevelCode: 'PRIR',
    label: 'City Logistics — Priority Regional',
    collectionCutoff: '15:00',
    deliveryDaysMin: 3,
    deliveryDaysMax: 5,
  },
  // Bob Box (pickup point) — cut-off 14:00.
  {
    providerSlug: 'bobbox',
    label: 'Bob Box',
    collectionCutoff: '14:00',
    deliveryDaysMin: 1,
    deliveryDaysMax: 3,
    requirements: 'Parcel is delivered to a Bob Box locker.',
  },
  // Sandbox stub — no real cut-off semantics.
  {
    providerSlug: 'sandbox',
    label: 'Sandbox Couriers',
    collectionCutoff: DEFAULT_COLLECTION_CUTOFF,
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  },
  {
    providerSlug: 'demo',
    label: 'Demo Couriers',
    collectionCutoff: DEFAULT_COLLECTION_CUTOFF,
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  },
];

function matches(
  row: ServiceLevelInfo,
  providerSlug: string,
  serviceLevelCode?: string | null,
): boolean {
  if (row.providerSlug !== providerSlug) return false;
  if (!row.serviceLevelCode) return true;
  return row.serviceLevelCode === (serviceLevelCode ?? '');
}

/**
 * Resolve the best row for a provider/service. A per-service row (with a
 * matching `serviceLevelCode`) wins over the provider-wide row; an unmapped
 * provider yields the conservative default.
 */
export function resolveServiceLevel(
  providerSlug: string | null | undefined,
  serviceLevelCode?: string | null,
): ServiceLevelInfo {
  const slug = (providerSlug ?? '').trim().toLowerCase();
  const code = (serviceLevelCode ?? '').trim().toUpperCase();

  const specific = SERVICE_LEVELS.find(
    (r) => r.serviceLevelCode && matches(r, slug, code),
  );
  if (specific) return specific;

  const provider = SERVICE_LEVELS.find((r) => matches(r, slug, code));
  if (provider) return provider;

  return {
    providerSlug: slug || 'unknown',
    label: slug || 'unknown provider',
    collectionCutoff: DEFAULT_COLLECTION_CUTOFF,
    deliveryDaysMin: 1,
    deliveryDaysMax: 5,
  };
}

/** The SAST collection cut-off ("HH:MM") for a service. */
export function collectionCutoffFor(
  providerSlug: string | null | undefined,
  serviceLevelCode?: string | null,
): string {
  return resolveServiceLevel(providerSlug, serviceLevelCode).collectionCutoff;
}

/** The delivery business-day window for a service. */
export function deliveryDaysFor(
  providerSlug: string | null | undefined,
  serviceLevelCode?: string | null,
): { min: number; max: number } {
  const r = resolveServiceLevel(providerSlug, serviceLevelCode);
  return { min: r.deliveryDaysMin, max: r.deliveryDaysMax };
}

/** Parse "HH:MM" into a whole-hour number, defaulting to the safe floor. */
export function cutoffHour(cutoff: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((cutoff ?? '').trim());
  if (!m) return Number(DEFAULT_COLLECTION_CUTOFF.split(':')[0]);
  const h = Number(m[1]);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 14;
}
