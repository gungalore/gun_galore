'use client';

import { useEffect, useState } from 'react';

// Buyer-side "Awaiting seller accept" chip, lifted out of the order page so
// it can actually tick. It used to be computed once inside the Server
// Component, which meant an installed PWA left open for hours kept showing
// the hours-left figure captured at render — and anything under an hour
// floored to the alarming "0h left" while still painted amber (not expired).
//
// The clock is the only state here: a 60s interval is plenty for a 48h
// window and costs nothing, and crossing zero now flips the chip to the
// expired copy client-side without a reload.
export default function AwaitingAcceptChip({
  acceptDeadlineAt,
}: {
  acceptDeadlineAt: string;
}) {
  const deadline = new Date(acceptDeadlineAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // A malformed/absent date must not render "NaNh left" — the parent only
  // renders us when acceptDeadlineAt is set, but the cast from the API is
  // untyped so guard anyway.
  if (Number.isNaN(deadline)) return null;

  const msLeft = deadline - now;
  const expired = msLeft <= 0;
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const minutesLeft = Math.max(1, Math.ceil(msLeft / 60_000));
  // Under an hour we count in minutes rather than flooring to "0h left",
  // which read as "your window is gone" on an order that was still live.
  const remaining = hoursLeft >= 1 ? `${hoursLeft}h left` : `${minutesLeft}m left`;

  return (
    <div
      className="rounded-[8px] px-4 py-3"
      style={{
        background: expired ? 'rgba(200,16,46,0.10)' : 'rgba(245,158,11,0.08)',
        border: `0.5px solid ${expired ? 'var(--red)' : 'rgba(245,158,11,0.45)'}`,
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
        // The server renders this string against the server clock and the
        // browser re-renders it against its own a moment later; a minute
        // boundary between the two is a harmless text diff, not a bug.
        suppressHydrationWarning
      >
        {expired
          ? 'Seller missed accept window — admin reviewing'
          : `Awaiting seller accept · ${remaining}`}
      </p>
      {/* Copy truthfulness: there is NO auto-refund on the accept timeout.
          escalateStaleAccepts flags the order for admin review and a human
          decides (operator policy — same reason the "7-day auto-release"
          claim was purged from the seller emails). Promising an automatic
          refund on a page showing the buyer's held money is exactly the
          kind of lie that becomes a complaint when it doesn't happen. */}
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }} suppressHydrationWarning>
        {expired ? (
          <>
            The seller didn&apos;t confirm in time. Our team has been alerted
            and is following it up — you don&apos;t need to do anything. Your
            payment is still held; if the seller can&apos;t fulfil, we refund
            you in full.
          </>
        ) : (
          <>
            We&apos;ve received your payment and the funds are{' '}
            <strong style={{ color: 'var(--text-primary)' }}>held safely</strong>{' '}
            by All Outdoor. The seller has 48 hours to confirm they can fulfil.
            If they don&apos;t, our team steps in and refunds you in full.
          </>
        )}
      </p>
    </div>
  );
}
