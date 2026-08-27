'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminStatusChip as StatusChip } from '@/components/admin/status-chip';
import DossierActions from './dossier-actions';
import PayoutHoldPanel from './payout-hold-panel';
import DealerVerificationPanel from './dealer-verification-panel';
import { ZohoSyncPanel } from './zoho-sync-panel';

// ─── Types ───────────────────────────────────────────────────────────

interface TransactionDossier {
  transaction: {
    id: string;
    paymentStatus: string;
    riskScore?: number;
    riskFlags?: string[];
    shippingStatus: string | null;
    listingPrice: number;
    commissionZar: number;
    processingFee: number;
    shippingCost: number;
    shippingServiceCode: string | null;
    passFeeToBuyer: boolean;
    buyerTotal: number;
    refundedAmount?: number;
    sellerPayout: number;
    peachCheckoutId: string | null;
    peachPaymentId: string | null;
    peachResultCode: string | null;
    paidAt: string | null;
    releasedAt: string | null;
    // M26 — payout-hold lever fields (auto-returned by the dossier endpoint).
    payoutHeldAt: string | null;
    payoutHoldReason: string | null;

    paidOutAt: string | null;
    shippingMethod: string | null;
    trackingReference: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    pudoDropoffLockerId: string | null;
    pudoPickupLockerId: string | null;
    pudoTrackingCode: string | null;
    deliveryAddress: unknown;
    tcgWaybill: string | null;
    sellerKycClearedAt: string | null;
    dispatchNudgedAt: string | null;
    privateArrangeAcceptedAt: string | null;
    // Dealer stock-in verification (firearm DEALER_TRANSFER only).
    saps534PhotoUrl: string | null;
    stockRegisterPhotoUrl: string | null;
    firearmSerialPhotoUrl: string | null;
    dealerVerificationStatus: string | null;
    dealerVerificationScore: number | null;
    dealerVerificationFindings: unknown;
    dealerVerifiedAt: string | null;
    dealerStockRegisterRef: string | null;
    // Zoho Books sync state — populated by ZohoBooksService when
    // the commission invoice + payment + (optional) credit note
    // are posted. zohoSyncStatus is 'OK' | 'PENDING' | 'FAILED' |
    // 'SKIPPED' | null. Drives the admin sync-status panel + retry button.
    zohoCommissionInvoiceId: string | null;
    zohoCommissionPaymentId: string | null;
    zohoCreditNoteId: string | null;
    zohoSyncStatus: string | null;
    zohoSyncError: string | null;
    zohoSyncLastAttemptAt: string | null;
    adminNote: string | null;
    adminReviewedById: string | null;
    adminReviewedAt: string | null;
    confirmedDeliveryAt: string | null;
    createdAt: string;
    updatedAt: string;
    listing: {
      id: string;
      referenceNumber: string | null;
      title: string;
      price: number | null;
      listingType: string;
      isFirearm: boolean;
      images: { url: string }[];
    };
    buyer: {
      id: string;
      username: string | null;
      email: string;
      phone: string | null;
      kycStatus: string;
      sellerTier: string;
    };
    seller: {
      id: string;
      username: string | null;
      email: string;
      phone: string | null;
      kycStatus: string;
      sellerTier: string;
      profileCompletedAt: string | null;
      bankVerifiedAt: string | null;
      bankName: string | null;
      bankAccountHolder: string | null;
      bankAccountNumber: string | null;
    };
    dealer: {
      id: string;
      name: string;
      licenceNumber: string;
      city: string;
      phone: string | null;
    } | null;
    // Parent order (present only for cart / multi-item purchases). Cart
    // children carry no per-tx orderReference, so this is where the real
    // GG-ORD EFT reference lives.
    order: {
      id: string;
      orderReference: string | null;
      status: string;
      buyerTotal: number;
      _count: { lineItems: number };
    } | null;
    trackingEvents: {
      id: string;
      status: string;
      rawStatus: string | null;
      source: string;
      message: string | null;
      occurredAt: string;
      recordedAt: string;
    }[];
    rating: {
      id: string;
      stars: number;
      comment: string | null;
      createdAt: string;
    } | null;
    // messages: removed — buyer/seller chat feature was never built;
    // dossier no longer queries the dormant table.
  };
  auditEvents: {
    id: string;
    action: string;
    oldValue: string | null;
    newValue: string | null;
    reason: string;
    createdAt: string;
    adminUser: { email: string };
  }[];
  // Complaints lodged against THIS order. A complaint can flip the order to
  // DISPUTED and this page holds the release/refund buttons, so the case and
  // its evidence belong here — previously the adjudicator had to eyeball-match
  // it on /admin/complaints in another tab.
  complaints: {
    id: string;
    referenceNumber: string;
    category: string;
    subject: string;
    body: string;
    status: string;
    outcome: string | null;
    drovePayoutHold: boolean;
    createdAt: string;
    resolvedAt: string | null;
    user: { id: string; username: string | null };
    photos: { id: string; url: string }[];
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRand(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Status pills come from the shared <StatusChip> (AdminStatusChip).

// ─── Page ───────────────────────────────────────────────────────────

export default function TransactionDossierPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [d, setD] = useState<TransactionDossier | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/admin/transactions/${id}/dossier`);
        if (cancelled) return;
        if (res.ok) setD((await res.json()) as TransactionDossier);
        else setD(null);
      } catch {
        if (!cancelled) setD(null);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!loaded) {
    return (
      <div>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      </div>
    );
  }

  if (!d) {
    return (
      <div>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Transaction not found.
        </p>
      </div>
    );
  }

  const t = d.transaction;

  // Build a unified timeline from internal milestones + carrier events.
  // Sorted oldest → newest; rendered as a vertical stepper.
  const timeline: { label: string; at: string | null; source: string }[] = [
    { label: 'Created', at: t.createdAt, source: 'system' },
    { label: 'Paid', at: t.paidAt, source: 'payment' },
    { label: 'KYC cleared', at: t.sellerKycClearedAt, source: 'kyc' },
    { label: 'Dispatched', at: t.dispatchedAt, source: 'shipping' },
    { label: 'Delivered', at: t.deliveredAt, source: 'shipping' },
    { label: 'Buyer confirmed delivery', at: t.confirmedDeliveryAt, source: 'buyer' },
    { label: 'Payout released', at: t.releasedAt, source: 'payment' },
    { label: 'Dispatch nudge sent', at: t.dispatchNudgedAt, source: 'system' },
  ].filter((e) => e.at !== null);

  return (
    <div>
      <Link
        href="/admin/transactions"
        className="text-xs inline-block mb-3"
        style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
      >
        ← Transactions
      </Link>

      {/* ─── Header strip ──────────────────────────────────────── */}
      <div
        className="rounded-[8px] p-5 mb-5"
        style={{
          background: 'var(--bg-card)',
          border: `0.5px solid ${
            t.paymentStatus === 'DISPUTED'
              ? 'var(--red)'
              : t.paymentStatus === 'RELEASED'
                ? '#22c55e'
                : 'var(--border)'
          }`,
        }}
      >
        <div className="flex items-start gap-4 flex-wrap">
          {t.listing.images[0] && (
            <img
              src={t.listing.images[0].url}
              alt=""
              className="w-24 h-24 rounded-[6px] object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <StatusChip status={t.paymentStatus} />
              {t.shippingStatus && <StatusChip status={t.shippingStatus} />}
              {typeof t.riskScore === 'number' && t.riskScore > 0 && (
                <span
                  title={`Fraud-risk flags: ${(t.riskFlags ?? []).join(', ') || 'none'}`}
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: t.riskScore >= 50 ? 'var(--red)' : '#f59e0b',
                    color: '#fff',
                    fontWeight: 600,
                  }}
                >
                  ⚠ Risk {t.riskScore}
                  {(t.riskFlags ?? []).length > 0
                    ? ` · ${(t.riskFlags ?? []).map((f) => f.replace(/_/g, ' ')).join(', ')}`
                    : ''}
                </span>
              )}
              {t.listing.referenceNumber && (
                <code
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-inset)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                  }}
                >
                  {t.listing.referenceNumber}
                </code>
              )}
            </div>
            <h1
              className="text-lg font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              <Link
                href={`/admin/listings/${t.listing.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {t.listing.title}
              </Link>
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Tx ID: <code style={{ fontFamily: 'monospace' }}>{t.id}</code>
              {' · Created '}{formatDateTime(t.createdAt)}
              {' · Updated '}{formatDateTime(t.updatedAt)}
            </p>
            {t.order && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Part of order{' '}
                <Link
                  href={`/admin/orders/${t.order.id}`}
                  style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}
                >
                  {t.order.orderReference ?? t.order.id}
                </Link>
                {' · '}{t.order._count.lineItems} item{t.order._count.lineItems === 1 ? '' : 's'}
                {' · '}{t.order.status.replace(/_/g, ' ')}
              </p>
            )}
          </div>
        </div>

        {/* Complaints driving this order — rendered immediately above the
            money buttons so the admin adjudicates WITH the evidence in view,
            not from memory of another tab. */}
        {(d.complaints?.length ?? 0) > 0 && (
          <div
            className="mt-4 pt-4"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            <p
              className="text-xs uppercase tracking-wider mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Complaints on this order
            </p>
            <div className="flex flex-col gap-3">
              {d.complaints.map((c) => (
                <div
                  key={c.id}
                  className="rounded-[8px] p-3"
                  style={{
                    background: 'var(--bg-inset)',
                    border: `0.5px solid ${c.drovePayoutHold ? 'var(--red)' : 'var(--border)'}`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <span
                      className="text-xs"
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {c.referenceNumber}
                    </span>
                    <span className="flex items-center gap-2">
                      {c.drovePayoutHold && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: 'rgba(200,16,46,0.12)',
                            color: 'var(--red)',
                            fontWeight: 600,
                          }}
                          title="Lodging this complaint put the order on hold"
                        >
                          HOLDING PAYOUT
                        </span>
                      )}
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{
                          background: 'var(--bg-card)',
                          border: '0.5px solid var(--border)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </span>
                  </div>
                  <p
                    className="text-sm mb-1"
                    style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                  >
                    {c.subject}
                  </p>
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {c.category.replace(/_/g, ' ')} · lodged by{' '}
                    {c.user.username ?? '—'} ·{' '}
                    {new Date(c.createdAt).toLocaleDateString('en-ZA')}
                  </p>
                  <p
                    className="text-xs whitespace-pre-wrap"
                    style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                  >
                    {c.body}
                  </p>
                  {c.photos.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {c.photos.map((p) => (
                        <a
                          key={p.id}
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open full size"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.url}
                            alt="Complaint evidence"
                            style={{
                              width: 64,
                              height: 64,
                              objectFit: 'cover',
                              borderRadius: 4,
                              border: '0.5px solid var(--border)',
                            }}
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  {c.outcome && (
                    <p
                      className="text-xs mt-2"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <strong style={{ color: 'var(--text-primary)' }}>
                        Outcome:
                      </strong>{' '}
                      {c.outcome}
                    </p>
                  )}
                  <Link
                    href="/admin/complaints"
                    className="text-xs inline-block mt-2"
                    style={{ color: 'var(--red)', textDecoration: 'none' }}
                  >
                    Open in complaints register →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action surface — release / refund / resolve dispute. Picks
            the correct controls based on paymentStatus. Every action
            that moves money requires a reason for the audit log. */}
        <div
          className="mt-4 pt-4"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <DossierActions
            txId={t.id}
            paymentStatus={t.paymentStatus}
            buyerTotal={t.buyerTotal}
            refundedAmount={t.refundedAmount ?? 0}
          />
          {/* M26 — post-release payout-hold lever (self-contained). */}
          <PayoutHoldPanel
            txId={t.id}
            paymentStatus={t.paymentStatus}
            payoutHeldAt={t.payoutHeldAt}
            payoutHoldReason={t.payoutHoldReason}
            payoutSettled={!!t.paidOutAt}
          />
          {(t.refundedAmount ?? 0) > 0 && t.paymentStatus !== 'REFUNDED' && (
            <p className="text-xs mt-2" style={{ color: 'var(--warning)' }}>
              Partially refunded: R{((t.refundedAmount ?? 0) / 100).toFixed(2)} of R
              {(t.buyerTotal / 100).toFixed(2)} returned to buyer.
            </p>
          )}
        </div>
      </div>

      {/* ─── Parties — buyer + seller side-by-side ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div
          className="rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p
            className="text-xs uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Buyer
          </p>
          <p>
            <Link
              href={`/admin/users/${t.buyer.id}`}
              className="text-base font-medium"
              style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
            >
              @{t.buyer.username ?? 'anon'}
            </Link>
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {t.buyer.email}
            {t.buyer.phone && ` · ${t.buyer.phone}`}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {t.buyer.sellerTier} · KYC {t.buyer.kycStatus}
          </p>
        </div>

        <div
          className="rounded-[8px] p-4"
          style={{
            background: 'var(--bg-card)',
            border: `0.5px solid ${
              t.seller.kycStatus !== 'VERIFIED' || !t.seller.bankVerifiedAt
                ? '#f59e0b'
                : 'var(--border)'
            }`,
          }}
        >
          <p
            className="text-xs uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Seller
          </p>
          <p>
            <Link
              href={`/admin/users/${t.seller.id}`}
              className="text-base font-medium"
              style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
            >
              @{t.seller.username ?? 'anon'}
            </Link>
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {t.seller.email}
            {t.seller.phone && ` · ${t.seller.phone}`}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {t.seller.sellerTier} · KYC {t.seller.kycStatus}
            {t.seller.bankVerifiedAt ? ' · Bank ✓' : ' · Bank ✕'}
            {t.seller.profileCompletedAt ? ' · Profile ✓' : ' · Profile ✕'}
          </p>
          {t.seller.bankName && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Payout to: {t.seller.bankName} ··{t.seller.bankAccountNumber?.slice(-4)} ({t.seller.bankAccountHolder})
            </p>
          )}
        </div>
      </div>

      {/* ─── Payment breakdown ──────────────────────────────────── */}
      <Section title="Payment breakdown" subtitle="ZAR amounts captured at point of sale">
        <DataList
          rows={[
            ['Listing price', formatRand(t.listingPrice)],
            ['Shipping cost', `${formatRand(t.shippingCost)}${t.shippingServiceCode ? ` (${t.shippingServiceCode})` : ''}`],
            ['Buyer total', formatRand(t.buyerTotal)],
            ['Commission', formatRand(t.commissionZar)],
            ['Processing fee', formatRand(t.processingFee)],
            ['Seller payout', formatRand(t.sellerPayout)],
            ['Pass fee to buyer', t.passFeeToBuyer ? 'Yes' : 'No'],
            ['Provider checkout ID', t.peachCheckoutId ?? '—'],
            ['Provider payment ID', t.peachPaymentId ?? '—'],
            ['Provider result code', t.peachResultCode ?? '—'],
          ]}
        />
      </Section>

      {/* ─── Shipping details ───────────────────────────────────── */}
      <Section title="Shipping" subtitle={`Method: ${t.shippingMethod ?? 'none'}`}>
        <DataList
          rows={[
            [
              'Tracking reference',
              // Inline carrier deep-link when one is known. Admin gets
              // the same one-click access to the carrier portal that
              // the buyer page now offers.
              t.trackingReference
                ? trackingHref(t.shippingMethod, t.trackingReference) ?? t.trackingReference
                : '—',
            ],
            ['Pudo dropoff locker', t.pudoDropoffLockerId ?? '—'],
            ['Pudo pickup locker', t.pudoPickupLockerId ?? '—'],
            ['Pudo tracking code', t.pudoTrackingCode ?? '—'],
            ['TCG waybill', t.tcgWaybill ?? '—'],
            ['Delivery address', t.deliveryAddress ? JSON.stringify(t.deliveryAddress) : '—'],
            ['Dealer', t.dealer ? [`${t.dealer.name} (${t.dealer.licenceNumber})`, t.dealer.city].filter(Boolean).join(' · ') : '—'],
            ['Private-arrange consent', formatDateTime(t.privateArrangeAcceptedAt)],
          ]}
        />
      </Section>

      {/* ─── Dealer stock-in verification (firearm DEALER_TRANSFER only) ─ */}
      {t.shippingMethod === 'DEALER_TRANSFER' && t.dealerVerificationStatus && (
        <Section
          title="Dealer stock-in verification"
          subtitle="SAPS 534 + stock register + firearm-serial photos. Payout release for firearm DEALER_TRANSFER gates on this being APPROVED."
        >
          <DealerVerificationPanel
            txId={t.id}
            status={t.dealerVerificationStatus}
            score={t.dealerVerificationScore}
            findings={
              t.dealerVerificationFindings as React.ComponentProps<
                typeof DealerVerificationPanel
              >['findings']
            }
            saps534Url={t.saps534PhotoUrl}
            stockRegisterUrl={t.stockRegisterPhotoUrl}
            firearmSerialUrl={t.firearmSerialPhotoUrl}
            stockRegisterRef={t.dealerStockRegisterRef}
            verifiedAt={t.dealerVerifiedAt}
          />
        </Section>
      )}

      {/* ─── Zoho Books sync status ─ */}
      {(t.zohoSyncStatus || t.zohoCommissionInvoiceId) && (
        <Section
          title="Zoho Books"
          subtitle="Accounting integration: commission invoice, mark-paid, and (on refund) credit note. Auto-posted from dealer-verification and admin-refund flows."
        >
          <ZohoSyncPanel tx={t} />
        </Section>
      )}

      {/* ─── Timeline — internal milestones merged with carrier events ─ */}
      <Section title="Timeline" subtitle="Internal milestones + carrier events, oldest first">
        <div
          className="rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          {timeline.length === 0 && t.trackingEvents.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              No milestones recorded yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span
                    className="shrink-0 w-2 h-2 rounded-full mt-1.5"
                    style={{ background: '#22c55e' }}
                  />
                  <div className="flex-1">
                    <p style={{ color: 'var(--text-primary)' }}>{e.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDateTime(e.at)} · {e.source}
                    </p>
                  </div>
                </li>
              ))}
              {t.trackingEvents.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span
                    className="shrink-0 w-2 h-2 rounded-full mt-1.5"
                    style={{ background: '#3b82f6' }}
                  />
                  <div className="flex-1">
                    <p style={{ color: 'var(--text-primary)' }}>
                      {e.status.replace(/_/g, ' ')}
                      {e.rawStatus && (
                        <span
                          className="ml-2 text-xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          ({e.rawStatus})
                        </span>
                      )}
                    </p>
                    {e.message && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {e.message}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDateTime(e.occurredAt)} · {e.source}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Section>

      {/* Messages section removed — buyer/seller chat was never
          built; Q&A on the listing page + PRIVATE_ARRANGE contact
          reveal replaced it. Keeping the schema model dormant for
          legacy data but no UI surface. */}

      {/* ─── Rating ───────────────────────────────────────────────── */}
      {t.rating && (
        <Section title="Rating left by buyer">
          <div
            className="rounded-[6px] p-3"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div className="flex justify-between mb-1 text-xs">
              <span style={{ color: '#f59e0b' }}>
                {'★'.repeat(t.rating.stars)}{'☆'.repeat(5 - t.rating.stars)}
              </span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {formatDateTime(t.rating.createdAt)}
              </span>
            </div>
            {t.rating.comment && (
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {t.rating.comment}
              </p>
            )}
          </div>
        </Section>
      )}

      {/* ─── Admin note + audit trail ─────────────────────────────── */}
      {(t.adminNote || d.auditEvents.length > 0) && (
        <Section title="Admin">
          {t.adminNote && (
            <div
              className="rounded-[6px] p-3 mb-2 text-sm"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <p
                className="text-xs uppercase mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Internal note
              </p>
              <p style={{ color: 'var(--text-primary)' }}>{t.adminNote}</p>
            </div>
          )}
          {d.auditEvents.length > 0 && (
            <Table
              head={['When', 'Admin', 'Action', 'Change', 'Reason']}
              rows={d.auditEvents.map((e) => [
                formatDateTime(e.createdAt),
                e.adminUser.email,
                e.action.replace(/_/g, ' '),
                e.oldValue && e.newValue
                  ? `${formatJson(e.oldValue)} → ${formatJson(e.newValue)}`
                  : '—',
                e.reason,
              ])}
            />
          )}
        </Section>
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// DataList accepts either a string or a ReactNode value — lets us
// drop inline links (e.g. carrier tracking) into specific rows without
// rebuilding the whole list as a Table.
function DataList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className="flex gap-3 px-4 py-2 text-xs"
          style={
            i < rows.length - 1
              ? { borderBottom: '0.5px solid var(--border)' }
              : undefined
          }
        >
          <span style={{ color: 'var(--text-tertiary)', minWidth: 180 }}>{k}</span>
          <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

// Carrier deep-link — null if shipping method doesn't have a known
// public tracking URL. Renders a real link element when present.
function trackingHref(
  method: string | null | undefined,
  reference: string,
): React.ReactNode {
  // NO CARRIER DEEP LINK — same reason as the buyer page. PUDO and TCG are
  // SLOTS (a collection point and a door), not carriers, so choosing a
  // tracking site off the method sends an admin to pudo.co.za for what is
  // actually a Bob Go waybill. Showing the bare reference is more useful than
  // a link that reports "not found" on a parcel that exists.
  //
  // Restore by branching on `carrierProvider` (already on the dossier query)
  // rather than on the slot.
  void method;
  const url: string | null = null;
  if (!url) return reference;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--red)', textDecoration: 'underline' }}
    >
      {reference} ↗
    </a>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div
      className="rounded-[8px] overflow-x-auto"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
            {head.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-2 text-xs uppercase"
                style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={
                i < rows.length - 1
                  ? { borderBottom: '0.5px solid var(--border)' }
                  : undefined
              }
            >
              {r.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed === 'number' || typeof parsed === 'boolean')
      return String(parsed);
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}
