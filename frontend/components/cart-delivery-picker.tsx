'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pargoDistanceLabel, pargoOptionLabel } from '@/lib/pargo-pickup';
import type {
  CartClassGroup,
} from '@/lib/cart-delivery';

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
 * Multi-item checkout (2026-11-27): the cart groups its lines by SELLER and
 * delivery class, with ONE toggle per class group, and this picker is only fed
 * the lines whose seller group chose Courier. The server still returns one
 * quote group per seller, so there is exactly ONE shipping row/price per
 * seller accessories group — never one per item.
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
  // New in the one-group-per-seller/class payload (backend lands in parallel).
  // Optional so an older server still renders — the component falls back to
  // mapping listingIds through the `sellerNames` prop.
  sellerId?: string;
  sellerUsername?: string | null;
  deliveryClass?: 'GOODS' | 'FIREARM';
  class?: 'GOODS' | 'FIREARM';
  shippingCents?: number;
  transactionId?: string;
}

export interface CartDeliveryGroupView {
  groupKey: string;
  listingIds: string[];
  consolidated: boolean;
  options: CartDeliveryOption[];
  unavailableReason?: string;
  /** Which seller this parcel ships from (display only; key is groupKey). */
  sellerId?: string;
  sellerName?: string;
  deliveryClass?: 'GOODS' | 'FIREARM';
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
    detail: rate.serviceName,
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
  sellerNames,
}: {
  lines: { listingId: string; quantity?: number }[];
  deliveryAddress: CartDeliveryAddress | null;
  chosen: Record<string, CartDeliveryOption>;
  onChoose: (groupKey: string, option: CartDeliveryOption) => void;
  /** Lets the cart know the group shape, so it can gate Continue on it. */
  onGroups: (groups: CartDeliveryGroupView[]) => void;
  getToken?: () => Promise<string | null>;
  /** listingId → seller display name, so each parcel can be named. */
  sellerNames?: Record<string, string>;
}) {
  const [groups, setGroups] = useState<CartDeliveryGroupView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest callbacks + the buyer's current picks, so the fetch (which must not
  // depend on the cart's per-render handlers) still reports into the current
  // ones and never resets a still-valid choice on a re-quote.
  const onChooseRef = useRef(onChoose);
  const onGroupsRef = useRef(onGroups);
  const chosenRef = useRef(chosen);
  onChooseRef.current = onChoose;
  onGroupsRef.current = onGroups;
  chosenRef.current = chosen;

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
      const view: CartDeliveryGroupView[] = (data as ApiGroup[]).map((g) => {
        // Seller name: prefer the server's own label, else map the group's
        // listings through the cart (the cart already knows each line's
        // seller). Display only — the server key stays authoritative.
        const sellerName =
          g.sellerUsername ??
          g.listingIds
            .map((id) => sellerNames?.[id])
            .find((name): name is string => Boolean(name)) ??
          undefined;
        return {
          groupKey: g.groupKey,
          listingIds: g.listingIds,
          consolidated: g.consolidated,
          options: toOptions(g),
          unavailableReason: g.unavailableReason,
          sellerId: g.sellerId,
          sellerName,
          deliveryClass: g.deliveryClass ?? g.class,
        };
      });
      setGroups(view);
      onGroupsRef.current(view);
      // Default each parcel group to its cheapest door option; the buyer can
      // then switch to fastest or one of the Store Pickup counters. A choice
      // that is STILL LEGAL for this re-quote is kept — a re-fetch caused by a
      // different seller's toggle must not quietly undo this seller's pick.
      for (const g of view) {
        if (g.unavailableReason || !g.options[0]) continue;
        const existing = chosenRef.current[g.groupKey];
        const stillValid =
          !!existing &&
          g.options.some(
            (option) =>
              option.kind === existing.kind &&
              (option.kind !== 'STORE_PICKUP' ||
                option.pickupPointLocationId ===
                  existing.pickupPointLocationId),
          );
        if (!stillValid) {
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
          background: 'var(--red-wash)',
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
          {/* ONE parcel per seller accessories group. Naming the seller here
              is what makes "one delivery charge per seller" legible in a
              multi-seller cart — the buyer sees whose parcel this price is. */}
          <p
            className="text-xs mb-2"
            style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
          >
            {g.sellerName ? `${g.sellerName} — ` : ''}
            {g.unavailableReason
              ? 'Delivery unavailable'
              : g.consolidated
                ? `these ${g.listingIds.length} items ship together as one parcel — one delivery charge.`
                : 'delivery for this item.'}
          </p>

          {g.unavailableReason ? (
            <div
              className="rounded-[8px] p-4 text-sm"
              style={{
                background: 'var(--warning-wash)',
                border: '0.5px solid var(--warning-wash)',
                color: 'var(--text-secondary)',
              }}
            >
              {g.unavailableReason}
            </div>
          ) : (
            g.options.map((o) => {
              const active = chosen[g.groupKey]?.kind === o.kind &&
                (o.kind !== 'STORE_PICKUP' || chosen[g.groupKey]?.pickupPointLocationId === o.pickupPointLocationId);
              const isPargo = o.kind === 'STORE_PICKUP';
              const distance = isPargo
                ? pargoDistanceLabel(o.pickupPointDistanceKm)
                : null;
              return (
                <button
                  key={`${o.kind}:${o.pickupPointLocationId ?? o.serviceCode}`}
                  type="button"
                  onClick={() => onChooseRef.current(g.groupKey, o)}
                  aria-pressed={active}
                  className="flex w-full items-center gap-3 rounded-[8px] p-3 text-left"
                  style={{
                    background: active
                      ? 'var(--action-option-selected-bg)'
                      : 'transparent',
                    border: `1.5px solid ${
                      active
                        ? 'var(--action-option-selected-edge)'
                        : 'var(--action-option-edge)'
                    }`,
                    color: active
                      ? 'var(--action-option-selected-ink)'
                      : 'var(--text-primary)',
                  }}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {isPargo ? pargoOptionLabel(o.detail) : o.label}
                    </span>
                    {isPargo ? (
                      <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {`Store pickup${distance ? ` · ${distance}` : ''}`}
                      </span>
                    ) : (
                      o.detail && <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>{o.detail}</span>
                    )}
                    {/* Directions + trading hours only once this counter is
                        the chosen one. */}
                    {isPargo && active && o.description && (
                      <span className="block text-xs mt-1" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                        {o.description}
                      </span>
                    )}
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

/**
 * ONE TOGGLE PER SELLER + DELIVERY CLASS.
 *
 * The approved cart shape (operator 2026-11-27): the buyer never sees a
 * per-item delivery choice. An accessories group toggles Courier / Private; a
 * firearm group toggles Dealer Stock / Private; a seller with both gets two
 * independent toggles because the two classes have different legal rails.
 *
 * It renders a plain labelled state when the group has only one legal method
 * (a collection-only line is Private only) — a two-sided toggle that cannot
 * move is a lie, and disabled buttons invite the buyer to try.
 */
export function CartDeliveryToggle({
  group,
  onChange,
}: {
  group: Pick<
    CartClassGroup,
    'key' | 'sellerName' | 'deliveryClass' | 'options' | 'method'
  >;
  onChange: (groupKey: string, method: string) => void;
}) {
  const label =
    group.deliveryClass === 'FIREARM'
      ? `Transfer method for ${group.sellerName}'s firearms`
      : `Delivery method for ${group.sellerName}'s accessories`;
  const selected =
    group.options.find((option) => option.method === group.method) ??
    group.options[0];
  if (!selected) return null;

  if (group.options.length <= 1) {
    return (
      <span
        role="group"
        aria-label={label}
        className="text-[11px] px-2 py-1 rounded-[6px]"
        style={{
          background: 'var(--action-option-selected-bg)',
          color: 'var(--action-option-selected-ink)',
          border: '1.5px solid var(--action-option-selected-edge)',
          fontWeight: 500,
        }}
      >
        {selected.label}
      </span>
    );
  }

  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {group.options.map((option) => {
        const active = option.method === group.method;
        return (
          <button
            key={option.method}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(group.key, option.method)}
            className="px-2.5 py-1 rounded-[6px] text-xs"
            style={{
              background: active
                ? 'var(--action-option-selected-bg)'
                : 'transparent',
              color: active
                ? 'var(--action-option-selected-ink)'
                : 'var(--text-primary)',
              border: `1.5px solid ${
                active
                  ? 'var(--action-option-selected-edge)'
                  : 'var(--action-option-edge)'
              }`,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
