'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The cart's delivery line — one door rate per parcel the cart will ship as.
 *
 * WHY IT ISN'T DeliveryOptionsPicker. That component takes a single
 * `listingId`, and a cart consolidates: same-seller lines share one waybill,
 * and the price of that combined box is arithmetically unrelated to the sum of
 * its lines. The grouping is computed SERVER-side by the same function
 * checkout uses to decide what to charge — the client must not attempt it,
 * because every Daily Deal shares the house seller id and a client-side guess
 * would show one parcel where two suppliers each ship one.
 *
 * Each consolidated parcel group offers cheapest door, fastest door, and the
 * nearest Pargo counters. The server computes both groupings and rates; the
 * buyer's choice is copied to every line in that group at checkout.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface CartDeliveryAddress {
  streetAddress: string;
  suburb: string;
  city: string;
  postalCode: string;
  province: string;
}

export interface CartDeliveryOption {
  kind: 'DOOR_CHEAPEST' | 'DOOR_FASTEST' | 'STORE_PICKUP';
  serviceCode: string;
  providerSlug: string;
  serviceLevelCode: string;
  label: string;
  detail?: string;
  priceCents: number;
  /** Bare carrier rate — the processing-fee base; margin excluded. */
  carrierRateCents: number;
  pickupPointLocationId?: number;
  pickupPointDistanceKm?: number;
  description?: string;
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
  pickupPointLocationId?: number;
  pickupPointDistanceKm?: number;
  description?: string;
}

interface ApiGroup {
  groupKey: string;
  listingIds: string[];
  consolidated: boolean;
  door: ApiRate | null;
  fastestDoor?: ApiRate | null;
  storePickup?: ApiRate[];
  unavailableReason?: string;
}

export interface CartDeliveryGroupView {
  groupKey: string;
  listingIds: string[];
  consolidated: boolean;
  options: CartDeliveryOption[];
  unavailableReason?: string;
}

function toOptions(g: ApiGroup): CartDeliveryOption[] {
  const doors = [
    ...(g.door ? [{ rate: g.door, kind: 'DOOR_CHEAPEST' as const, label: 'Cheapest Door Delivery' }] : []),
    ...(g.fastestDoor ? [{ rate: g.fastestDoor, kind: 'DOOR_FASTEST' as const, label: 'Fastest Door Delivery' }] : []),
  ].map(({ rate, kind, label }): CartDeliveryOption => ({
    kind,
    serviceCode: rate.serviceCode,
    providerSlug: rate.providerSlug,
    serviceLevelCode: rate.serviceLevelCode,
    label,
    detail: `${rate.serviceName} · ${rate.deliveryDaysMin}–${rate.deliveryDaysMax} business days`,
    priceCents: rate.priceCents,
    carrierRateCents: rate.carrierRateCents,
  }));
  const points = (g.storePickup ?? []).map((rate): CartDeliveryOption => ({
    kind: 'STORE_PICKUP',
    serviceCode: rate.serviceCode,
    providerSlug: rate.providerSlug,
    serviceLevelCode: rate.serviceLevelCode,
    label: 'Store Pickup',
    detail: `${rate.serviceName}${rate.pickupPointDistanceKm != null ? ` · ${rate.pickupPointDistanceKm.toFixed(1)} km` : ''}`,
    priceCents: rate.priceCents,
    carrierRateCents: rate.carrierRateCents,
    pickupPointLocationId: rate.pickupPointLocationId,
    pickupPointDistanceKm: rate.pickupPointDistanceKm,
    description: rate.description,
  }));
  return [...doors, ...points];
}

const rand = (cents: number) =>
  'R' + (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 });

