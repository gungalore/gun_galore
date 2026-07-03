'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils';

export interface ManualEftData {
  transactionId: string;
  orderReference: string;
  amountCents: number;
  payByAt: string; // ISO
  bankDetails: {
    accountName: string;
    bank: string;
    accountNumber: string;
    branchCode: string;
    accountType?: string;
  };
}

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
      className="text-xs px-2 py-1 rounded-[4px]"
      style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

function Row({
  label,
  value,
  copyLabel,
  emphasize,
}: {
  label: string;
  value: string;
  copyLabel?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2"
      style={{ borderTop: '0.5px solid var(--border)' }}
    >
      <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
      <span className="flex items-center gap-2">
        <span
          className="text-sm"
          style={{
            color: emphasize ? 'var(--red)' : 'var(--text-primary)',
            fontWeight: emphasize ? 600 : 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {copyLabel && <Copyable value={value} label={copyLabel} />}
      </span>
    </div>
  );
}

export function ManualEftInstructions({
  data,
  listingTitle,
  viewHref,
  viewLabel,
}: {
  data: ManualEftData;
  listingTitle?: string;
  // Override the "View my order" link target. Single-item checkout points at
  // /transactions/:id (default); the multi-item cart points at /orders/:id.
  viewHref?: string;
  viewLabel?: string;
}) {
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, new Date(data.payByAt).getTime() - Date.now()),
  );

  useEffect(() => {
    const t = setInterval(() => {
      setRemaining(Math.max(0, new Date(data.payByAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [data.payByAt]);

  const expired = remaining <= 0;
  const totalMin = Math.floor(remaining / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const secs = Math.floor((remaining % 60000) / 1000);
  // Long window → show "23h 45m"; final hour → "45m 12s" with a live tick.
  const countdownLabel =
    hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m ${String(secs).padStart(2, '0')}s`;

  const b = data.bankDetails;

  return (
    <div>
      <h2 className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Pay by bank transfer (EFT)
      </h2>
      <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Card &amp; instant payments are coming soon — for now, complete your
        order with a quick bank transfer.
      </p>

      {/* Countdown */}
      <div
        className="rounded-[6px] px-4 py-3 mb-4 text-sm"
        style={{
          background: expired ? 'rgba(200,16,46,0.10)' : 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        {expired ? (
          <span style={{ color: 'var(--red)' }}>
            Your payment window has passed — this order may have been
            released. If you&apos;ve already paid, don&apos;t pay again — contact
            support with your reference. Otherwise make a fresh order if the
            item is still available.
          </span>
        ) : (
          <>
            Your item is reserved for you for{' '}
            <strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {countdownLabel}
            </strong>{' '}
            — pay within this window to secure it.
          </>
        )}
      </div>

      {/* Amount + reference — the two things the buyer MUST get right */}
      <div
        className="rounded-[8px] p-4 mb-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)' }}
      >
        <Row
          label="Amount (pay this exact amount)"
          value={formatPrice(data.amountCents)}
          copyLabel="amount"
          emphasize
        />
        <Row
          label="Reference (use EXACTLY this)"
          value={data.orderReference}
          copyLabel="reference"
          emphasize
        />
      </div>

      {/* GG bank details */}
      <div
        className="rounded-[8px] p-4 mb-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <p className="text-xs uppercase mb-1" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
          Pay into
        </p>
        <Row label="Account name" value={b.accountName} />
        <Row label="Bank" value={b.bank} />
        <Row label="Account number" value={b.accountNumber} copyLabel="account number" />
        <Row label="Branch code" value={b.branchCode} copyLabel="branch code" />
        {b.accountType && <Row label="Account type" value={b.accountType} />}
      </div>

      {/* How it works */}
      <div
        className="rounded-[6px] p-4 text-sm"
        style={{ background: 'var(--bg-inset, var(--bg-card))', border: '0.5px solid var(--border)', color: 'var(--text-secondary)', lineHeight: 1.6 }}
      >
        <p style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 6 }}>
          How it works
        </p>
        <ol style={{ paddingLeft: 18, listStyle: 'decimal' }}>
          <li>EFT the <strong>exact amount</strong> above into the Gun Galore account.</li>
          <li>Use your order reference <strong style={{ color: 'var(--red)' }}>{data.orderReference}</strong> as the payment reference — nothing else.</li>
          <li>We verify payments automatically. You&apos;ll get an SMS once it&apos;s confirmed and the seller is told to dispatch.</li>
        </ol>
        <p style={{ marginTop: 8, color: 'var(--text-tertiary)' }}>
          A wrong reference or amount will delay your order while we trace it
          manually. Your money is held until you confirm delivery.
        </p>
      </div>

      <div className="mt-5 flex gap-3">
        <Link
          // FLOW-F3 — honour the caller's target. The cart passes
          // /orders/:id (its "transactionId" IS the order id, so the old
          // hardcoded /transactions/... link was a guaranteed 404).
          href={viewHref ?? `/transactions/${data.transactionId}`}
          className="text-sm px-4 py-2 rounded-[6px]"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
        >
          {viewLabel ?? 'View my order'}
        </Link>
        <Link
          href="/dashboard"
          className="text-sm px-4 py-2 rounded-[6px]"
          style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
