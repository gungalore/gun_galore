'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useCart, removeFromCart, clearCart } from '@/lib/cart-store';
import { formatPrice } from '@/lib/utils';
import { ManualEftInstructions, type ManualEftData } from '@/components/manual-eft-instructions';
import { PaygateComingSoon } from '@/components/paygate-coming-soon';
import { LockerPicker, type PudoLocker } from '@/components/locker-picker';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
import {
  FirearmAttestation,
  DealerTransferConsent,
  PrivateArrangeConsent,
} from '@/components/firearm-consents';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface OrderCheckoutResponse extends ManualEftData {
  orderId: string;
  manual: boolean;
  itemCount: number;
  breakdown?: { listingPrice: number; shippingCost: number; buyerTotal: number };
}

type ShipMethod = 'PUDO' | 'TCG';
type FirearmRoute = 'DEALER_TRANSFER' | 'PRIVATE_ARRANGE';

// Per-firearm state — route + the two required confirmations, keyed by
// listingId. Both attestation and the route's consent must be accepted
// before the firearm is checkout-ready.
interface FirearmState {
  route: FirearmRoute;
  attestationAccepted: boolean;
  consentAccepted: boolean;
}

export default function CartPage() {
  const items = useCart();
  const { getToken } = useAuth();

  const [method, setMethod] = useState<ShipMethod>('PUDO');
  const [locker, setLocker] = useState<PudoLocker | null>(null);
  const [addr, setAddr] = useState<ManualAddressValue>(emptyManualAddress);
  // Per-firearm route + consent state, keyed by listingId.
  const [firearmState, setFirearmState] = useState<Record<string, FirearmState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OrderCheckoutResponse | null>(null);

  const itemsSubtotal = items.reduce((s, i) => s + i.price, 0);

  // Split shippable (courier) items from firearms — firearms branch to a
  // dealer-transfer / in-person route and never touch the courier picker.
  // Collection-only lines (trailers / oversized goods / >100Wh lithium) can't
  // ride the cart rail at all — the backend rejects a courier method for them
  // and there's no cart collection route. The listing page now suppresses
  // Add-to-cart for these, but a stale localStorage cart written before that
  // fix may still carry one, so belt-and-braces here: surface + block them by
  // name rather than letting the whole basket hard-fail with an unnamed error.
  const collectionItems = items.filter(
    (i) => !i.isFirearm && i.shippingMethods?.includes('COLLECTION'),
  );
  const shippableItems = items.filter(
    (i) => !i.isFirearm && !i.shippingMethods?.includes('COLLECTION'),
  );
  const firearmItems = items.filter((i) => i.isFirearm);

  // The per-firearm state for a listing, defaulting to DEALER_TRANSFER with
  // nothing accepted yet. Kept as a pure read so render + the checkout gate
  // agree without mutating state during render.
  const stateFor = (listingId: string): FirearmState =>
    firearmState[listingId] ?? {
      route: 'DEALER_TRANSFER',
      attestationAccepted: false,
      consentAccepted: false,
    };

  const setFirearm = (listingId: string, patch: Partial<FirearmState>) =>
    setFirearmState((prev) => {
      const cur = prev[listingId] ?? {
        route: 'DEALER_TRANSFER' as FirearmRoute,
        attestationAccepted: false,
        consentAccepted: false,
      };
      return { ...prev, [listingId]: { ...cur, ...patch } };
    });

  // Group lines by seller (Phase 8d — a cart can mix sellers). One payment
  // covers all; each seller ships + is paid independently.
  const groups = Array.from(
    items
      .reduce((m, i) => {
        const g = m.get(i.sellerId) ?? { username: i.sellerUsername, items: [] as typeof items };
        g.items.push(i);
        m.set(i.sellerId, g);
        return m;
      }, new Map<string, { username: string; items: typeof items }>())
      .values(),
  );

  const addrComplete =
    addr.street.trim() &&
    addr.suburb.trim() &&
    addr.city.trim() &&
    addr.province &&
    addr.postalCode.trim().length >= 4;
  // Courier shipping only needs to be ready when there ARE shippable items.
  const courierReady =
    shippableItems.length === 0 ||
    (method === 'PUDO' ? Boolean(locker) : Boolean(addrComplete));

  // Every firearm must have a chosen route, its 18+ attestation, and the
  // consent for the chosen route accepted.
  const firearmsReady = firearmItems.every((i) => {
    const s = stateFor(i.listingId);
    return s.route && s.attestationAccepted && s.consentAccepted;
  });

  const shippingReady =
    courierReady && firearmsReady && collectionItems.length === 0;

  async function checkout() {
    if (!shippingReady || items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const lines = items.map((i) => {
        if (i.isFirearm) {
          const s = stateFor(i.listingId);
          return {
            listingId: i.listingId,
            shippingMethod: s.route,
            firearmAttestation18Plus: true,
            ...(s.route === 'PRIVATE_ARRANGE'
              ? { privateArrangeConsent: true }
              : {}),
          };
        }
        return {
          listingId: i.listingId,
          shippingMethod: method,
          ...(method === 'PUDO'
            ? { pudoPickupLockerId: locker?.lockerId }
            : {
                deliveryAddress: {
                  building: addr.building.trim() || undefined,
                  streetAddress: addr.street.trim(),
                  address2: addr.address2.trim() || undefined,
                  suburb: addr.suburb.trim(),
                  city: addr.city.trim(),
                  province: addr.province,
                  postalCode: addr.postalCode.trim(),
                },
              }),
        };
      });
      const res = await fetch(`${API_URL}/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (!res.ok || !data?.manual) {
        setError(
          data?.message ||
            'Checkout failed. An item may no longer be available — refresh and try again.',
        );
        return;
      }
      setDone(data as OrderCheckoutResponse);
      clearCart();
    } catch {
      setError('Something went wrong reaching checkout. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success → the shared EFT banking screen, linked to the order ──
  if (done) {
    return (
      <main className="max-w-xl mx-auto px-4 py-8">
        <ManualEftInstructions
          data={done}
          viewHref={`/orders/${done.orderId}`}
          viewLabel="View my order"
        />
      </main>
    );
  }

  // ── Empty cart ──
  if (items.length === 0) {
    return (
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          Your cart is empty
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Add buy-now items to your cart and check out in one payment. Items ship per seller.
        </p>
        <Link
          href="/"
          className="inline-block text-sm px-5 py-2.5 rounded-[6px]"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
        >
          Browse the marketplace
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Your cart
      </h1>
      <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
        {groups.length === 1 ? (
          <>All from <strong>{groups[0].username}</strong>. </>
        ) : (
          <>From <strong>{groups.length} sellers</strong> — each ships and is paid
          separately. </>
        )}
        One payment. Courier items ship via Pudo or The Courier Guy (quoted at
        payment, R15 handling per parcel).
        {firearmItems.length > 0 && (
          <> Firearms route through a licensed dealer or in person — confirm each
          firearm&apos;s details below before you can continue.</>
        )}
      </p>

      {/* Items — grouped by seller (Phase 8d) */}
      {groups.map((g) => {
        // P6.2 — 2+ courier (non-firearm) items from ONE seller ship as a SINGLE
        // parcel (one waybill, one handling fee). The cart sends all courier
        // lines to the same method + destination, so any such group consolidates
        // at checkout. Flag it here so the buyer knows the per-parcel handling
        // fee is charged once, not once per item.
        const shippableInGroup = g.items.filter((i) => !i.isFirearm).length;
        return (
        <div
          key={g.username}
          className="rounded-[8px] mb-4 overflow-hidden"
          style={{ border: '0.5px solid var(--border)' }}
        >
          {groups.length > 1 && (
            <div
              className="px-3 py-2 text-xs"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', fontWeight: 500 }}
            >
              {g.username}
            </div>
          )}
          {g.items.map((i) => (
            <div
              key={i.listingId}
              className="flex items-center gap-3 p-3"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.imageUrl ? (
                <img
                  src={i.imageUrl}
                  alt={i.title}
                  className="w-12 h-12 rounded-[6px] object-cover"
                  style={{ background: 'var(--bg-inset)' }}
                />
              ) : (
                <div className="w-12 h-12 rounded-[6px]" style={{ background: 'var(--bg-inset)' }} />
              )}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/listings/${i.listingId}`}
                  className="block text-sm truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {i.title}
                </Link>
                {i.isFirearm && (
                  <span
                    className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-[4px] uppercase"
                    style={{
                      background: 'rgba(200,16,46,0.08)',
                      border: '0.5px solid var(--red)',
                      color: 'var(--red)',
                      letterSpacing: '0.03em',
                      fontWeight: 600,
                    }}
                  >
                    Firearm — dealer / in-person
                  </span>
                )}
              </div>
              <span className="text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(i.price)}
              </span>
              <button
                type="button"
                onClick={() => removeFromCart(i.listingId)}
                aria-label={`Remove ${i.title}`}
                className="text-xs px-2 py-1 rounded-[4px]"
                style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
              >
                Remove
              </button>
            </div>
          ))}
          {shippableInGroup >= 2 && (
            <div
              className="px-3 py-2 text-xs flex items-center gap-1.5"
              style={{
                borderTop: '0.5px solid var(--border)',
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                lineHeight: 1.4,
              }}
            >
              <span aria-hidden>📦</span>
              These {shippableInGroup} items ship together as one parcel — you
              only pay one handling fee.
            </div>
          )}
        </div>
        );
      })}

      {/* Collection-only lines can't check out from the cart — name each one
          and point the buyer at its own Buy Now checkout. Blocks Continue via
          shippingReady above until they're removed. */}
      {collectionItems.map((i) => (
        <div
          key={i.listingId}
          className="rounded-[8px] mb-4 p-3"
          style={{ border: '0.5px solid var(--red)', background: 'rgba(200,16,46,0.06)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {i.title}
          </p>
          <p className="text-xs mt-1 mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            This item is collection only — it can&apos;t be bought in a cart.
            Buy it on its own to arrange collection with the seller.
          </p>
          <div className="flex gap-2">
            <Link
              href={`/checkout/${i.listingId}`}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Buy this item on its own
            </Link>
            <button
              type="button"
              onClick={() => removeFromCart(i.listingId)}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
            >
              Remove from cart
            </button>
          </div>
        </div>
      ))}

      {/* Delivery — courier picker only when there ARE shippable (non-firearm)
          items. A firearm-only cart hides this entirely. */}
      {shippableItems.length > 0 && (
        <>
          <h2 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Delivery
          </h2>
          <div className="flex gap-2 mb-3">
            {(['PUDO', 'TCG'] as ShipMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className="flex-1 py-2.5 rounded-[6px] text-sm"
                style={{
                  background: method === m ? 'var(--red)' : 'var(--bg-card)',
                  color: method === m ? '#fff' : 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  fontWeight: 500,
                }}
              >
                {m === 'PUDO' ? 'Pudo locker (cheapest)' : 'Courier to my door'}
              </button>
            ))}
          </div>

          <div className="mb-5">
            {method === 'PUDO' ? (
              <LockerPicker selectedId={locker?.lockerId} onSelect={setLocker} />
            ) : (
              <ManualAddressFields value={addr} onChange={setAddr} idPrefix="cart" />
            )}
          </div>
        </>
      )}

      {/* Firearms — one route + consent block per firearm line */}
      {firearmItems.length > 0 && (
        <>
          <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Firearms
          </h2>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Firearms don&apos;t ship by courier. Choose a route and confirm the
            required details for each one.
          </p>
          {firearmItems.map((i) => {
            const s = stateFor(i.listingId);
            const offersPrivate = i.shippingMethods.includes('PRIVATE_ARRANGE');
            return (
              <div
                key={i.listingId}
                className="rounded-[8px] mb-4 p-3 space-y-3"
                style={{ border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}
              >
                <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {i.title}
                </p>

                {/* Route toggle — DEALER_TRANSFER always; PRIVATE_ARRANGE only
                    if the seller offered it. */}
                <div className="flex gap-2">
                  {(['DEALER_TRANSFER', ...(offersPrivate ? ['PRIVATE_ARRANGE'] : [])] as FirearmRoute[]).map(
                    (route) => (
                      <button
                        key={route}
                        type="button"
                        onClick={() =>
                          // Switching route clears the previous route's consent —
                          // each route has its own gate.
                          setFirearm(i.listingId, { route, consentAccepted: false })
                        }
                        className="flex-1 py-2.5 rounded-[6px] text-xs"
                        style={{
                          background: s.route === route ? 'var(--red)' : 'var(--bg-inset)',
                          color: s.route === route ? '#fff' : 'var(--text-secondary)',
                          border: '0.5px solid var(--border)',
                          fontWeight: 500,
                          lineHeight: 1.4,
                        }}
                      >
                        {route === 'DEALER_TRANSFER'
                          ? 'Dealer transfer — funds held until verified'
                          : 'Arrange in person — released immediately'}
                      </button>
                    ),
                  )}
                </div>

                {/* 18+/competency attestation — required for every firearm. */}
                <FirearmAttestation
                  accepted={s.attestationAccepted}
                  onChange={(v) => setFirearm(i.listingId, { attestationAccepted: v })}
                />

                {/* Route-specific consent. */}
                {s.route === 'DEALER_TRANSFER' ? (
                  <DealerTransferConsent
                    accepted={s.consentAccepted}
                    onChange={(v) => setFirearm(i.listingId, { consentAccepted: v })}
                  />
                ) : (
                  <PrivateArrangeConsent
                    accepted={s.consentAccepted}
                    onChange={(v) => setFirearm(i.listingId, { consentAccepted: v })}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Payment method — paygate placeholder + EFT (the live method) */}
      <PaygateComingSoon />

      {/* Totals */}
      <div
        className="rounded-[8px] p-4 mb-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Items ({items.length})</span>
          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatPrice(itemsSubtotal)}
          </span>
        </div>
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Shipping</span>
          <span style={{ color: 'var(--text-tertiary)' }}>Quoted at payment</span>
        </div>
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Handling — R15 per parcel</span>
          <span style={{ color: 'var(--text-tertiary)' }}>Quoted at payment</span>
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          A R15 handling fee applies to each courier parcel. Firearms shipped via
          a dealer or in person have no courier fee.
        </p>
      </div>

      {error && (
        <p className="text-sm mb-3" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!shippingReady || submitting}
        onClick={checkout}
        className="block w-full py-3 rounded-[6px] text-sm text-center"
        style={{
          background: !shippingReady || submitting ? 'var(--bg-inset)' : 'var(--red)',
          color: !shippingReady || submitting ? 'var(--text-tertiary)' : '#fff',
          fontWeight: 500,
          cursor: !shippingReady || submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting
          ? 'Creating your order…'
          : shippingReady
            ? 'Continue to payment'
            : !firearmsReady
              ? 'Confirm the firearm details to continue'
              : method === 'PUDO'
                ? 'Pick a locker to continue'
                : 'Enter a delivery address to continue'}
      </button>
      <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-tertiary)' }}>
        You&apos;ll pay by EFT on the next screen. Your money is held until you
        confirm delivery.
      </p>
    </main>
  );
}
