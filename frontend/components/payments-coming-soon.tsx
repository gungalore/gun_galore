'use client';

import Link from 'next/link';

// Phase-1 payment gate. Manual EFT pay-in is retired and the card paygate
// isn't live yet, so every checkout lane lands here instead of a payment
// path. Rendered when POST /transactions (or /orders/checkout) returns the
// 503 "card payments are launching soon" gate (see assertPaymentsLive on the
// API). Rail-agnostic — carries no bank details or order reference.
export function PaymentsComingSoon({
  backHref,
  backLabel,
}: {
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div
      className="rounded-[8px] p-6 text-center"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <h2
        className="text-base font-medium mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Card payments are launching soon
      </h2>
      <p
        className="text-sm mb-6"
        style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
      >
        We&apos;re finalising our secure card checkout. You can keep browsing and
        listing in the meantime.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        {backHref && (
          <Link
            href={backHref}
            className="text-sm px-4 py-2 rounded-[6px]"
            style={{
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            {backLabel ?? 'Back to listing'}
          </Link>
        )}
        <Link
          href="/"
          className="text-sm px-4 py-2 rounded-[6px]"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
        >
          Browse the marketplace
        </Link>
      </div>
    </div>
  );
}
