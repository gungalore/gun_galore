import { serverAuth as auth } from '../../../lib/auth-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PageReveal } from '@/components/page-reveal';
import { toneColor } from '@/lib/status-labels';
import { formatPrice } from '@/lib/utils';
import {
  orderListImageUrl,
  orderListNeedsPayment,
  orderListPreviewTitle,
  orderListReference,
  orderListSellerCount,
  orderListStatus,
  orderListTotalCents,
  orderListUnitCount,
  parseOrderList,
  type OrderListItem,
} from '@/lib/order-list';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

/**
 * My Orders — ONE ROW PER ORDER.
 *
 * Multi-item checkout pays the whole cart in one capture, so the buyer's list
 * is orders, not one row per child transaction. Every card links to
 * /orders/[id], the one page that can resume/cancel an unpaid order, show its
 * seller-grouped lines and offer each seller's rating.
 *
 * Stays a Server Component (Clerk's auth() cannot run in a client component);
 * the row copy/counts come from the tested pure helpers in lib/order-list.ts.
 */
export default async function MyOrdersPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/orders');

  const token = await getToken();
  const res = await fetch(`${API_URL}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const orders: OrderListItem[] = parseOrderList(
    res.ok ? await res.json().catch(() => []) : [],
  );
  const needsPaymentCount = orders.filter(orderListNeedsPayment).length;

  return (
    <main className="max-w-[var(--content-max)] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
        <div data-reveal className="mb-6">
          <h1
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            My Orders
          </h1>
          {orders.length > 0 && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {orders.length} order{orders.length === 1 ? '' : 's'}
              {needsPaymentCount > 0
                ? ` · ${needsPaymentCount} awaiting payment`
                : ''}
            </p>
          )}
        </div>

        {orders.length === 0 ? (
          <div
            data-reveal
            className="rounded-[8px] py-12 px-6 text-center"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px dashed var(--border)',
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              No orders yet
            </p>
            <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
              When you buy something on ALL Outdoor, your order — one payment,
              however many sellers — will show up here with shipping updates
              and dispatch details.
            </p>
            <Link
              href="/"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--action-primary-bg)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Browse the marketplace →
            </Link>
          </div>
        ) : (
          <div data-reveal className="space-y-3">
            {orders.map((order) => {
              const status = orderListStatus(order);
              const color = toneColor(status.tone);
              const imageUrl = orderListImageUrl(order);
              const unitCount = orderListUnitCount(order);
              const sellerCount = orderListSellerCount(order);
              const needsPayment = orderListNeedsPayment(order);
              const href = `/orders/${order.id}`;
              return (
                // ⚠️ ONE <Link> per card, no nested interactive element. The
                // whole row is the target; there is no per-line action here —
                // those live on the order page (resume, cancel, remove).
                <Link
                  key={order.id}
                  href={href}
                  className="block rounded-[8px] p-4 transition-colors"
                  style={{
                    background: 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <div className="flex items-start gap-4">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt=""
                        className="w-14 h-14 rounded-[6px] object-cover shrink-0"
                        style={{ background: 'var(--bg-inset)' }}
                      />
                    ) : (
                      <div
                        className="w-14 h-14 rounded-[6px] shrink-0"
                        style={{ background: 'var(--bg-inset)' }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs mb-0.5"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Order #{orderListReference(order)}
                        {order.createdAt
                          ? ` · ${new Date(order.createdAt).toLocaleDateString('en-ZA')}`
                          : ''}
                      </p>
                      <p
                        className="font-medium truncate m-0"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {orderListPreviewTitle(order)}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {unitCount} item{unitCount === 1 ? '' : 's'}
                        {sellerCount > 1
                          ? ` · ${sellerCount} sellers ship separately`
                          : ''}
                      </p>
                      {needsPayment && (
                        <p
                          className="text-xs mt-1"
                          style={{ color: 'var(--red)', fontWeight: 500 }}
                        >
                          Finish paying for this order
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-medium text-sm m-0"
                        style={{
                          color: 'var(--text-primary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatPrice(orderListTotalCents(order))}
                      </p>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        title={status.hint}
                        style={{
                          color,
                          background: `color-mix(in srgb, ${color} 9%, transparent)`,
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                  </div>
                  <div
                    className="flex justify-end mt-3 pt-3"
                    style={{ borderTop: '0.5px solid var(--border)' }}
                  >
                    <span
                      className="text-xs px-3 py-1.5 rounded-[6px]"
                      style={
                        needsPayment
                          ? {
                              background: 'var(--action-primary-bg)',
                              color: '#fff',
                              fontWeight: 500,
                            }
                          : {
                              background: 'var(--bg-inset)',
                              border: '0.5px solid var(--border)',
                              color: 'var(--text-secondary)',
                              fontWeight: 500,
                            }
                      }
                    >
                      {needsPayment ? 'Finish payment' : 'View order'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </PageReveal>
    </main>
  );
}