export function CartDeliveryPicker({
  lines,
  deliveryAddress,
  chosen,
  onChoose,
  onGroups,
  getToken,
}: {
  lines: { listingId: string; quantity?: number }[];
  deliveryAddress: CartDeliveryAddress | null;
  chosen: Record<string, CartDeliveryOption>;
  onChoose: (groupKey: string, option: CartDeliveryOption) => void;
  /** Lets the cart know the group shape, so it can gate Continue on it. */
  onGroups: (groups: CartDeliveryGroupView[]) => void;
  getToken?: () => Promise<string | null>;
}) {
  const [groups, setGroups] = useState<CartDeliveryGroupView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest callbacks, so the fetch (which must not depend on the cart's
  // per-render handlers) still reports into the current ones.
  const onChooseRef = useRef(onChoose);
  const onGroupsRef = useRef(onGroups);
  onChooseRef.current = onChoose;
  onGroupsRef.current = onGroups;

  const addressComplete =
    !!deliveryAddress &&
    !!deliveryAddress.streetAddress &&
    !!deliveryAddress.city &&
    !!deliveryAddress.postalCode &&
    !!deliveryAddress.province;

  // Invalidate on the address AND on cart membership + quantities — changing a
  // quantity changes the stacked parcel, which changes the price. Keying on
  // the address alone would leave a stale figure on screen.
  const linesKey = lines
    .map((l) => `${l.listingId}:${l.quantity ?? 1}`)
    .sort()
    .join(',');
  const addrKey = addressComplete
    ? `${deliveryAddress!.streetAddress}|${deliveryAddress!.suburb}|${deliveryAddress!.city}|${deliveryAddress!.postalCode}|${deliveryAddress!.province}`
    : '';

  const load = useCallback(async () => {
    if (!addressComplete || lines.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const token = getToken ? await getToken().catch(() => null) : null;
      const res = await fetch(`${API_URL}/shipping/delivery-options/cart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lines, deliveryAddress }),
      });
      // Read defensively — an empty 200 body throws on res.json(). Same trap
      // that broke the sign-up flow.
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new Error(
          (data as { message?: string } | null)?.message ??
            'Could not load delivery options.',
        );
      }
      const view: CartDeliveryGroupView[] = (data as ApiGroup[]).map((g) => ({
        groupKey: g.groupKey,
        listingIds: g.listingIds,
        consolidated: g.consolidated,
        options: toOptions(g),
        unavailableReason: g.unavailableReason,
      }));
      setGroups(view);
      onGroupsRef.current(view);
      // Default each parcel group to its cheapest door option; buyer can then
      // switch to fastest or one of the Store Pickup counters.
      for (const g of view) {
        if (!g.unavailableReason && g.options[0]) {
          onChooseRef.current(g.groupKey, g.options[0]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load delivery options.');
      setGroups(null);
      onGroupsRef.current([]);
    } finally {
      setLoading(false);
    }
    // The data dependencies are the address and the cart contents; the
    // callbacks are read through refs so this doesn't refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey, linesKey, addressComplete]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!addressComplete) {
    return (
      <div
        className="rounded-[8px] p-4 text-sm"
        style={{
          border: '1px dashed var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        Enter your delivery address to see delivery options and prices.
      </div>
    );
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-2">
        <div className="gg-skeleton" style={{ height: 52, borderRadius: 8 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-[8px] p-4 text-sm"
        style={{
          background: 'rgba(227,6,19,0.08)',
          border: '0.5px solid var(--red)',
          color: 'var(--red)',
        }}
      >
        {error}{' '}
        <button
          type="button"
          onClick={() => void load()}
          style={{ textDecoration: 'underline', fontWeight: 600 }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!groups || groups.length === 0) return null;

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.groupKey}>
          {g.consolidated && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
              These {g.listingIds.length} items ship together as one parcel —
              one delivery charge.
            </p>
          )}

          {g.unavailableReason ? (
            <div
              className="rounded-[8px] p-4 text-sm"
              style={{
                background: 'rgba(245,158,11,0.10)',
                border: '0.5px solid rgba(245,158,11,0.5)',
                color: 'var(--text-secondary)',
              }}
            >
              {g.unavailableReason}
            </div>
          ) : (
            g.options.map((o) => {
              const active = chosen[g.groupKey]?.kind === o.kind &&
                (o.kind !== 'STORE_PICKUP' || chosen[g.groupKey]?.pickupPointLocationId === o.pickupPointLocationId);
              return (
                <button
                  key={`${o.kind}:${o.pickupPointLocationId ?? o.serviceCode}`}
                  type="button"
                  onClick={() => onChooseRef.current(g.groupKey, o)}
                  aria-pressed={active}
                  className="flex w-full items-center gap-3 rounded-[8px] p-3 text-left"
                  style={{
                    background: active ? 'var(--red-wash)' : 'var(--bg-card)',
                    border: `0.5px solid ${active ? 'var(--red)' : 'var(--border)'}`,
                  }}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {o.label}
                    </span>
                    {o.detail && <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>{o.detail}</span>}
                    {o.kind === 'STORE_PICKUP' && o.description && <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>{o.description}</span>}
                  </span>
                  <span className="text-sm gg-nums" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {rand(o.priceCents)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}
