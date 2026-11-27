'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '@/lib/utils';
import { SHIPPING_STATUS, resolveStatus } from '@/lib/status-labels';
import {
  orderItemsForSeller,
  orderSellerRowMode,
  showsSellerRatingSection,
  visibleOrderSellers,
  type OrderSellerEntry,
  type OrderSellerRating,
} from '@/lib/order-seller-ratings';
import { RatingWidget } from '../../transactions/[id]/rating-widget';

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
  // Legacy delivery handling margin. 0 for sales after 2026-10-23; kept
  // because the backend Order row still carries it. The UI folds shipping and
  // this into ONE Delivery figure.
  handlingSubtotal: number;
  processingFee: number;
  buyerTotal: number;
  paidAt: string | null;
  manualPayByAt: string | null;
  createdAt: string;
  lineItems: OrderLine[];
  /**
   * One entry per seller in this order, with the rating that belongs to them.
   *
   * ⚠️ ABSENT UNTIL THE BACKEND IS LIVE, and absent on single-seller checkouts
   * that predate the field — the section simply does not render.
   */
  sellers?: OrderSellerEntry[];
}

/** A saved rating, read-only: stars, comment and the seller's reply. */
function SellerRatingSummary({ rating }: { rating: OrderSellerRating }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--warning)', fontSize: 14 }}>
          {'★'.repeat(rating.stars)}
          {'☆'.repeat(5 - rating.stars)}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Rating saved
        </span>
      </div>
      {rating.comment ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {rating.comment}
        </p>
      ) : null}
      {rating.sellerResponse ? (
        <div
          className="mt-2 pl-3 py-1.5"
          style={{ borderLeft: '2px solid var(--border)' }}
        >
          <p
            className="text-[11px] mb-0.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Seller&apos;s reply
          </p>
          <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
            {rating.sellerResponse}
          </p>
        </div>
      ) : null}
    </div>
  );
}

const ORDER_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  AWAITING_PAYMENT: { label: 'Awaiting payment', tone: 'var(--warning, #f59e0b)' },
  PAID: { label: 'Paid', tone: 'var(--success)' },
  PARTIALLY_FULFILLED: { label: 'Partially fulfilled', tone: 'var(--warning, #f59e0b)' },
  COMPLETED: { label: 'Completed', tone: 'var(--success)' },
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

      {/*
        ⚠️ ONE RATING PER SELLER PER ORDER. A cart can hold items from several
        sellers; the backend accepts one rating per seller per order, so this is
        the only place it is offered. The transaction page links back here instead
        of showing a second, per-line widget.
      */}
      {showsSellerRatingSection(order.sellers) ? (
        <div
          className="rounded-[8px] p-4 mb-5"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p
            className="text-sm font-medium mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Rate your sellers
          </p>
          <div className="space-y-4">
            {visibleOrderSellers(order.sellers).map((seller) => {
              const mode = orderSellerRowMode(seller);
              const items = orderItemsForSeller(order.lineItems, seller);
              return (
                <div
                  key={seller.sellerId}
                  style={{ borderTop: '0.5px solid var(--border-divider)' }}
                  className="pt-4 first:border-t-0 first:pt-0"
                >
                  <p
                    className="text-sm m-0"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {seller.username ?? 'Anonymous seller'}
                  </p>
                  {items.length ? (
                    <p
                      className="text-xs mt-0.5 mb-2"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {items.map((line) => line.listing.title).join(' · ')}
                    </p>
                  ) : (
                    <div className="mb-2" />
                  )}

                  {mode === 'rate' && seller.transactionId ? (
                    <RatingWidget transactionId={seller.transactionId} />
                  ) : null}

                  {mode === 'saved' && seller.rating ? (
                    <SellerRatingSummary rating={seller.rating} />
                  ) : null}

                  {mode === 'waiting' ? (
                    <p
                      className="text-xs m-0"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      You can rate this seller once every item from them is
                      delivered.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Totals */}
      <div className="rounded-[8px] p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Items</span>
          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(order.itemsSubtotal)}</span>
        </div>
        {/* ONE DELIVERY FIGURE. Delivery is the courier's live rate with no
            handling margin since 2026-10-23. The legacy handlingSubtotal is
            folded in for old orders; it stays server-side because it is a
            separate payout obligation on historical rows. */}
        {order.shippingSubtotal + order.handlingSubtotal > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span style={{ color: 'var(--text-tertiary)' }}>Delivery</span>
            <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(order.shippingSubtotal + order.handlingSubtotal)}</span>
          </div>
        )}
        {/* The Platform Fee is a BUYER line on every order (operator 2026-10).
            Deriving it as the leftover of buyerTotal keeps the column honest:
            Items + Delivery + this always foots to Total. */}
        {order.buyerTotal - order.itemsSubtotal - order.shippingSubtotal - order.handlingSubtotal > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span style={{ color: 'var(--text-tertiary)' }}>Platform Fee</span>
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
