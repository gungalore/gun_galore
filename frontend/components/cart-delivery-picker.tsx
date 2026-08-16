'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The cart's delivery menu — one radio list per parcel the cart will ship as.
 *
 * WHY IT ISN'T DeliveryOptionsPicker. That component takes a single
 * `listingId`, and a cart consolidates: same-seller lines share one waybill,
 * and the price of that combined box is arithmetically unrelated to the sum of
 * its lines. The grouping is computed SERVER-side by the same function
 * checkout uses to decide what to charge — the client must not attempt it,
 * because every Daily Deal shares the house seller id and a client-side guess
 * would show one parcel where two suppliers each ship one.
 *
 * Otherwise this deliberately mirrors DeliveryOptionsPicker: one flat radio
 * list per group with door and collection points together, `serviceCode` as
 * both the React key and the checked identity, and the same five states —
 * address-incomplete, loading, error, no-options, and the list. The
 * no-options state is amber and deliberately distinct from the red error:
 * nothing is broken, the courier simply does not serve that parcel to that
 * address.
 *
 * The buyer is never asked to choose a carrier. They choose a DELIVERY.
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
  kind: 'DOOR' | 'PICKUP_POINT';
  serviceCode: string;
  label: string;
  detail?: string;
  distanceKm?: number;
  priceCents: number;
  /** Bare carrier rate — the processing-fee base; margin excluded. */
  carrierRateCents: number;
  /** Only on a collection point: pins WHICH point, by numeric id. */
  locationId?: number;
}

interface ApiGroup {
  groupKey: string;
  listingIds: string[];
  consolidated: boolean;
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
  const out: CartDeliveryOption[] = [];
  if (g.door) {
    out.push({
      kind: 'DOOR',
      serviceCode: g.door.serviceCode,
      label: 'Deliver to my address',
      detail: g.door.serviceName,
      priceCents: g.door.priceCents,
      carrierRateCents: g.door.carrierRateCents,
    });
  }
  for (const p of g.pickupPoints) {
    out.push({
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
  return out;
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
      onGroups(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load delivery options.');
      setGroups(null);
      onGroups([]);
    } finally {
      setLoading(false);
    }
    // onGroups is a parent callback; including it would refetch on every parent
    // render. The data dependencies are the address and the cart contents.
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
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="gg-skeleton"
            style={{ height: 52, borderRadius: 8 }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-[8px] p-4 text-sm"
        style={{
          background: 'rgba(200,16,46,0.08)',
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
            <fieldset className="space-y-2">
              {g.options.map((o) => {
                const checked = chosen[g.groupKey]?.serviceCode === o.serviceCode;
                return (
                  <label
                    key={o.serviceCode}
                    className="flex items-center gap-3 rounded-[8px] p-3 cursor-pointer"
                    style={{
                      background: checked ? 'rgba(200,16,46,0.06)' : 'var(--bg-card)',
                      border: `0.5px solid ${checked ? 'var(--red)' : 'var(--border)'}`,
                    }}
                  >
                    <input
                      type="radio"
                      name={`delivery-${g.groupKey}`}
                      checked={checked}
                      onChange={() => onChoose(g.groupKey, o)}
                      style={{ accentColor: 'var(--red)' }}
                    />
                    <span className="flex-1 min-w-0">
                      <span
                        className="block text-sm"
                        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                      >
                        {o.label}
                      </span>
                      {(o.detail || o.distanceKm != null) && (
                        <span
                          className="block text-xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {o.detail}
                          {o.distanceKm != null
                            ? `${o.detail ? ' · ' : ''}${o.distanceKm.toFixed(1)} km away`
                            : ''}
                        </span>
                      )}
                    </span>
                    <span
                      className="text-sm gg-nums"
                      style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                    >
                      {rand(o.priceCents)}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </div>
      ))}
    </div>
  );
}
