'use client';

// The buyer's delivery choices, as Takealot-style cards: Fastest and Cheapest
// door delivery side by side, then a "Collect from a store" group of Pargo
// counters. All are quoted by ONE POST /shipping/delivery-options call.
// THE ADDRESS COMES FIRST: the rate is for this exact parcel to this exact
// address, so there is nothing truthful to show before the address exists.
//
// Presentation only: the same `choose` callback, default selection and
// single-fetch logic the checkout (and offer checkout) already relied on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/utils';
import { pargoDistanceLabel, pargoOptionLabel } from '@/lib/pargo-pickup';

// Same convention as every other browse fetch — the API is a separate origin, so a
// bare '/api/...' path would hit the Next server instead of the backend.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface DeliveryAddressInput {
  streetAddress: string;
  suburb: string;
  city: string;
  postalCode: string;
  province: string;
  lat?: number;
  lng?: number;
}

export interface DeliveryOption {
  kind: 'DOOR_CHEAPEST' | 'DOOR_FASTEST' | 'STORE_PICKUP';
  /**
   * The carrier's own rate. There is no delivery margin since 2026-10-23, so
   * this equals priceCents; kept because older quotes and rows carry both.
   * NEVER displayed on its own — the buyer sees one delivery figure.
   */
  carrierRateCents: number;
  /** Echoed back at checkout so the booking replays the exact rate chosen. */
  serviceCode: string;
  /** Bob Go booking needs these replayed alongside serviceCode. */
  providerSlug?: string;
  serviceLevelCode?: string;
  pickupPointLocationId?: number;
  pickupPointDistanceKm?: number;
  description?: string;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
  /** The carrier's own product name ("The Courier Guy …", Pargo counter name). */
  serviceName?: string;
  label: string;
  detail?: string;
  priceCents: number;
}

interface ApiRate {
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
    pickupPointLocationId?: number;
    pickupPointDistanceKm?: number;
    description?: string;
}

interface ApiResponse {
  door: ApiRate | null;
  fastestDoor: ApiRate | null;
  storePickup: ApiRate[];
}

function TruckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function addressComplete(a: DeliveryAddressInput | null): a is DeliveryAddressInput {
  return Boolean(
    a && a.streetAddress && a.suburb && a.city && a.postalCode && a.province,
  );
}

// ─── Date labels ────────────────────────────────────────────────────────
// The carrier returns ISO calendar dates (not times) for the window. SAST is
// the marketplace's clock, so "Today"/"Tomorrow" are resolved there — a buyer
// on a phone with a wrong clock still sees the same words the server quoted.
const SAST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function sastDayKey(date: Date): string {
  return SAST_DAY.format(date);
}

/** "Mon 30 Nov", or "Today"/"Tomorrow" for the nearest two days. */
export function formatDeliveryDay(iso: string): string {
  const day = iso.slice(0, 10);
  const now = Date.now();
  if (day === sastDayKey(new Date(now))) return 'Today';
  if (day === sastDayKey(new Date(now + 24 * 60 * 60 * 1000))) return 'Tomorrow';
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return formatWeekdayDate(date);
}

function formatWeekdayDate(date: Date): string {
  const weekday = date
    .toLocaleDateString('en-ZA', { weekday: 'short', timeZone: 'UTC' })
    .replace(/[,.]/g, '')
    .trim();
  const dayMonth = date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${weekday} ${dayMonth}`;
}

function formatDayMonth(date: Date): { day: string; month: string } {
  // Ask for day and month separately: en-ZA's combined date pattern pads the
  // day ("02 Mar") while the bare numeric day is unpadded ("2") — a range must
  // read "1–2 Mar", not "1–02 Mar".
  return {
    day: date.toLocaleDateString('en-ZA', {
      day: 'numeric',
      timeZone: 'UTC',
    }),
    month: date.toLocaleDateString('en-ZA', {
      month: 'short',
      timeZone: 'UTC',
    }),
  };
}

/**
 * The delivery promise for a card. A range keeps both ends ("27–30 Nov"); a
 * single date gets a weekday. When the carrier returned no dates at all the
 * fallback is its own business-day band — never an invented time window.
 */
export function formatDeliveryWindow(option: DeliveryOption): string {
  const min = option.minDeliveryDate;
  const max = option.maxDeliveryDate;
  if (min && max) {
    const minDay = min.slice(0, 10);
    const maxDay = max.slice(0, 10);
    if (minDay === maxDay) return formatDeliveryDay(minDay);
    const from = new Date(`${minDay}T12:00:00Z`);
    const to = new Date(`${maxDay}T12:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return `${formatIsoDay(minDay)}–${formatIsoDay(maxDay)}`;
    }
    const a = formatDayMonth(from);
    const b = formatDayMonth(to);
    // Same month reads as "27–30 Nov"; cross-month keeps both months.
    return a.month === b.month
      ? `${a.day}–${b.day} ${a.month}`
      : `${a.day} ${a.month} – ${b.day} ${b.month}`;
  }
  if (min) return formatDeliveryDay(min);
  return `${option.deliveryDaysMin}–${option.deliveryDaysMax} business days`;
}

