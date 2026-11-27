'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '@/lib/utils';
import { toneColor } from '@/lib/status-labels';
import {
  orderItemsForSeller,
  orderSellerRowMode,
  showsSellerRatingSection,
  visibleOrderSellers,
  type OrderSellerEntry,
  type OrderSellerRating,
} from '@/lib/order-seller-ratings';
import {
  cartItemsFromOrder,
  orderItemCount,
  orderLineDeliveryClass,
  orderLineDeliveryText,
  orderLineListingId,
  orderReference,
  orderSellerGroups,
  orderShippingRows,
  orderTotals,
  type OrderDetail,
  type OrderLineItem,
} from '@/lib/order-page';
import {
  orderCanCancel,
  orderCanRemoveLines,
  orderCanResumePayment,
  orderStatusEntry,
} from '@/lib/order-status';
import {
  clearPendingOrder,
  getPendingOrder,
  setPendingOrder,
  syncPendingOrderListingIds,
} from '@/lib/pending-order';
import { removeOrderLine } from '@/lib/order-removal';
import { useCart, removeFromCart, replaceCartItems } from '@/lib/cart-store';
import { RatingWidget } from '../../transactions/[id]/rating-widget';
import ItemDistance from '@/components/item-distance';
import { DistanceProvider } from '@/lib/distance-context';
import { PageReveal } from '@/components/page-reveal';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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
          <p className="text-[11px] mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
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

