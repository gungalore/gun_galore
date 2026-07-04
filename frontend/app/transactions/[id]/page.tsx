import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@clerk/nextjs/server';
import { Transaction, PaymentStatus, ShippingStatus } from '@/lib/types';
import { formatPrice, PROVINCE_LABELS } from '@/lib/utils';
import { DispatchButton } from './dispatch-button';
import { ConfirmDeliveryButton } from './confirm-delivery-button';
import { DownloadReceiptButton } from './download-receipt-button';
import { DownloadSaps534Button } from './download-saps534-button';
import { RaiseDisputeButton } from './raise-dispute-button';
import { RatingWidget } from './rating-widget';
import { TrackingTimeline } from './tracking-timeline';
import { AcceptRejectPanel } from './accept-reject-panel';
import BuyerCancelPanel from './buyer-cancel-panel';
import PodProofSection from './pod-proof-section';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

// Carrier deep-link patterns. Returns null for methods that don't
// have a public tracking URL (DEALER_TRANSFER doesn't, PRIVATE_ARRANGE
// doesn't ship at all). PUDO and TCG both have public lookup pages
// that accept the reference as a query param.
function trackingUrl(
  method: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  if (!method || !reference) return null;
  const ref = encodeURIComponent(reference.trim());
  if (method === 'PUDO') return `https://www.pudo.co.za/tracking?tracking=${ref}`;
  if (method === 'TCG') return `https://www.thecourierguy.co.za/track-a-parcel?waybill=${ref}`;
  return null;
}

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

  // PRIVATE_ARRANGE has no dispatch / confirm-delivery cycle — payment
  // releases immediately on capture (see TransactionsService
  // .maybeImmediatePayout). The buttons below are courier-flow only.
  const isPrivateArrange = tx.shippingMethod === 'PRIVATE_ARRANGE';

  // COLLECTION — buyer collects in person from the seller. No dispatch
  // step, no courier, no tracking/waybill. Once paid we reveal contact
  // details so both sides coordinate pickup; funds are held until the
  // buyer confirms collection (same confirm-delivery endpoint, relabelled
  // "Confirm collection").
  const isCollection = tx.shippingMethod === 'COLLECTION';

  // P6.2 — this line is a consolidated SIBLING: it ships inside the same parcel
  // as the rest of the order, and the carrier ("main item") line owns the
  // waybill, tracking, and delivery confirmation. Siblings mirror the carrier's
  // dispatch/delivery status (so dispatchedAt is set once the parcel ships), but
  // they must NOT offer their own dispatch or confirm-delivery surfaces — those
  // actions live on the carrier and cascade back to this line via the backend.
  const isConsolidatedSibling = !!tx.shipsWithId;

  // TOK-7 Phase 2 — accept gates dispatch. Seller must tap "Accept this
  // sale" before they can mark dispatched. The accept panel shows from
  // paidAt until accepted/rejected; the dispatch panel only shows once
  // accepted (and not yet dispatched).
  const isPaidAwaitingAccept =
    !!tx.paidAt && !tx.acceptedAt && !tx.rejectedAt && !tx.dispatchedAt;
  const isRejected = !!tx.rejectedAt;
  const canAccept = isSeller && isPaidAwaitingAccept && !isPrivateArrange;
  const canDispatch =
    !isPrivateArrange &&
    !isCollection && // collection has no dispatch step
    !isConsolidatedSibling && // sibling dispatches with the carrier, not on its own
    isSeller &&
    !!tx.acceptedAt && // hard gate — must accept first
    !isRejected &&
    tx.paymentStatus === 'HELD' &&
    tx.shippingStatus === 'PENDING' &&
    !tx.dispatchedAt;

  // For firearm DEALER_TRANSFER, payout no longer depends on the
  // buyer pressing "Confirm delivery" — funds auto-release when the
  // seller's dealer-stock-in verification is APPROVED. So hide the
  // button entirely on that flow; the buyer instead gets a "your
  // firearm is at <dealer>" panel once the verification approves.
  const isFirearmDealerTransfer =
    !!tx.listing?.isFirearm && tx.shippingMethod === 'DEALER_TRANSFER';
  const canConfirmDelivery =
    !isPrivateArrange &&
    !isFirearmDealerTransfer &&
    !isCollection && // collection uses its own confirm-collection block below
    !isConsolidatedSibling && // confirm delivery on the carrier — it releases the whole group
    isBuyer &&
    tx.paymentStatus === 'HELD' &&
    !!tx.dispatchedAt &&
    !tx.confirmedDeliveryAt;

  // Collection confirm — the buyer confirms they've collected in person.
  // No dispatch gate (there's no courier); available once the seller has
  // accepted and the payment is still held. Hits the same confirm-delivery
  // endpoint as the courier flow, just relabelled.
  const canConfirmCollection =
    isCollection &&
    isBuyer &&
    tx.paymentStatus === 'HELD' &&
    !!tx.acceptedAt &&
    !tx.confirmedDeliveryAt;

  // Phase 4 P4.2 — buyer can self-cancel a paid courier order that hasn't
  // shipped yet (full refund). Self-service only for PUDO/TCG; firearm
  // dealer-transfer + PRIVATE_ARRANGE route through dispute/support.
  const canCancel =
    isBuyer &&
    tx.paymentStatus === 'HELD' &&
    !!tx.paidAt &&
    !tx.dispatchedAt &&
    !tx.rejectedAt &&
    (tx.shippingMethod === 'PUDO' || tx.shippingMethod === 'TCG');

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
              <Image
                src={primaryImage.url}
                alt={listing.title}
                width={80}
                height={80}
                sizes="80px"
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
                  Buyer: {tx.buyer.username ?? 'Anonymous'}
                </p>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Seller: {tx.seller.username ?? 'Anonymous'}
                </p>
              )}
            </div>
          </div>

          {/* P6.2 — consolidated-shipment SIBLING note. This line ships inside
              the same parcel as the rest of the order; the carrier ("main item")
              line owns the waybill, tracking and delivery confirmation. Point
              both parties there — this line's own dispatch / confirm / tracking
              surfaces are hidden (isConsolidatedSibling) since the backend
              cascades dispatch + release across the whole group. */}
          {isConsolidatedSibling && (
            <div
              className="rounded-[8px] p-4 text-sm"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p
                className="text-xs uppercase mb-1"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600 }}
              >
                Ships with your order
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {isSeller
                  ? 'This item ships in one parcel with the rest of this order. Print the waybill and mark it dispatched from the main item — this line moves with it automatically.'
                  : 'This item ships in one parcel with the rest of your order — tracking is on the main item. Confirming delivery there releases this item too.'}
              </p>
              <Link
                href={`/transactions/${tx.shipsWithId}`}
                className="inline-block mt-2"
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                View the main item →
              </Link>
              {!isSeller && tx.shipsWith?.trackingReference &&
                trackingUrl(tx.shippingMethod, tx.shipsWith.trackingReference) && (
                  <a
                    href={trackingUrl(tx.shippingMethod, tx.shipsWith.trackingReference)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-2"
                    style={{
                      color: 'var(--red)',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      textDecoration: 'underline',
                    }}
                  >
                    Track the parcel: {tx.shipsWith.trackingReference} ↗
                  </a>
                )}
            </div>
          )}

          {/* PRIVATE_ARRANGE contact-reveal card. Only renders for paid
              PRIVATE_ARRANGE transactions — non-PA orders have the
              other party's phone/email blanked in the API response so
              we can't accidentally leak details by misreading state. */}
          {tx.shippingMethod === 'PRIVATE_ARRANGE' && !!tx.privateArrangeAcceptedAt && tx.paymentStatus === 'RELEASED' && (
            <div
              className="rounded-[8px] p-4 text-sm space-y-2"
              style={{
                background: 'rgba(200,16,46,0.06)',
                border: '0.5px solid var(--red)',
              }}
            >
              <p
                className="text-xs uppercase"
                style={{
                  color: 'var(--red)',
                  letterSpacing: '0.05em',
                  fontWeight: 600,
                }}
              >
                {isBuyer ? 'Seller contact' : 'Buyer contact'}
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                {isBuyer
                  ? "You waived payment protection at checkout — payment has been released. Contact the seller to arrange a SAPS-licensed dealer meet."
                  : "The buyer accepted private arrangement — your payout has been released. Coordinate the dealer meet with them."}
              </p>
              {(() => {
                const them = isBuyer ? tx.seller : tx.buyer;
                const fullName =
                  [them.firstName, them.lastName].filter(Boolean).join(' ') ||
                  (isBuyer ? 'Seller' : 'Buyer');
                return (
                  <div
                    className="rounded-[6px] p-3"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                    }}
                  >
                    <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {fullName}
                    </p>
                    {them.phone && (
                      <p
                        className="mt-1"
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {them.phone}
                      </p>
                    )}
                    {them.email && (
                      <p
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 13,
                        }}
                      >
                        {them.email}
                      </p>
                    )}
                  </div>
                );
              })()}
              <p
                className="text-xs"
                style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
              >
                Complete the transfer at a SAPS-licensed dealer. Don&apos;t hand the
                item over outside a licensed dealer&apos;s premises — the
                paperwork is what transfers ownership legally.
              </p>
            </div>
          )}

          {/* COLLECTION contact-reveal + arrange-collection guidance. The
              API returns the other party's phone/email on a paid
              collection order (blanked otherwise), so both sides can
              coordinate a pickup time. Unlike PRIVATE_ARRANGE, payment is
              still HELD here — funds release only when the buyer confirms
              collection. Shown once the order is paid. */}
          {isCollection && !!tx.paidAt && (
            <div
              className="rounded-[8px] p-4 text-sm space-y-2"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <p
                className="text-xs uppercase"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.05em',
                  fontWeight: 600,
                }}
              >
                Arrange collection
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {isBuyer
                  ? "This item is collected in person from the seller. Contact the seller to arrange a pickup time. Your payment is held until you confirm you've collected it."
                  : "This item is collected in person. Contact the buyer to arrange a pickup time. The payment is held until the buyer confirms collection, then released to you."}
              </p>
              {(() => {
                const them = isBuyer ? tx.seller : tx.buyer;
                const fullName =
                  [them.firstName, them.lastName].filter(Boolean).join(' ') ||
                  (isBuyer ? 'Seller' : 'Buyer');
                const hasContact = !!(them.phone || them.email);
                return (
                  <div
                    className="rounded-[6px] p-3"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                    }}
                  >
                    <p
                      className="text-xs uppercase mb-1"
                      style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
                    >
                      Contact the {isBuyer ? 'seller' : 'buyer'} to arrange collection
                    </p>
                    <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {fullName}
                    </p>
                    {them.phone && (
                      <a
                        href={`tel:${them.phone}`}
                        className="block mt-1"
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'ui-monospace, monospace',
                          textDecoration: 'underline',
                        }}
                      >
                        {them.phone}
                      </a>
                    )}
                    {them.email && (
                      <a
                        href={`mailto:${them.email}`}
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 13,
                          textDecoration: 'underline',
                        }}
                      >
                        {them.email}
                      </a>
                    )}
                    {!hasContact && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Contact details will appear here shortly.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Shipping (or Collection) — for a collection order there's no
              courier, so the tracking/waybill/POD/timeline sub-blocks
              below stay hidden; only the method row surfaces. */}
          <div
            className="rounded-[8px] p-4 text-sm"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <p className="text-xs uppercase mb-3" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
              {isCollection ? 'Collection' : 'Shipping'}
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
                    : tx.shippingMethod === 'COLLECTION'
                    ? 'Collection in person'
                    : tx.shippingMethod === 'PRIVATE_ARRANGE'
                    ? 'Private arrangement'
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
                  {/* Deep-link to the carrier's public tracking page
                      so the buyer can check parcel status without
                      copy-pasting. Falls back to plain monospaced text
                      if the shipping method doesn't have a known
                      tracking URL pattern. */}
                  {trackingUrl(tx.shippingMethod, tx.trackingReference) ? (
                    <a
                      href={trackingUrl(tx.shippingMethod, tx.trackingReference)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--red)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        textDecoration: 'underline',
                      }}
                    >
                      {tx.trackingReference} ↗
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '12px' }}>
                      {tx.trackingReference}
                    </span>
                  )}
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

              {/* Estimated delivery (Phase 5 P5.1) — best-effort window,
                  hidden once actually delivered. Labelled "estimated". */}
              {tx.estimatedDeliveryAt && !tx.deliveredAt && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Estimated delivery</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    ~{new Date(tx.estimatedDeliveryAt).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                    })}
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

              {/* Proof of delivery (Phase 5 P5.3) — carrier-captured
                  reference, evidence only (does not affect payout). */}
              {tx.podReference && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Proof of delivery</span>
                  <span style={{ color: 'var(--text-primary)', textAlign: 'right', maxWidth: '60%' }}>
                    {tx.podReference}
                  </span>
                </div>
              )}
            </div>

            {/* POD photo (Phase 5 P5.3) — optional uploaded delivery photo
                + upload control for buyer/seller after dispatch. Evidence
                for disputes; never gates payout. */}
            {tx.dispatchedAt && (isBuyer || isSeller) && (
              <PodProofSection
                transactionId={tx.id}
                podProofUrl={tx.podProofUrl}
              />
            )}

            {/* Tracking timeline — append-only event log fed by both
                internal milestones AND the 10-min Pudo polling cron.
                Hidden for collection — there's no courier to track — and for
                a consolidated sibling, whose authoritative tracking lives on
                the carrier (surfaced in the "Ships with your order" note). */}
            {!isCollection && !isConsolidatedSibling && (
              <div
                className="mt-4 pt-4"
                style={{ borderTop: '0.5px solid var(--border-divider)' }}
              >
                <p
                  className="text-xs uppercase mb-3"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.05em',
                  }}
                >
                  Tracking
                </p>
                <TrackingTimeline transactionId={tx.id} />
              </div>
            )}
          </div>

          {/* Buyer: confirm delivery OR raise a dispute. Both surface
              while the payment is HELD and the seller has dispatched.
              The dispute path is the escape hatch when the item is
              damaged / wrong / never arrived — confirm-delivery is
              irreversible (releases payout) so the buyer needs a
              visible alternative before they get pressured into it. */}
          {canConfirmDelivery && (
            <div
              className="rounded-[8px] p-4 space-y-3"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Have you received the item?
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  Confirming delivery releases payment to the seller and is final. If there's an issue, raise a dispute instead — payment stays held while we review.
                </p>
                <ConfirmDeliveryButton transactionId={tx.id} />
              </div>
              <RaiseDisputeButton transactionId={tx.id} />
            </div>
          )}

          {/* Buyer: confirm collection (COLLECTION only). Same
              confirm-delivery endpoint as the courier flow, relabelled
              for in-person pickup. Releases payment to the seller and is
              final; the dispute path stays available as the escape hatch. */}
          {canConfirmCollection && (
            <div
              className="rounded-[8px] p-4 space-y-3"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Have you collected the item?
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  Confirming collection releases payment to the seller and is final. If there&apos;s an issue, raise a dispute instead — payment stays held while we review.
                </p>
                <ConfirmDeliveryButton transactionId={tx.id} variant="collection" />
              </div>
              <RaiseDisputeButton transactionId={tx.id} />
            </div>
          )}

          {/* Buyer: cancel a paid-but-undispatched courier order for a
              full refund (Phase 4 P4.2). */}
          {canCancel && (
            <BuyerCancelPanel txId={tx.id} buyerTotalRand={formatPrice(tx.buyerTotal)} />
          )}

          {/* Buyer: standalone dispute panel if we're past confirm
              window for some reason but still HELD + dispatched (e.g.,
              modal flow couldn't proceed, or someone wants to dispute
              before pressing confirm). Identical control surface.
              FLOW-F4 (H16) — also show it for a DEALER_TRANSFER buyer once
              paid: a firearm has no courier dispatch event, so without this
              a stalled dealer transfer left the buyer with NO exit at all.
              The backend raiseDispute now accepts DT once paid + HELD. */}
          {!canConfirmDelivery &&
            isBuyer &&
            tx.paymentStatus === 'HELD' &&
            !tx.confirmedDeliveryAt &&
            (!!tx.dispatchedAt ||
              (tx.shippingMethod === 'DEALER_TRANSFER' && !!tx.paidAt)) && (
              <div
                className="rounded-[8px] p-4"
                style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Issue with this order?
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  {tx.shippingMethod === 'DEALER_TRANSFER'
                    ? 'If the dealer transfer has stalled or something is wrong, raise it here. Your payment stays held while admin reviews.'
                    : 'Payment stays held while admin reviews.'}
                </p>
                <RaiseDisputeButton transactionId={tx.id} />
              </div>
            )}

          {/* DISPUTED banner — shown to both parties once a dispute is
              raised. Replaces the action buttons (those gate on HELD). */}
          {tx.paymentStatus === 'DISPUTED' && (
            <div
              className="rounded-[8px] p-4"
              style={{
                background: 'rgba(200,16,46,0.06)',
                border: '0.5px solid var(--red)',
              }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--red)' }}>
                Dispute raised — admin is reviewing
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {isBuyer
                  ? "Your payment is held while we investigate. We'll contact you within 48 hours with next steps. Please don't confirm delivery until the dispute is resolved."
                  : 'The buyer has raised a dispute. Payment is paused while admin reviews. You will be contacted with the outcome.'}
              </p>
            </div>
          )}

          {/* Seller: (re)download the pre-filled SAPS 534 — firearm
              dealer-transfer only, once paid. Rebuilt on demand so a
              bounced/deleted email attachment is never a dead end. */}
          {isSeller && isFirearmDealerTransfer && !!tx.paidAt && (
            <div
              className="rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                SAPS 534 transfer form
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Pre-filled with your particulars and the firearm details. Print it, complete anything blank in BLOCK LETTERS, have your dealer stamp it, then upload the stamped form back to release your payment.
              </p>
              <DownloadSaps534Button transactionId={tx.id} />
            </div>
          )}

          {/* Buyer: download purchase receipt — available once paid. */}
          {isBuyer && !!tx.paidAt && (
            <div
              className="rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Receipt
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Your proof of purchase. (Not a tax invoice.)
              </p>
              <DownloadReceiptButton transactionId={tx.id} />
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

          {/* TOK-7 Phase 2 — seller accept/reject panel. Renders only
              while the sale is awaiting the seller's go/no-go decision.
              The same panel is the canonical entry point for the
              non-SMS path; the /a/<token> page does the SMS version. */}
          {canAccept && (
            <AcceptRejectPanel
              transactionId={tx.id}
              acceptDeadlineAt={tx.acceptDeadlineAt}
              isDealerTransfer={tx.shippingMethod === 'DEALER_TRANSFER'}
            />
          )}

          {/* Buyer-side "Awaiting seller accept" chip — counterpart
              to the seller's AcceptRejectPanel. Live countdown to
              acceptDeadlineAt. Reassures the buyer that their card
              has been charged but the order isn't locked in yet. */}
          {/* FLOW-F4 (M14) — never show the "awaiting seller accept" countdown
              (which decays into a false auto-refund promise) for PRIVATE_ARRANGE:
              PA has no accept step and funds are already released. Mirrors canAccept. */}
          {isBuyer && isPaidAwaitingAccept && !isPrivateArrange && tx.acceptDeadlineAt && (() => {
            const deadline = new Date(tx.acceptDeadlineAt).getTime();
            const msLeft = deadline - Date.now();
            const hoursLeft = Math.max(0, Math.floor(msLeft / 3_600_000));
            const expired = msLeft <= 0;
            return (
              <div
                className="rounded-[8px] px-4 py-3"
                style={{
                  background: expired
                    ? 'rgba(200,16,46,0.10)'
                    : 'rgba(245,158,11,0.08)',
                  border: `0.5px solid ${
                    expired ? 'var(--red)' : 'rgba(245,158,11,0.45)'
                  }`,
                  lineHeight: 1.55,
                }}
              >
                <p
                  className="text-xs uppercase mb-1"
                  style={{
                    color: expired ? 'var(--red)' : '#f59e0b',
                    letterSpacing: '0.06em',
                    fontWeight: 600,
                  }}
                >
                  {expired
                    ? 'Seller missed accept window — admin reviewing'
                    : `Awaiting seller accept · ${hoursLeft}h left`}
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {expired ? (
                    <>
                      The seller didn&apos;t confirm in time. Our team has
                      been alerted and will follow up — you don&apos;t need
                      to do anything. If they can&apos;t fulfil, your
                      payment is refunded automatically.
                    </>
                  ) : (
                    <>
                      Your card has been charged but the funds are{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>
                        held safely
                      </strong>{' '}
                      by Gun Galore. The seller has 48 hours to confirm
                      they can fulfil. If they don&apos;t, you&apos;ll be
                      refunded automatically.
                    </>
                  )}
                </p>
              </div>
            );
          })()}

          {/* Rejected state — final, both buyer and seller see this. */}
          {isRejected && (
            <div
              className="rounded-[8px] px-4 py-3"
              style={{
                background: 'rgba(200,16,46,0.08)',
                border: '0.5px solid var(--red)',
                lineHeight: 1.55,
              }}
            >
              <p
                className="text-xs uppercase mb-1"
                style={{
                  color: 'var(--red)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                }}
              >
                {isBuyer
                  ? 'Sale cancelled — refund issued'
                  : 'You rejected this sale'}
              </p>
              <p
                className="text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {isBuyer ? (
                  <>
                    The seller couldn&apos;t fulfil this order. Your refund
                    is on the way — allow 5–10 business days to reflect on
                    your card. The listing has been re-activated if you
                    want to try with a different one.
                  </>
                ) : (
                  <>
                    The buyer has been refunded in full and the listing is
                    live again on the marketplace. No further action needed.
                  </>
                )}
                {tx.rejectedReason && (
                  <>
                    <br />
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      Reason: {tx.rejectedReason}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Post-accept dispatch deadline chip — shown to BOTH parties
              after seller has accepted but not yet dispatched. Buyer sees
              "dispatch within Xd" (reassurance the order is moving),
              seller sees the same countdown as a reminder.
              Replaces the old paidAt-based dispatch-SLA chip below. */}
          {!isPrivateArrange &&
            !!tx.acceptedAt &&
            !tx.dispatchedAt &&
            !isRejected &&
            tx.dispatchDeadlineAt &&
            (tx.shippingMethod === 'PUDO' ||
              tx.shippingMethod === 'TCG' ||
              tx.shippingMethod === 'DEALER_TRANSFER') &&
            (() => {
              const deadline = new Date(tx.dispatchDeadlineAt).getTime();
              const msLeft = deadline - Date.now();
              const hoursLeft = Math.max(0, Math.floor(msLeft / 3_600_000));
              const daysLeft = Math.floor(hoursLeft / 24);
              const expired = msLeft <= 0;
              const isCritical = msLeft > 0 && hoursLeft <= 24;
              // FLOW-F4 (H15/H16) — a firearm routes through a licensed dealer,
              // not a courier: there is no dispatch event, no auto-refund and
              // no dispatch strike on this path. The old copy promised all
              // three. Branch the wording so DT sellers/buyers see the truth.
              const isDealerTransfer =
                tx.shippingMethod === 'DEALER_TRANSFER';
              const tone = expired
                ? { bg: 'rgba(200,16,46,0.12)', border: 'var(--red)', label: 'var(--red)' }
                : isCritical
                  ? { bg: 'rgba(200,16,46,0.08)', border: 'var(--red)', label: 'var(--red)' }
                  : { bg: 'rgba(0,160,60,0.06)', border: 'rgba(0,160,60,0.35)', label: '#00a03c' };
              const remaining = expired
                ? 'overdue'
                : daysLeft > 0
                  ? `${daysLeft}d ${hoursLeft % 24}h left`
                  : `${hoursLeft}h left`;
              return (
                <div
                  className="rounded-[8px] px-4 py-3"
                  style={{
                    background: tone.bg,
                    border: `0.5px solid ${tone.border}`,
                    lineHeight: 1.55,
                  }}
                >
                  <p
                    className="text-xs uppercase mb-1"
                    style={{
                      color: tone.label,
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                    }}
                  >
                    {isDealerTransfer
                      ? isSeller
                        ? expired
                          ? 'DEALER TRANSFER OVERDUE'
                          : `COMPLETE DEALER TRANSFER — ${remaining}`
                        : expired
                          ? 'Transfer taking longer than expected — admin alerted'
                          : `Sale accepted · dealer transfer in progress`
                      : isSeller
                        ? expired
                          ? 'DISPATCH OVERDUE'
                          : `DISPATCH — ${remaining}`
                        : expired
                          ? 'Dispatch overdue — admin reviewing'
                          : `Sale accepted · dispatching within ${remaining}`}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {isDealerTransfer ? (
                      /* FLOW-F4 — firearm dealer transfer: no dispatch, no
                         auto-refund, no strike. Truthful copy per path. */
                      isSeller ? (
                        expired ? (
                          <>
                            Your dealer transfer is overdue. Our team has been
                            alerted and will follow up with you. Please complete
                            the hand-off at your licensed dealer — your payment
                            is released once the transfer is verified. Contact
                            support if you&apos;re stuck.
                          </>
                        ) : (
                          <>
                            Complete the dealer transfer by{' '}
                            <strong style={{ color: 'var(--text-primary)' }}>
                              {new Date(tx.dispatchDeadlineAt).toLocaleString(
                                'en-ZA',
                                {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                },
                              )}
                            </strong>
                            . Your payment is released once the transfer is
                            verified — firearm transfers are never
                            auto-refunded.
                          </>
                        )
                      ) : expired ? (
                        <>
                          This firearm transfer is taking longer than expected.
                          Our team has been alerted and will follow up. If you
                          have concerns, raise an issue from this page or
                          contact support.
                        </>
                      ) : (
                        <>
                          The seller has accepted. This firearm transfers
                          through a licensed dealer — we&apos;ll keep you posted
                          at each step.
                        </>
                      )
                    ) : isSeller ? (
                      expired ? (
                        <>
                          You&apos;ve missed the 5-day dispatch window. The
                          buyer will be auto-refunded on the next sweep and
                          you&apos;ll receive a dispatch strike. Contact
                          support if there&apos;s a courier issue.
                        </>
                      ) : (
                        <>
                          Dispatch by{' '}
                          <strong style={{ color: 'var(--text-primary)' }}>
                            {new Date(tx.dispatchDeadlineAt).toLocaleString(
                              'en-ZA',
                              {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </strong>{' '}
                          — past that point the buyer is auto-refunded and
                          your account gets a dispatch strike.
                        </>
                      )
                    ) : expired ? (
                      <>
                        The seller is past the dispatch deadline. Our team
                        will refund you automatically if it doesn&apos;t
                        ship in the next 24 hours.
                      </>
                    ) : (
                      <>
                        The seller has accepted and is preparing your order.
                        We&apos;ll SMS the tracking reference as soon as it
                        ships.
                      </>
                    )}
                  </p>
                </div>
              );
            })()}

          {/* Seller dispatch */}
          {canDispatch && (
            <div
              className="rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              {!(tx.shipmentBookedAt && tx.trackingReference) && (
                <>
                  <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                    Mark as dispatched
                  </p>
                  <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
                    Once you&apos;ve handed the item to the courier or transferred it to the receiving dealer, confirm dispatch here. Payment will be released after the buyer confirms delivery.
                  </p>
                </>
              )}
              <DispatchButton tx={tx} />
            </div>
          )}

          {/* Seller dealer-verification entry point — only for firearm
              DEALER_TRANSFER transactions that have been dispatched
              but not yet verified. This is the SAPS 534 photo-pack
              flow that gates payout release. */}
          {isSeller &&
            tx.shippingMethod === 'DEALER_TRANSFER' &&
            !!tx.dispatchedAt &&
            (tx.dealerVerificationStatus === null ||
              tx.dealerVerificationStatus === 'PENDING_UPLOAD' ||
              tx.dealerVerificationStatus === 'REJECTED') && (
              <div
                className="rounded-[8px] p-4"
                style={{
                  background: 'var(--bg-card)',
                  border: `0.5px solid ${tx.dealerVerificationStatus === 'REJECTED' ? 'var(--red)' : '#f59e0b'}`,
                }}
              >
                <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                  {tx.dealerVerificationStatus === 'REJECTED'
                    ? 'Verification was rejected — please reshoot'
                    : 'Confirm firearm delivered to dealer'}
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
                  Your payout is held until we&apos;ve confirmed the firearm
                  is booked into the dealer&apos;s stock. Upload 3 photos
                  (SAPS 534 form, dealer&apos;s stock register last line,
                  firearm with serial). Our bot scans them; clear photos +
                  block letters mean instant approval and payout.
                </p>
                <Link
                  href={`/transactions/${tx.id}/dealer-verification`}
                  className="inline-block py-2.5 px-4 rounded-[6px] text-sm"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  {tx.dealerVerificationStatus === 'REJECTED'
                    ? 'Reshoot and re-upload →'
                    : 'Upload verification photos →'}
                </Link>
              </div>
            )}

          {/* In-progress / approved / under-review status banner for
              both buyer and seller to see the same state. */}
          {tx.shippingMethod === 'DEALER_TRANSFER' &&
            tx.dealerVerificationStatus &&
            tx.dealerVerificationStatus !== 'PENDING_UPLOAD' && (
              <DealerVerificationStatusBanner status={tx.dealerVerificationStatus} />
            )}

          {/* Buyer-facing dealer details panel — shown to the BUYER
              once the verification has approved and we know where
              the firearm has been booked into stock. This is the
              hand-off moment: Gun Galore is done with the
              transaction, the buyer contacts the seller and the
              dealer directly to arrange the inter-dealer transfer
              onwards. Surfaces alongside the released-payment block
              on the right. */}
          {isBuyer &&
            isFirearmDealerTransfer &&
            tx.dealerVerificationStatus === 'APPROVED' &&
            tx.stockedAtDealerName && (
              <div
                className="rounded-[8px] p-4"
                style={{
                  background: 'rgba(34,197,94,0.06)',
                  border: '0.5px solid rgba(34,197,94,0.45)',
                }}
              >
                <p
                  className="text-sm font-medium mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Your firearm is booked into stock
                </p>
                <p
                  className="text-xs mb-3"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                >
                  The seller has dropped the firearm at the dealer
                  below and we&apos;ve verified the SAPS 534 +
                  stock-register paperwork. From here, contact the
                  seller to arrange the inter-dealer transfer to your
                  own dealer (or your preferred collection method).
                  Gun Galore&apos;s part of this transaction is
                  complete.
                </p>
                <div
                  className="rounded-[6px] p-3 text-sm space-y-1.5"
                  style={{
                    background: 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  <div>
                    <span
                      className="text-xs uppercase tracking-wider mr-2"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Dealer
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {tx.stockedAtDealerName}
                    </span>
                  </div>
                  {tx.stockedAtDealerAddress && (
                    <div>
                      <span
                        className="text-xs uppercase tracking-wider mr-2"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Address
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {tx.stockedAtDealerAddress}
                      </span>
                    </div>
                  )}
                  {tx.stockedAtDealerPhone && (
                    <div>
                      <span
                        className="text-xs uppercase tracking-wider mr-2"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Phone
                      </span>
                      <a
                        href={`tel:${tx.stockedAtDealerPhone}`}
                        style={{
                          color: 'var(--text-primary)',
                          textDecoration: 'underline',
                        }}
                      >
                        {tx.stockedAtDealerPhone}
                      </a>
                    </div>
                  )}
                </div>
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

      {/* Buyer/seller messaging has been removed — pre-purchase
          questions live on the listing's Q&A panel, PRIVATE_ARRANGE
          swaps contact details on the contact-reveal card above, and
          the SLA cron handles every legitimate "where's my parcel"
          touchpoint without a chat. */}
    </main>
  );
}

// Compact status banner for the dealer-verification stage. Renders
// for both buyer and seller so they see the same state.
function DealerVerificationStatusBanner({ status }: { status: string }) {
  const [colour, title, body] = (() => {
    if (status === 'PENDING_CLAUDE') {
      return [
        '#f59e0b',
        'Verification in progress',
        'Our bot is scanning the photos. This usually takes under a minute.',
      ];
    }
    if (status === 'PENDING_ADMIN_REVIEW') {
      return [
        '#f59e0b',
        'Sent for human review',
        'A team member is checking the photos. We aim to confirm within 48 hours. You will receive an email and SMS once verification completes.',
      ];
    }
    if (status === 'APPROVED') {
      return [
        '#22c55e',
        'Dealer-stock verification approved',
        'Payment will be released to the seller. Buyer can now collect from the dealer with their licence paperwork.',
      ];
    }
    return [
      'var(--red)',
      'Verification rejected',
      'The photos did not pass automated verification. The seller will be asked to reshoot.',
    ];
  })();
  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${colour}`,
      }}
    >
      <p
        className="text-sm font-medium mb-1"
        style={{ color: colour as string }}
      >
        {title}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
    </div>
  );
}
