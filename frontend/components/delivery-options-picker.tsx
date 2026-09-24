'use client';

// The buyer's three delivery options: Store Pickup (Pargo), cheapest door, and
// fastest door. All are quoted by one POST /shipping/delivery-options call.
// THE ADDRESS COMES FIRST: the rate is for this exact parcel to this exact
// address, so there is nothing truthful to show before the address exists.

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/utils';

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
   * The carrier's own rate, our delivery margin excluded. NEVER displayed —
   * the buyer sees one delivery figure (priceCents). It exists because the
   * transaction fee is charged on the carrier rate only, so the checkout
   * preview needs it to match the server to the cent.
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

function addressComplete(a: DeliveryAddressInput | null): a is DeliveryAddressInput {
  return Boolean(
    a && a.streetAddress && a.suburb && a.city && a.postalCode && a.province,
  );
}

export function DeliveryOptionsPicker({
  listingId,
  deliveryAddress,
  onSelect,
  getToken,
}: {
  listingId: string;
  deliveryAddress: DeliveryAddressInput | null;
  onSelect: (option: DeliveryOption) => void;
  /** Clerk token getter — browse endpoints must forward the session. */
  getToken?: () => Promise<string | null>;
}) {
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<DeliveryOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest onSelect, so the fetch (which must not depend on the parent's
  // per-render function identity) still reports into the current handler.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
        body: JSON.stringify({ listingId, deliveryAddress }),
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
      setSelectedOption(null);
    } catch {
      setError('We could not load delivery options. Please try again in a moment.');
      setOptions([]);
      setSelectedOption(null);
    } finally {
      setLoading(false);
    }
    // Keyed on the address VALUES (addrKey) rather than the object identity;
    // a fresh object every parent render would otherwise loop the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, addrKey, addrComplete, getToken]);

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
        <div className="h-16 animate-pulse rounded-lg bg-neutral-100" />
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

  return (
    <div className="space-y-2">
      {options.map((option) => {
        const selected =
          selectedOption?.kind === option.kind &&
          (option.kind !== 'STORE_PICKUP' ||
            selectedOption.pickupPointLocationId === option.pickupPointLocationId);
        return (
          <button
            key={`${option.kind}:${option.pickupPointLocationId ?? option.serviceCode}`}
            type="button"
            onClick={() => {
              setSelectedOption(option);
              onSelectRef.current(option);
            }}
            aria-pressed={Boolean(selected)}
            className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left"
            style={{
              borderColor: selected ? 'var(--red)' : 'var(--border)',
              background: selected ? 'var(--red-wash)' : 'var(--bg-card)',
              color: 'var(--text-primary)',
            }}
          >
            <span aria-hidden className="text-neutral-500"><TruckIcon /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{option.label}</span>
              <span className="block truncate text-sm" style={{ color: 'var(--text-secondary)' }}>
                {option.kind === 'STORE_PICKUP'
                  ? `${option.detail ?? 'Pargo counter'}${option.pickupPointDistanceKm != null ? ` · ${option.pickupPointDistanceKm.toFixed(1)} km` : ''}`
                  : option.detail}
              </span>
              {option.kind === 'STORE_PICKUP' && option.description && (
                <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>{option.description}</span>
              )}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{formatPrice(option.priceCents)}</span>
          </button>
        );
      })}
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
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