/** One order line: title, delivery class/method, unit maths. */
function OrderLineRow({
  line,
  canRemove,
  removing,
  onRemove,
}: {
  line: OrderLineItem;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const units = Math.max(1, line.quantity ?? 1);
  const transactionId = line.transaction?.id;
  const href = transactionId
    ? `/transactions/${transactionId}`
    : `/listings/${orderLineListingId(line)}`;
  return (
    <div
      className="flex items-center gap-3 p-3"
      style={{ borderTop: '0.5px solid var(--border)' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {line.listing?.images?.[0]?.url ? (
        <img
          src={line.listing.images[0].url}
          alt={line.listing.title}
          className="w-12 h-12 rounded-[6px] object-cover"
          style={{ background: 'var(--bg-inset)' }}
        />
      ) : (
        <div className="w-12 h-12 rounded-[6px]" style={{ background: 'var(--bg-inset)' }} />
      )}
      <div className="flex-1 min-w-0">
        <Link
          href={href}
          className="block text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {line.listing?.title ?? 'Item'}
        </Link>
        <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {orderLineDeliveryText(line)}
          {' · '}
          {units > 1 ? `${units} × ${formatPrice(line.unitPrice)}` : formatPrice(line.unitPrice)}
        </p>
        <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          <ItemDistance listingId={orderLineListingId(line)} />
        </span>
      </div>
      <span className="text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {formatPrice(line.lineSubtotal ?? line.unitPrice * units)}
      </span>
      {canRemove && transactionId ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-busy={removing}
          aria-label={`Remove ${line.listing?.title ?? 'item'} from this order`}
          className="text-xs px-2 py-1 rounded-[4px] flex-shrink-0"
          style={{
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
            opacity: removing ? 0.5 : 1,
            cursor: removing ? 'wait' : 'pointer',
          }}
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      ) : (
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          ›
        </span>
      )}
    </div>
  );
}

export default function OrderDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const { getToken } = useAuth();
  // Cart lines are re-written when the backend trims the order after a
  // removal — the cart is localStorage-only and must not keep a bought line.
  const cart = useCart();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOrder = useCallback(async (): Promise<OrderDetail | null> => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/orders/${encodeURIComponent(id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('not found');
      const data = (await res.json()) as OrderDetail;
      setOrder(data);
      setState('ready');
      return data;
    } catch {
      setState('error');
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const data = await loadOrder();
      if (!data) return;
      // Keep the unpaid-order marker truthful: a paid/cancelled order is no
      // longer a pending cart checkout.
      const marker = getPendingOrder();
      if (marker?.orderId === data.id) {
        if (data.status === 'AWAITING_PAYMENT') {
          syncPendingOrderListingIds(
            (data.lineItems ?? [])
              .map((line) => orderLineListingId(line))
              .filter(Boolean),
          );
        } else {
          clearPendingOrder();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadOrder]);

  async function authedRequest(path: string, init: RequestInit = {}) {
    const token = await getToken();
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
  }

  /** Restart the ONE order payment (a fresh gateway session for the total). */
  async function resumePayment() {
    if (!order || busy) return;
    setBusy('resume');
    setActionError(null);
    try {
      const res = await authedRequest(
        `/orders/${encodeURIComponent(order.id)}/resume`,
        { method: 'POST' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string;
        paid?: boolean;
        cancelled?: boolean;
        message?: string | string[];
      };
      if (!res.ok) {
        const message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message;
        throw new Error(message || 'Could not resume this payment.');
      }
      if (data.paid) {
        clearPendingOrder();
        await loadOrder();
        return;
      }
      if (data.cancelled) {
        clearPendingOrder();
        await loadOrder();
        return;
      }
      if (data.redirectUrl) {
        setPendingOrder({
          orderId: order.id,
          listingIds: (order.lineItems ?? [])
            .map((line) => orderLineListingId(line))
            .filter(Boolean),
        });
        window.location.href = data.redirectUrl;
        return;
      }
      throw new Error('The payment gateway did not return a payment link.');
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'Could not resume this payment.',
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Cancel the whole unpaid order. Every reserved line is released; the buyer
   * can then re-checkout from the cart.
   */
  async function cancelOrder() {
    if (!order || busy) return;
    setBusy('cancel');
    setActionError(null);
    try {
      const res = await authedRequest(
        `/orders/${encodeURIComponent(order.id)}/cancel`,
        { method: 'POST' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      if (!res.ok) {
        const message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message;
        throw new Error(message || 'Could not cancel this order.');
      }
      if (getPendingOrder()?.orderId === order.id) clearPendingOrder();
      setNotice(
        'Order cancelled. The items were released and are still in your cart.',
      );
      await loadOrder();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'Could not cancel this order.',
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Remove ONE line from an unpaid order.
   *
   * The backend re-prices the remaining lines (delivery per seller group, ONE
   * Platform Fee) and returns the updated order plus a NEW payment session for
   * the new total. If it was the last line the order is cancelled and the cart
   * is emptied; otherwise the cart is synced to the returned order and the
   * buyer continues in the new session.
   */
  async function removeLine(line: OrderLineItem) {
    if (!order || busy) return;
    const transactionId = line.transaction?.id;
    if (!transactionId) return;
    setBusy(`remove:${transactionId}`);
    setActionError(null);
    try {
      const outcome = await removeOrderLine({
        orderId: order.id,
        transactionId,
        request: (path, init) => authedRequest(path, init),
      });
      if (outcome.kind === 'paid') {
        // Already paid — removal is no longer allowed. Refresh to the truth.
        setNotice(
          outcome.message ||
            'This order has been paid, so items can no longer be removed.',
        );
        await loadOrder();
        return;
      }
      if (outcome.kind === 'error') {
        throw new Error(outcome.message);
      }
      if (outcome.kind === 'cancelled') {
        // Last line removed → the order is cancelled and the cart empties.
        clearPendingOrder();
        for (const cartLine of cart) removeFromCart(cartLine.listingId);
        await loadOrder();
        setNotice('The last item was removed, so this order was cancelled.');
        return;
      }
      const updated = outcome.order;
      setOrder(updated);
      // Sync the cart to the server's remaining lines (the cart may still
      // hold the removed one).
      const nextItems = cartItemsFromOrder(updated, cart);
      replaceCartItems(nextItems);
      setPendingOrder({
        orderId: updated.id,
        listingIds: nextItems.map((item) => item.listingId),
      });
      if (outcome.redirectUrl) {
        window.location.href = outcome.redirectUrl;
        return;
      }
      setNotice(
        'Item removed. Review the updated order and resume payment to finish.',
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'Could not remove that item.',
      );
    } finally {
      setBusy(null);
    }
  }

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

  const st = orderStatusEntry(order.status);
  const statusColor = toneColor(st.tone);
  const sellerGroups = orderSellerGroups(order);
  const shippingRows = orderShippingRows(order);
  const totals = orderTotals(order);
  const itemCount = orderItemCount(order);
  const canRemove = orderCanRemoveLines(order);
  const canResume = orderCanResumePayment(order);
  const canCancel = orderCanCancel(order);
  const unpaid = order.status === 'AWAITING_PAYMENT';
  const sellerCount = sellerGroups.length;
  // Legacy fallback rows have no seller; they are shown after the seller blocks.
  const sellerlessRows = shippingRows.filter((row) => !row.sellerId);

  return (
    <DistanceProvider
      ids={(order.lineItems ?? [])
        .map((line) => orderLineListingId(line))
        .filter(Boolean)}
    >
      <main className="max-w-xl mx-auto px-4 py-8">
        <PageReveal variant="slide-up">
          <Link href="/my/orders" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            ← My orders
          </Link>
          <div className="flex items-center justify-between mt-2 mb-1 gap-2">
            <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              Order {orderReference(order)}
            </h1>
            <span
              className="text-xs px-2.5 py-1 rounded-full flex-shrink-0"
              title={st.hint}
              style={{ background: 'var(--bg-card)', border: `0.5px solid ${statusColor}`, color: statusColor, fontWeight: 500 }}
            >
              {st.label}
            </span>
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
            {sellerCount > 1 ? ` from ${sellerCount} sellers` : ''}
            {' · '}
            one payment for the whole order
            {order.paidAt
              ? ` · paid ${new Date(order.paidAt).toLocaleDateString('en-ZA')}`
              : ''}
          </p>

          {notice && (
            <p
              className="text-xs rounded-[8px] p-3 mb-4"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
            >
              {notice}
            </p>
          )}
          {actionError && (
            <p className="text-xs mb-4" style={{ color: 'var(--red)', lineHeight: 1.5 }}>
              {actionError}
            </p>
          )}

          {/* Unpaid: the two order-level actions. Paid: no removal — the
              service refuses a line delete on a captured order. */}
          {unpaid && (
            <div
              className="rounded-[8px] p-4 mb-5"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Payment not completed
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Your items are reserved for this order. Resume the existing
                payment rather than starting a new one — or cancel the order
                and check out again later.
              </p>
              <div className="flex flex-wrap gap-2">
                {canResume && (
                  <button
                    type="button"
                    onClick={() => void resumePayment()}
                    disabled={busy != null}
                    aria-busy={busy === 'resume'}
                    className="text-sm px-4 py-2 rounded-[6px]"
                    style={{
                      background: 'var(--action-primary-bg)',
                      color: '#fff',
                      fontWeight: 500,
                      border: 'none',
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    {busy === 'resume' ? 'Opening payment…' : 'Resume payment'}
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => void cancelOrder()}
                    disabled={busy != null}
                    aria-busy={busy === 'cancel'}
                    className="text-sm px-4 py-2 rounded-[6px]"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      border: '1px solid var(--border-visible)',
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
                  </button>
                )}
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Removing an item updates this order and opens a fresh payment
                session for the new total.
              </p>
            </div>
          )}

          {/* Seller-grouped lines — one block per seller, delivery class shown
              on every line, ONE shipping row per seller accessories group. */}
          {sellerGroups.map((seller) => (
            <div
              key={seller.sellerId}
              className="rounded-[8px] mb-4 overflow-hidden"
              style={{ border: '0.5px solid var(--border)' }}
            >
              <div
                className="px-3 py-2 text-xs"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', fontWeight: 500 }}
              >
                {seller.sellerName}
                {seller.goods.length > 0 && seller.firearms.length > 0
                  ? ' · accessories + firearms'
                  : seller.firearms.length > 0
                    ? ' · firearms'
                    : ''}
              </div>

              {seller.goods.length > 0 && (
                <p className="px-3 pt-2 text-[10px] uppercase m-0" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
                  Accessories
                </p>
              )}
              {seller.goods.map((line) => (
                <OrderLineRow
                  key={line.id}
                  line={line}
                  canRemove={canRemove}
                  removing={busy === `remove:${line.transaction?.id}`}
                  onRemove={() => void removeLine(line)}
                />
              ))}
              {/* ONE delivery row per seller accessories group — the same one
                  combined courier charge the cart showed. */}
              {shippingRows
                .filter((row) => row.sellerId === seller.sellerId)
                .map((row) => (
                  <div
                    key={row.key}
                    className="px-3 py-2 flex items-center justify-between text-xs"
                    style={{ borderTop: '0.5px solid var(--border)', background: 'var(--bg-inset)' }}
                  >
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      Delivery · {row.label}
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                      {formatPrice(row.shippingCents)}
                    </span>
                  </div>
                ))}

              {seller.firearms.length > 0 && (
                <p className="px-3 pt-2 text-[10px] uppercase m-0" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
                  Firearms
                </p>
              )}
              {seller.firearms.map((line) => (
                <OrderLineRow
                  key={line.id}
                  line={line}
                  canRemove={canRemove}
                  removing={busy === `remove:${line.transaction?.id}`}
                  onRemove={() => void removeLine(line)}
                />
              ))}
            </div>
          ))}

          {sellerlessRows.map((row) => (
            <div
              key={row.key}
              className="rounded-[8px] mb-4 px-3 py-2 flex items-center justify-between text-xs"
              style={{ border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}
            >
              <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
              <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(row.shippingCents)}
              </span>
            </div>
          ))}

          {unpaid && canRemove && (
            <p className="text-[11px] mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Removing an item recalculates delivery and the Platform Fee for
              the remaining items.
            </p>
          )}

          {/*
            ⚠️ ONE RATING PER SELLER PER ORDER. A cart can hold items from
            several sellers; the backend accepts one rating per seller per
            order, so this is the only place it is offered. The transaction
            page links back here instead of showing a second, per-line widget.
          */}
          {showsSellerRatingSection(order.sellers) ? (
            <div
              className="rounded-[8px] p-4 mb-5"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
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
                      <p className="text-sm m-0" style={{ color: 'var(--text-primary)' }}>
                        {seller.username ?? 'Anonymous seller'}
                      </p>
                      {items.length ? (
                        <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                          {items
                            .map((line) => line.listing?.title ?? 'Item')
                            .join(' · ')}
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
                        <p className="text-xs m-0" style={{ color: 'var(--text-tertiary)' }}>
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

          {/* Totals — ONE aggregate Platform Fee for the whole order. */}
          <div
            className="rounded-[8px] p-4"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div className="flex justify-between text-sm py-1">
              <span style={{ color: 'var(--text-tertiary)' }}>Items</span>
              <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(totals.itemsCents)}
              </span>
            </div>
            {totals.shippingCents > 0 && (
              <div className="flex justify-between text-sm py-1">
                <span style={{ color: 'var(--text-tertiary)' }}>Delivery</span>
                <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(totals.shippingCents)}
                </span>
              </div>
            )}
            {totals.platformFeeCents > 0 && (
              <div className="flex justify-between text-sm py-1">
                <span style={{ color: 'var(--text-tertiary)' }}>Platform Fee</span>
                <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(totals.platformFeeCents)}
                </span>
              </div>
            )}
            <div
              className="flex justify-between text-sm py-2 mt-1"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Total</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(totals.totalCents)}
              </span>
            </div>
          </div>

          {order.status === 'PARTIALLY_FULFILLED' && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Some items in this order are still on their way. Delivery is
              confirmed per seller as each one arrives.
            </p>
          )}
          {order.status === 'COMPLETED' && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Every item in this order has been delivered or handed over.
            </p>
          )}
        </PageReveal>
      </main>
    </DistanceProvider>
  );
}
