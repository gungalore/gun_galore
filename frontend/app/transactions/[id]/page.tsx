import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { Transaction, PaymentStatus, ShippingStatus } from '@/lib/types';
import { formatPrice, PROVINCE_LABELS } from '@/lib/utils';
import { DispatchButton } from './dispatch-button';
import { ConfirmDeliveryButton } from './confirm-delivery-button';
import { RatingWidget } from './rating-widget';
import { MessageThread } from './message-thread';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  HELD: 'Payment held',
  PENDING_ADMIN_VERIFICATION: 'Pending verification',
  RELEASED: 'Payout released',
  DISPUTED: 'Disputed',
  REFUNDED: 'Refunded',
};

const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  HELD: '#f59e0b',
  PENDING_ADMIN_VERIFICATION: '#6366f1',
  RELEASED: '#00a03c',
  DISPUTED: 'var(--red)',
  REFUNDED: 'var(--text-tertiary)',
};

const SHIPPING_STATUS_LABEL: Record<ShippingStatus, string> = {
  PENDING: 'Awaiting dispatch',
  COLLECTED: 'Collected',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  RETURNED: 'Returned',
};

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, getToken } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/transactions/${id}`);

  const token = await getToken();
  const res = await fetch(`${API_URL}/transactions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404 || res.status === 403) return notFound();
  if (!res.ok) return notFound();

  const tx: Transaction = await res.json();

  const isBuyer = tx.buyerId === userId;
  const isSeller = tx.sellerId === userId;

  const listing = tx.listing;
  const primaryImage = listing.images.find((i) => i.isPrimary) ?? listing.images[0];

  const canDispatch =
    isSeller &&
    tx.paymentStatus === 'HELD' &&
    tx.shippingStatus === 'PENDING' &&
    !tx.dispatchedAt;

  const canConfirmDelivery =
    isBuyer &&
    tx.paymentStatus === 'HELD' &&
    !!tx.dispatchedAt &&
    !tx.confirmedDeliveryAt;

  const canRate =
    isBuyer &&
    tx.paymentStatus === 'RELEASED' &&
    !(tx as unknown as { rating?: unknown }).rating;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <Link href="/" className="text-sm inline-block mb-6" style={{ color: 'var(--text-tertiary)' }}>
        ← Back
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
        {/* Left: main detail */}
        <div className="space-y-5">
          {/* Header */}
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Order #{tx.id.slice(-8).toUpperCase()}
            </p>
            <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
              {listing.title}
            </h1>
          </div>

          {/* Item card */}
          <div
            className="rounded-[8px] p-4 flex gap-4"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            {primaryImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={primaryImage.url}
                alt={listing.title}
                className="w-20 h-20 rounded-[6px] object-cover flex-shrink-0"
                style={{ background: 'var(--bg-inset)' }}
              />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>
                {listing.title}
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                {listing.category.name} · {PROVINCE_LABELS[listing.province]}
              </p>
              {isSeller ? (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Buyer: {tx.buyer.firstName ?? 'Buyer'} {tx.buyer.lastName ?? ''}
                </p>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Seller: {tx.seller.firstName ?? 'Seller'} {tx.seller.lastName?.charAt(0) ?? ''}{tx.seller.lastName ? '.' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Shipping */}
          <div
            className="rounded-[8px] p-4 text-sm"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <p className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
              Shipping
            </p>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Method</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {tx.shippingMethod === 'PUDO'
                    ? 'Pudo Locker'
                    : tx.shippingMethod === 'TCG'
                    ? 'Door Delivery (TCG)'
                    : tx.shippingMethod === 'DEALER_TRANSFER'
                    ? 'Dealer Transfer'
                    : '—'}
                </span>
              </div>

              {tx.shippingStatus && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Status</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {SHIPPING_STATUS_LABEL[tx.shippingStatus]}
                  </span>
                </div>
              )}

              {tx.trackingReference && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Tracking</span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '12px' }}>
                    {tx.trackingReference}
                  </span>
                </div>
              )}

              {tx.dealer && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Receiving dealer</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {tx.dealer.name}, {tx.dealer.city}
                  </span>
                </div>
              )}

              {tx.dispatchedAt && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Dispatched</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {new Date(tx.dispatchedAt).toLocaleDateString('en-ZA')}
                  </span>
                </div>
              )}

              {tx.deliveredAt && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Delivered</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {new Date(tx.deliveredAt).toLocaleDateString('en-ZA')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Buyer: confirm delivery */}
          {canConfirmDelivery && (
            <div
              className="rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Have you received the item?
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
                Confirming delivery releases payment to the seller.
              </p>
              <ConfirmDeliveryButton transactionId={tx.id} />
            </div>
          )}

          {/* Buyer: rate seller */}
          {canRate && (
            <div
              className="rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                Rate this seller
              </p>
              <RatingWidget transactionId={tx.id} />
            </div>
          )}

          {/* Seller dispatch */}
          {canDispatch && (
            <div
              className="rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                Mark as dispatched
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
                Once you&apos;ve handed the item to the courier or transferred it to the receiving dealer, confirm dispatch here. Payment will be released after the buyer confirms delivery.
              </p>
              <DispatchButton tx={tx} />
            </div>
          )}
        </div>

        {/* Right: payment summary */}
        <div
          className="rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Payment
          </p>

          {/* Status badge */}
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-4"
            style={{
              background: `${PAYMENT_STATUS_COLOR[tx.paymentStatus]}18`,
              color: PAYMENT_STATUS_COLOR[tx.paymentStatus],
              border: `0.5px solid ${PAYMENT_STATUS_COLOR[tx.paymentStatus]}40`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: PAYMENT_STATUS_COLOR[tx.paymentStatus] }}
            />
            {PAYMENT_STATUS_LABEL[tx.paymentStatus]}
          </div>

          {/* Breakdown */}
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Item price</span>
              <span style={{ color: 'var(--text-primary)' }}>{formatPrice(tx.listingPrice)}</span>
            </div>

            {tx.passFeeToBuyer && tx.processingFee > 0 && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Processing fee</span>
                <span style={{ color: 'var(--text-primary)' }}>{formatPrice(tx.processingFee)}</span>
              </div>
            )}

            <div
              className="my-2"
              style={{ borderTop: '0.5px solid var(--border-divider)' }}
            />

            {isBuyer && (
              <div className="flex justify-between font-medium">
                <span style={{ color: 'var(--text-secondary)' }}>You paid</span>
                <span style={{ color: 'var(--red)' }}>{formatPrice(tx.buyerTotal)}</span>
              </div>
            )}

            {isSeller && (
              <>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Commission</span>
                  <span style={{ color: 'var(--text-primary)' }}>−{formatPrice(tx.commissionZar)}</span>
                </div>
                {!tx.passFeeToBuyer && tx.processingFee > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-tertiary)' }}>Processing fee</span>
                    <span style={{ color: 'var(--text-primary)' }}>−{formatPrice(tx.processingFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span style={{ color: 'var(--text-secondary)' }}>Your payout</span>
                  <span style={{ color: '#00a03c' }}>{formatPrice(tx.sellerPayout)}</span>
                </div>
              </>
            )}
          </div>

          {tx.paidAt && (
            <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
              Paid {new Date(tx.paidAt).toLocaleDateString('en-ZA')}
            </p>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div
        className="mt-8 rounded-[8px] overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Messages
          </p>
        </div>
        <MessageThread transactionId={tx.id} myClerkId={userId} />
      </div>
    </main>
  );
}
