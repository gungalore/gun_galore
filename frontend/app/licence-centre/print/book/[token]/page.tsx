'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils';
import {
  bookPrintByToken,
  getPrintBooking,
  type PrintBookingSummary,
} from '@/lib/motivations-api';

/**
 * THE ONE-CLICK BOB GO BOOKING PAGE.
 *
 * ⚠️ OPENING IT BOOKS THE COLLECTION. The operator's email carries a random
 * token; this page fetches the order, then POSTs the booking once on mount.
 * There is no sign-in — the token is the credential.
 *
 * ⚠️ NOT A RAW API GET. The link lands on this page rather than an endpoint
 * that books on GET, so an email link scanner fetching the URL cannot dispatch
 * a courier: scanners do not run the JavaScript that makes the POST. A visible
 * retry button covers the rare case where the automatic call fails.
 */
export default function PrintBookingPage() {
  const { token } = useParams<{ token: string }>();
  const [summary, setSummary] = useState<PrintBookingSummary | null>(null);
  const [phase, setPhase] = useState<'loading' | 'booking' | 'done' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const book = useCallback(async () => {
    if (!token) return;
    setPhase('booking');
    setError(null);
    try {
      const next = await bookPrintByToken(token);
      setSummary(next);
      setPhase('done');
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  }, [token]);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    let live = true;
    void (async () => {
      try {
        const s = await getPrintBooking(token);
        if (!live) return;
        setSummary(s);
        if (s.status === 'BOOKED' || s.status === 'DELIVERED') {
          setPhase('done');
          return;
        }
        if (s.canBook) {
          await book();
        } else {
          setError(
            s.status === 'BOOKING'
              ? 'The courier is still confirming this collection. Reload in a few minutes.'
              : 'This order is not ready to book yet — the PDF may still be on its way to the print desk.',
          );
          setPhase('error');
        }
      } catch (err) {
        if (!live) return;
        setError((err as Error).message);
        setPhase('error');
      }
    })();
    return () => {
      live = false;
    };
  }, [book, token]);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-12 pt-8">
      <p className="m-0 text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        ALL Outdoor · Print &amp; Deliver
      </p>

      {phase === 'loading' || phase === 'booking' ? (
        <>
          <h1 className="mt-2 font-[family-name:var(--font-head)] text-[24px] font-medium text-[var(--text-primary)]">
            {phase === 'loading'
              ? 'Checking this booking…'
              : 'Booking the courier…'}
          </h1>
          <p className="mt-2 text-[13.5px] leading-6 text-[var(--text-secondary)]">
            Please keep this page open. Bob Go is being asked to collect the
            envelope from Sterappel.
          </p>
        </>
      ) : null}

      {phase === 'done' && summary ? (
        <>
          <h1 className="mt-2 font-[family-name:var(--font-head)] text-[24px] font-medium text-[var(--text-primary)]">
            Courier booked
          </h1>
          <p className="mt-2 text-[13.5px] leading-6 text-[var(--text-secondary)]">
            Bob Go has the collection for{' '}
            <strong>{summary.motivationReference ?? summary.reference}</strong>.
            The buyer has been emailed the waybill.
          </p>
          <dl className="mt-4 rounded-xl border px-4 py-3 text-[13px] leading-6" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-tertiary)]">Print reference</dt>
              <dd className="m-0 font-mono">{summary.reference}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-tertiary)]">Waybill</dt>
              <dd className="m-0 font-mono">
                {summary.trackingReference ?? 'Awaiting courier'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-tertiary)]">Add-on paid</dt>
              <dd className="m-0">{formatPrice(summary.totalCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-tertiary)]">Deliver to</dt>
              <dd className="m-0 text-right">
                {summary.customerName}
                <br />
                {[
                  summary.address?.streetAddress,
                  summary.address?.suburb,
                  summary.address?.city,
                  summary.address?.postalCode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </div>
          </dl>
        </>
      ) : null}

      {phase === 'error' ? (
        <>
          <h1 className="mt-2 font-[family-name:var(--font-head)] text-[24px] font-medium text-[var(--text-primary)]">
            Booking not completed
          </h1>
          <p className="mt-2 text-[13.5px] leading-6 text-[var(--text-secondary)]">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void book()}
            className="mt-4 min-h-[44px] rounded-lg px-4 text-[13.5px] font-medium text-white"
            style={{ background: 'var(--action-primary-bg)' }}
          >
            Try again
          </button>
          <p className="mt-3 text-[12px] leading-5 text-[var(--text-tertiary)]">
            If it keeps failing, the order is still paid and visible in the Desk
            under Operate → Motivations → Print &amp; delivery.
          </p>
        </>
      ) : null}

      <p className="mt-8 text-[12px] text-[var(--text-tertiary)]">
        <Link href="/" className="text-[var(--text-tertiary)]">
          ALL Outdoor
        </Link>
      </p>
    </main>
  );
}
