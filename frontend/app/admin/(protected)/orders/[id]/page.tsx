'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminStatusChip as StatusChip } from '@/components/admin/status-chip';

// ─── Types ───────────────────────────────────────────────────────────
// Mirrors AdminService.getOrderDossier's select.

interface OrderDossier {
  order: {
    id: string;
    orderReference: string | null;
    status: string;
    paymentMethod: string;
    itemsSubtotal: number;
    shippingSubtotal: number;
    handlingSubtotal: number;
    processingFee: number;
    buyerTotal: number;
    manualPayByAt: string | null;
    manualDetectedAt: string | null;
    manualCancelledAt: string | null;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
    buyer: {
      id: string;
      username: string | null;
      email: string;
      phone: string | null;
    };
    transactions: {
      id: string;
      paymentStatus: string;
      shippingMethod: string | null;
      shippingStatus: string | null;
      shipsWithId: string | null;
      buyerTotal: number;
      sellerPayout: number;
      refundedAmount: number;
      listing: {
        id: string;
        title: string;
        referenceNumber: string | null;
      };
      seller: { id: string; username: string | null };
    }[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRand(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `R ${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
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

// ─── Page ───────────────────────────────────────────────────────────

export default function OrderDossierPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [d, setD] = useState<OrderDossier | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/admin/orders/${id}/dossier`);
        if (cancelled) return;
        if (res.ok) setD((await res.json()) as OrderDossier);
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
          Order not found.
        </p>
      </div>
    );
  }

  const order = d.order;

  return (
    <div>
      <Link
        href="/admin/orders"
        className="text-xs inline-block mb-3"
        style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
      >
        ← Orders
      </Link>

      {/* ─── Header strip ──────────────────────────────────────── */}
      <div
        className="rounded-[8px] p-5 mb-5"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <StatusChip status={order.status} />
          <code
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
            }}
          >
            {order.orderReference ?? order.id}
          </code>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Buyer:{' '}
          <Link
            href={`/admin/users/${order.buyer.id}`}
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            @{order.buyer.username ?? 'anon'}
          </Link>
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {order.buyer.email}
          {order.buyer.phone && ` · ${order.buyer.phone}`}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Order ID: <code style={{ fontFamily: 'monospace' }}>{order.id}</code>
          {' · Created '}{formatDateTime(order.createdAt)}
          {' · Updated '}{formatDateTime(order.updatedAt)}
        </p>
      </div>

      {/* ─── Payment breakdown ──────────────────────────────────── */}
      <Section title="Payment breakdown" subtitle="One EFT capture for the whole cart. Sums across all lines.">
        <DataList
          rows={[
            ['Reference', order.orderReference ?? '—'],
            ['Payment method', order.paymentMethod.replace(/_/g, ' ')],
            ['Items subtotal', formatRand(order.itemsSubtotal)],
            ['Shipping', formatRand(order.shippingSubtotal)],
            ['Handling', formatRand(order.handlingSubtotal)],
            ['Processing fee', formatRand(order.processingFee)],
            ['Buyer total', formatRand(order.buyerTotal)],
            ['Paid at', formatDateTime(order.paidAt)],
            ['Pay-by', formatDateTime(order.manualPayByAt)],
          ]}
        />
      </Section>

      {/* ─── Lines / parcel ─────────────────────────────────────── */}
      <Section
        title="Lines / parcel"
        subtitle="Each line is a child transaction. Per-line refund / release lives on the transaction dossier."
      >
        <div
          className="rounded-[8px] overflow-x-auto"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                {['Item', 'Seller', 'Method', 'Status', 'Total', ''].map((h) => (
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
              {order.transactions.map((line, i) => (
                <tr
                  key={line.id}
                  style={
                    i < order.transactions.length - 1
                      ? { borderBottom: '0.5px solid var(--border)' }
                      : undefined
                  }
                >
                  <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                    <Link
                      href={`/admin/transactions/${line.id}`}
                      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      <div className="font-medium">{line.listing.title}</div>
                      {line.listing.referenceNumber && (
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {line.listing.referenceNumber}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    @{line.seller.username ?? 'anon'}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {line.shippingMethod?.replace(/_/g, ' ') ?? '—'}
                    {line.shipsWithId && (
                      <span
                        className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
                      >
                        ships with {line.shipsWithId.slice(0, 6)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip status={line.paymentStatus} />
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                    {formatRand(line.buyerTotal)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <Link
                      href={`/admin/transactions/${line.id}`}
                      style={{ color: 'var(--red)', textDecoration: 'none' }}
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
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
