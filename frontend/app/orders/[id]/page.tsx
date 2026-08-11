'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { formatPrice } from '@/lib/utils';
import { SHIPPING_STATUS, resolveStatus } from '@/lib/status-labels';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface OrderLine {
  id: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  listing: { id: string; title: string; images: { url: string }[] };
  transaction: {
    id: string;
    paymentStatus: string;
    shippingStatus: string | null;
    shippingMethod: string | null;
    buyerTotal: number;
  } | null;
}

interface OrderDetail {
  id: string;
  status: string;
  orderReference: string | null;
  itemsSubtotal: number;
  shippingSubtotal: number;
  // P6.4 — per-waybill handling, billed apart from shipping. The backend
  // GET /orders/:id spreads the whole Order row, so this is always present.
  handlingSubtotal: number;
  processingFee: number;
  buyerTotal: number;
  paidAt: string | null;
  manualPayByAt: string | null;
  createdAt: string;
  lineItems: OrderLine[];
}

const ORDER_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  AWAITING_PAYMENT: { label: 'Awaiting payment', tone: 'var(--warning, #f59e0b)' },
  PAID: { label: 'Paid', tone: 'var(--green, #16a34a)' },
  PARTIALLY_FULFILLED: { label: 'Partially fulfilled', tone: 'var(--warning, #f59e0b)' },
  COMPLETED: { label: 'Completed', tone: 'var(--green, #16a34a)' },
  CANCELLED: { label: 'Cancelled', tone: 'var(--text-tertiary)' },
  REFUNDED: { label: 'Refunded', tone: 'var(--text-tertiary)' },
};

export default function OrderDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const { getToken } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/orders/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        if (alive) {
          setOrder(data);
          setState('ready');
        }
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, getToken]);

  if (state === 'loading') {
    return (
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading your order…</p>
      </main>
    );
  }
  if (state === 'error' || !order) {
    return (
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Order not found</h1>
        <Link href="/my/orders" className="text-sm" style={{ color: 'var(--red)' }}>
          Back to my orders
        </Link>
      </main>
    );
  }

  const st = ORDER_STATUS_LABEL[order.status] ?? { label: order.status, tone: 'var(--text-tertiary)' };

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      <Link href="/my/orders" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        ← My orders
      </Link>
      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Order {order.orderReference ?? order.id.slice(-8).toUpperCase()}
        </h1>
        <span
          className="text-xs px-2.5 py-1 rounded-full"
          style={{ background: 'var(--bg-card)', border: `0.5px solid ${st.tone}`, color: st.tone, fontWeight: 500 }}
        >
          {st.label}
        </span>
      </div>
      <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
        {order.lineItems.length} item{order.lineItems.length === 1 ? '' : 's'}
      </p>

      {/* Line items — each links into its own transaction (dispatch/tracking) */}
      <div className="rounded-[8px] mb-5 overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
        {order.lineItems.map((li) => (
          <Link
            key={li.id}
            href={li.transaction ? `/transactions/${li.transaction.id}` : `/listings/${li.listing.id}`}
            className="flex items-center gap-3 p-3"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {li.listing.images?.[0]?.url ? (
              <img src={li.listing.images[0].url} alt={li.listing.title} className="w-12 h-12 rounded-[6px] object-cover" style={{ background: 'var(--bg-inset)' }} />
            ) : (
              <div className="w-12 h-12 rounded-[6px]" style={{ background: 'var(--bg-inset)' }} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{li.listing.title}</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {li.quantity > 1 ? `${li.quantity} × ${formatPrice(li.unitPrice)}` : formatPrice(li.unitPrice)}
                {/* Firearm lines route via a dealer / in person (no courier
                    tracking); courier lines show their shipping status. */}
                {li.transaction?.shippingMethod === 'DEALER_TRANSFER'
                  ? ' · Ships via a dealer'
                  : li.transaction?.shippingMethod === 'PRIVATE_ARRANGE'
                    ? ' · Arranged in person'
                    : li.transaction?.shippingStatus
                      ? /* Never print the raw enum here — "OUT_FOR_DELIVERY"
                           is dev language. The shared table is the same one
                           /my/orders + /my/sales render from, so a line item
                           reads identically wherever the buyer sees it. */
                        ` · ${resolveStatus(SHIPPING_STATUS, li.transaction.shippingStatus).label}`
                      : ''}
              </p>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>›</span>
          </Link>
        ))}
      </div>

      {/* Totals */}
      <div className="rounded-[8px] p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Items</span>
          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(order.itemsSubtotal)}</span>
        </div>
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Shipping</span>
          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(order.shippingSubtotal)}</span>
        </div>
        {order.handlingSubtotal > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span style={{ color: 'var(--text-tertiary)' }}>Handling</span>
            <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(order.handlingSubtotal)}</span>
          </div>
        )}
        {/* Processing fee is only a BUYER line when the seller passes it on
            (it's per-transaction passFeeToBuyer, which the order rollup
            doesn't expose). Deriving it as the leftover of buyerTotal keeps
            the column honest either way: it equals the passed-through fee
            when the buyer pays it and 0 when the seller absorbs it — so
            Items + Shipping + Handling + this always foots to Total, which
            is the whole point of showing it on a money screen. */}
        {order.buyerTotal - order.itemsSubtotal - order.shippingSubtotal - order.handlingSubtotal > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span style={{ color: 'var(--text-tertiary)' }}>Processing fee</span>
            <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatPrice(
                order.buyerTotal -
                  order.itemsSubtotal -
                  order.shippingSubtotal -
                  order.handlingSubtotal,
              )}
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm py-2 mt-1" style={{ borderTop: '0.5px solid var(--border)' }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Total</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(order.buyerTotal)}</span>
        </div>
      </div>
    </main>
  );
}
