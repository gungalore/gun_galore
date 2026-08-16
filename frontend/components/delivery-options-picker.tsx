'use client';

// The buyer's delivery menu: door delivery and every nearby collection point,
// priced, in one list.
//
// The delivery option is the BUYER'S to decide (operator, 2026-08-13). The
// seller no longer curates it, so this component shows everything the courier
// will actually carry for this parcel and lets the buyer choose.
//
// It talks to ONE endpoint, POST /shipping/delivery-options, which answers
// identically whichever courier rail is live. That is deliberate: this
// component must never learn which carrier it is talking to, or swapping the
// carrier would become a frontend release too.
//
// THE ADDRESS COMES FIRST. Collection points are the ones near the buyer's
// delivery address and are priced for this exact parcel, so there is nothing
// truthful to show before the address exists. That is a change from the old
// locker picker, which let people browse a directory and only learn the price
// (and whether their parcel even fit) later.

import { useCallback, useEffect, useState } from 'react';
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
  kind: 'DOOR' | 'PICKUP_POINT';
  /**
   * The carrier's own rate, our delivery margin excluded. NEVER displayed —
   * the buyer sees one delivery figure (priceCents). It exists because the
   * transaction fee is charged on the carrier rate only, so the checkout
   * preview needs it to match the server to the cent.
   */
  carrierRateCents: number;
  /** Echoed back at checkout so the booking replays the exact rate chosen. */
  serviceCode: string;
  label: string;
  detail?: string;
  distanceKm?: number;
  priceCents: number;
  locationId?: number;
}

interface ApiResponse {
  door: {
    priceCents: number;
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
}

function LockerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <circle cx="16" cy="6" r="0.6" fill="currentColor" />
    </svg>
  );
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
  selectedServiceCode,
  onSelect,
  getToken,
}: {
  listingId: string;
  deliveryAddress: DeliveryAddressInput | null;
  selectedServiceCode?: string;
  onSelect: (option: DeliveryOption) => void;
  /** Clerk token getter — browse endpoints must forward the session. */
  getToken?: () => Promise<string | null>;
}) {
  const [options, setOptions] = useState<DeliveryOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!addressComplete(deliveryAddress)) {
      setOptions(null);
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
        setOptions(null);
        return;
      }

      const next: DeliveryOption[] = [];
      if (data?.door) {
        next.push({
          kind: 'DOOR',
          serviceCode: data.door.serviceCode,
          label: 'Deliver to my address',
          detail: data.door.serviceName,
          priceCents: data.door.priceCents,
          carrierRateCents: data.door.carrierRateCents,
        });
      }
      for (const p of data?.pickupPoints ?? []) {
        next.push({
          kind: 'PICKUP_POINT',
          serviceCode: p.serviceCode,
          label: p.name,
          detail: p.description,
          distanceKm: p.distanceKm,
          priceCents: p.priceCents,
          carrierRateCents: p.carrierRateCents,
          locationId: p.locationId,
        });
      }
      setOptions(next);
    } catch {
      setError('We could not load delivery options. Please try again in a moment.');
      setOptions(null);
    } finally {
      setLoading(false);
    }
  }, [listingId, deliveryAddress, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!addressComplete(deliveryAddress)) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
        Enter your delivery address to see delivery options and prices.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading delivery options</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-100" />
        ))}
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

  if (options && options.length === 0) {
    // Distinct from the error above on purpose: nothing is broken, the courier
    // simply does not serve this parcel to this address.
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No courier option is available for this parcel to that address. Try a
        different address, or contact the seller about collecting in person.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Choose how you would like this delivered</legend>
      {(options ?? []).map((o) => {
        const checked = selectedServiceCode === o.serviceCode;
        return (
          <label
            key={o.serviceCode}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
              checked
                ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                : 'border-neutral-200 hover:border-neutral-300'
            }`}
          >
            <input
              type="radio"
              name="delivery-option"
              value={o.serviceCode}
              checked={checked}
              onChange={() => onSelect(o)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={checked ? 'text-emerald-700' : 'text-neutral-500'}
            >
              {o.kind === 'DOOR' ? <TruckIcon /> : <LockerIcon />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-neutral-900">
                {o.label}
              </span>
              {(o.detail || o.distanceKm != null) && (
                <span className="block truncate text-sm text-neutral-500">
                  {o.distanceKm != null && (
                    <span className="tabular-nums">
                      {o.distanceKm < 1
                        ? `${Math.round(o.distanceKm * 1000)} m away`
                        : `${o.distanceKm.toFixed(1)} km away`}
                    </span>
                  )}
                  {o.distanceKm != null && o.detail ? ' · ' : ''}
                  {o.detail}
                </span>
              )}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-neutral-900">
              {formatPrice(o.priceCents)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
