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

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface OrderCheckoutResponse extends ManualEftData {
  orderId: string;
  manual: boolean;
  itemCount: number;
  breakdown?: { listingPrice: number; shippingCost: number; buyerTotal: number };
}

type ShipMethod = 'PUDO' | 'TCG';

export default function CartPage() {
  const items = useCart();
  const { getToken } = useAuth();

  const [method, setMethod] = useState<ShipMethod>('PUDO');
  const [locker, setLocker] = useState<PudoLocker | null>(null);
  const [addr, setAddr] = useState<ManualAddressValue>(emptyManualAddress);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OrderCheckoutResponse | null>(null);

  const itemsSubtotal = items.reduce((s, i) => s + i.price, 0);

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
  const shippingReady = method === 'PUDO' ? Boolean(locker) : Boolean(addrComplete);

  async function checkout() {
    if (!shippingReady || items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const lines = items.map((i) => ({
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
      }));
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
          Add buy-now items from the same seller to check out together in one payment.
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
        One payment, one delivery choice. Shipping is quoted per item and added to
        your total.
      </p>

      {/* Items — grouped by seller (Phase 8d) */}
      {groups.map((g) => (
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
              <Link
                href={`/listings/${i.listingId}`}
                className="flex-1 text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                {i.title}
              </Link>
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
        </div>
      ))}

      {/* Delivery */}
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