export function DeliveryOptionsPicker({
  listingId,
  deliveryAddress,
  onSelect,
  getToken,
  quantity = 1,
}: {
  listingId: string;
  deliveryAddress: DeliveryAddressInput | null;
  onSelect: (option: DeliveryOption) => void;
  /** Clerk token getter — browse endpoints must forward the session. */
  getToken?: () => Promise<string | null>;
  /**
   * Units on the line. The courier is booked for the STACKED parcel, so the
   * quote has to be for the stacked parcel too — otherwise a buyer of five
   * sees one unit's freight and the carrier bills five. Defaults to 1.
   */
  quantity?: number;
}) {
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<DeliveryOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest onSelect, so the fetch (which must not depend on the parent's
  // per-render function identity) still reports into the current handler.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Latest selection, so a re-fetch (quantity/address change) can keep the
  // buyer's choice instead of silently clearing it.
  const selectedRef = useRef<DeliveryOption | null>(null);

  // One place that changes the selection, so the parent always hears about it.
  // 2026-11-24: the checkout used to require a manual tap before Pay enabled.
  // After a gateway round-trip the form remounts with no selection, so Pay sat
  // grey with no explanation (the "why is Pay disabled?" buyer report). A
  // cheapest-delivery default is what Amazon/eBay do and keeps checkout honest:
  // the default is always editable and always priced.
  function choose(option: DeliveryOption) {
    selectedRef.current = option;
    setSelectedOption(option);
    onSelectRef.current(option);
  }

  function defaultFor(next: DeliveryOption[]): DeliveryOption | null {
    const prev = selectedRef.current;
    if (prev) {
      const still = next.find(
        (o) =>
          o.kind === prev.kind &&
          (o.kind !== 'STORE_PICKUP' ||
            o.pickupPointLocationId === prev.pickupPointLocationId),
      );
      if (still) return still;
    }
    return (
      next.find((o) => o.kind === 'DOOR_CHEAPEST') ??
      next.find((o) => o.kind === 'DOOR_FASTEST') ??
      next[0] ??
      null
    );
  }

  // Serialise the address so the effect keys on the VALUES, not on a fresh
  // object identity every render (which would loop the fetch).
  const addrComplete = addressComplete(deliveryAddress);
  const addrKey = addrComplete
    ? `${deliveryAddress.streetAddress}|${deliveryAddress.suburb}|${deliveryAddress.city}|${deliveryAddress.postalCode}|${deliveryAddress.province}|${deliveryAddress.lat ?? ''}|${deliveryAddress.lng ?? ''}`
    : '';

  const load = useCallback(async () => {
    if (!addrComplete) {
      setOptions([]);
      setSelectedOption(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = getToken ? await getToken() : null;
      const res = await fetch(`${API_URL}/shipping/delivery-options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ listingId, deliveryAddress, quantity }),
      });

      // An empty 200 body would throw on res.json(); read defensively — this
      // is the same trap that broke the sign-up flow.
      const text = await res.text();
      const data = text ? (JSON.parse(text) as ApiResponse & { message?: string }) : null;

      if (!res.ok) {
        setError(
          data?.message ??
            'We could not load delivery options. Please try again in a moment.',
        );
        setOptions([]);
        selectedRef.current = null;
        setSelectedOption(null);
        return;
      }

      const toDoorOption = (
        rate: ApiRate | null,
        kind: 'DOOR_CHEAPEST' | 'DOOR_FASTEST',
        label: string,
      ): DeliveryOption | null => rate ? ({
        kind,
        serviceCode: rate.serviceCode,
        providerSlug: rate.providerSlug,
        serviceLevelCode: rate.serviceLevelCode,
        label,
        serviceName: rate.serviceName,
        detail: deliveryDetail(rate),
        priceCents: rate.priceCents,
        carrierRateCents: rate.carrierRateCents,
        deliveryDaysMin: rate.deliveryDaysMin,
        deliveryDaysMax: rate.deliveryDaysMax,
        minDeliveryDate: rate.minDeliveryDate,
        maxDeliveryDate: rate.maxDeliveryDate,
      }) : null;
      const nextOptions: DeliveryOption[] = [
        toDoorOption(data?.door ?? null, 'DOOR_CHEAPEST', 'Cheapest Door Delivery'),
        toDoorOption(data?.fastestDoor ?? null, 'DOOR_FASTEST', 'Fastest Door Delivery'),
        ...(data?.storePickup ?? []).map((point): DeliveryOption => ({
          kind: 'STORE_PICKUP',
          serviceCode: point.serviceCode,
          providerSlug: point.providerSlug,
          serviceLevelCode: point.serviceLevelCode,
          pickupPointLocationId: point.pickupPointLocationId,
          pickupPointDistanceKm: point.pickupPointDistanceKm,
          description: point.description,
          label: 'Store Pickup',
          serviceName: point.serviceName,
          detail: point.serviceName,
          priceCents: point.priceCents,
          carrierRateCents: point.carrierRateCents,
          deliveryDaysMin: point.deliveryDaysMin,
          deliveryDaysMax: point.deliveryDaysMax,
          minDeliveryDate: point.minDeliveryDate,
          maxDeliveryDate: point.maxDeliveryDate,
        })),
      ].filter((option): option is DeliveryOption => option !== null);
      setOptions(nextOptions);
      const preferred = defaultFor(nextOptions);
      if (preferred) {
        choose(preferred);
      } else {
        selectedRef.current = null;
        setSelectedOption(null);
      }
    } catch {
      setError('We could not load delivery options. Please try again in a moment.');
      setOptions([]);
      selectedRef.current = null;
      setSelectedOption(null);
    } finally {
      setLoading(false);
    }
    // Keyed on the address VALUES (addrKey) rather than the object identity;
    // a fresh object every parent render would otherwise loop the fetch.
    // `quantity` belongs here too: it changes the parcel, so it changes the
    // price, and a stale quote for the wrong stack is exactly the divergence
    // this prop exists to remove.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, addrKey, addrComplete, getToken, quantity]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!addressComplete(deliveryAddress)) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
        Enter your delivery address to see the delivery price.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading delivery price</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
          <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Try again
        </button>
      </div>
    );
  }

  if (options.length === 0) {
    // Distinct from the error above on purpose: nothing is broken, the courier
    // simply does not serve this parcel to this address.
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No delivery option is available for this parcel to that address. Try a
        different address or contact the seller.
      </p>
    );
  }

  const isSelected = (option: DeliveryOption) =>
    selectedOption?.kind === option.kind &&
    (option.kind !== 'STORE_PICKUP' ||
      selectedOption.pickupPointLocationId === option.pickupPointLocationId);
  // Fastest first, then Cheapest — the marketplace order. Both carry the same
  // priced choice; only the promise and the price differ.
  const doorOptions = options
    .filter((option) => option.kind !== 'STORE_PICKUP')
    .sort((a, b) =>
      a.kind === 'DOOR_FASTEST' ? -1 : b.kind === 'DOOR_FASTEST' ? 1 : 0,
    );
  const pickupOptions = options.filter((option) => option.kind === 'STORE_PICKUP');

  return (
    <div className="space-y-4">
      {doorOptions.length > 0 && (
        <div
          role="group"
          aria-label="Door delivery"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          {doorOptions.map((option) => {
            const selected = isSelected(option);
            const isFastest = option.kind === 'DOOR_FASTEST';
            return (
              <button
                key={`${option.kind}:${option.serviceCode}`}
                type="button"
                onClick={() => choose(option)}
                aria-pressed={selected}
                className="w-full rounded-[8px] px-3 py-3 text-left"
                style={{
                  border: `1.5px solid ${
                    selected
                      ? 'var(--action-option-selected-edge)'
                      : 'var(--action-option-edge)'
                  }`,
                  background: selected
                    ? 'var(--action-option-selected-bg)'
                    : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="flex items-start justify-between gap-2">
                  <span
                    className="text-xs uppercase"
                    style={{
                      color: selected
                        ? 'var(--action-option-selected-ink)'
                        : 'var(--text-tertiary)',
                      letterSpacing: '0.06em',
                      fontWeight: 700,
                    }}
                  >
                    {isFastest ? 'Fastest' : 'Cheapest'}
                  </span>
                  <span
                    className="text-sm flex-shrink-0"
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatPrice(option.priceCents)}
                  </span>
                </span>
                <span
                  className="block text-sm mt-1.5"
                  style={{ fontWeight: 600, lineHeight: 1.35 }}
                >
                  {formatDeliveryWindow(option)}
                </span>
                <span
                  className="block text-xs mt-0.5"
                  style={{
                    color: 'var(--text-secondary)',
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                  }}
                >
                  {option.serviceName ?? option.detail ?? 'Door delivery'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {pickupOptions.length > 0 && (
        <div>
          <p
            className="text-sm mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Collect from a store
          </p>
          <div
            role="group"
            aria-label="Collect from a store"
            className="space-y-2"
          >
            {pickupOptions.map((option) => {
              const selected = isSelected(option);
              const distance = pargoDistanceLabel(option.pickupPointDistanceKm);
              return (
                <button
                  key={`STORE_PICKUP:${option.pickupPointLocationId ?? option.serviceCode}`}
                  type="button"
                  onClick={() => choose(option)}
                  aria-pressed={selected}
                  className="w-full rounded-[8px] px-3 py-3 text-left"
                  style={{
                    border: `1.5px solid ${
                      selected
                        ? 'var(--action-option-selected-edge)'
                        : 'var(--action-option-edge)'
                    }`,
                    background: selected
                      ? 'var(--action-option-selected-bg)'
                      : 'var(--bg-card)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex items-start gap-2 min-w-0">
                      <span
                        aria-hidden
                        style={{
                          flexShrink: 0,
                          color: selected
                            ? 'var(--action-option-selected-ink)'
                            : 'var(--text-tertiary)',
                        }}
                      >
                        <StoreIcon />
                      </span>
                      <span className="min-w-0">
                        <span
                          className="block text-sm"
                          style={{ fontWeight: 600, lineHeight: 1.35 }}
                        >
                          {pargoOptionLabel(option.detail)}
                        </span>
                        <span
                          className="block text-xs mt-0.5"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {distance
                            ? `${distance} · Collect from a store`
                            : 'Collect from a store'}
                        </span>
                      </span>
                    </span>
                    <span
                      className="text-sm flex-shrink-0"
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatPrice(option.priceCents)}
                    </span>
                  </span>
                  {/* Directions + trading hours stay collapsed until the buyer
                      picks this counter — the list is a price/choice view, not
                      a wall of addresses. */}
                  {selected && option.description && (
                    <span
                      className="block text-xs mt-1.5"
                      style={{
                        color: 'var(--text-tertiary)',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-line',
                      }}
                    >
                      {option.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function deliveryDetail(rate: ApiRate): string {
  if (rate.minDeliveryDate && rate.maxDeliveryDate) {
    return `${rate.serviceName} · estimated ${formatIsoDay(rate.minDeliveryDate)}–${formatIsoDay(rate.maxDeliveryDate)}`;
  }
  return `${rate.serviceName} · ${rate.deliveryDaysMin}–${rate.deliveryDaysMax} business days`;
}

function formatIsoDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
