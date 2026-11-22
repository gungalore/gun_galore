'use client';

// ────────────────────────────────────────────────────────────────────
// MOTIVATION SUPPORT — the timeline behind a bug report.
//
// Operator, 2026-11-21: "we need to log every motivation activities so we can
// pin point every move of the user ... in the report a bug we need the user
// name so we can go into the logs and pin point the exact issue."
//
// This is that "go into the logs". A report arrives as `@name` (or an MO
// reference); paste either into the box and the exact sequence of steps is
// here, newest first. The rows are already free of answer values — they carry
// field KEYS, counts and page names, never what was typed.
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, NeonCard, Pill } from '@/components/admin/admin-ui';
import { adminFetch, formatWhen } from '@/lib/admin-api';

interface PrintOrderRow {
  id: string;
  reference: string;
  status: string;
  totalCents: number;
  printFeeCents: number;
  shippingCents: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  deliveryAddress: {
    streetAddress?: string;
    address2?: string;
    suburb?: string;
    city?: string;
    postalCode?: string;
    province?: string;
  } | null;
  serviceName: string | null;
  pdfEmailedAt: string | null;
  bookedAt: string | null;
  bobgoTrackingReference: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  createdAt: string;
  motivation: {
    id: string;
    referenceNumber: string;
    outputMode: string;
    user: { username: string } | null;
  } | null;
}

/**
 * PRINT AND DELIVER — the only place a courier is booked.
 *
 * ⚠️ THE BOOKING SPENDS THE BOB GO WALLET, SO IT ASKS FIRST. Everything above
 * this card is a support read; a mis-click here hands a parcel to a courier.
 * The button is also disabled until the desk email has gone out, because there
 * is nothing to collect before the PDF exists.
 */
function PrintQueue() {
  const [rows, setRows] = useState<PrintOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch<PrintOrderRow[]>(
        '/admin/motivations/print-orders?status=PAID,BOOKING',
      );
      setRows(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, path: 'book' | 'resend-pdf' | 'recheck') {
    if (
      path === 'book' &&
      !window.confirm(
        'Book the Bob Go collection now? This spends the courier wallet and cannot be undone from here.',
      )
    ) {
      return;
    }
    setBusy(`${id}:${path}`);
    setError(null);
    try {
      await adminFetch(`/admin/motivations/print-orders/${id}/${path}`, {
        method: 'POST',
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading && rows.length === 0) {
    return (
      <NeonCard title="Print & delivery">
        <p className="m-0 text-[13px] text-[var(--text-tertiary)]">Loading…</p>
      </NeonCard>
    );
  }

  return (
    <NeonCard title={`Print & delivery (${rows.length})`}>
      {rows.length === 0 ? (
        <EmptyState
          icon="layers"
          title="Nothing waiting"
          caption="Paid Print and Deliver orders appear here with the PDF already emailed to the print desk."
        />
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((r) => {
            const address = r.deliveryAddress
              ? [
                  r.deliveryAddress.streetAddress,
                  r.deliveryAddress.suburb,
                  r.deliveryAddress.city,
                  r.deliveryAddress.postalCode,
                ]
                  .filter(Boolean)
                  .join(', ')
              : '—';
            return (
              <li
                key={r.id}
                className="border-b border-[var(--border-divider)] py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[12.5px] text-[var(--text-primary)]">
                    {r.reference}
                  </span>
                  <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                    {r.motivation?.referenceNumber ?? '—'}
                  </span>
                  <Pill
                    tone={
                      r.status === 'BOOKED'
                        ? 'green'
                        : r.status === 'PAID'
                          ? 'amber'
                          : 'cyan'
                    }
                  >
                    {r.status}
                  </Pill>
                  <span className="text-[11.5px] text-[var(--text-tertiary)]">
                    {formatWhen(r.createdAt)}
                  </span>
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {r.contactName}
                  {r.motivation?.user?.username
                    ? ` · @${r.motivation.user.username}`
                    : ''}{' '}
                  · {r.contactPhone} · {address}
                </div>
                <div className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">
                  R{(r.totalCents / 100).toFixed(0)} add-on (print R
                  {(r.printFeeCents / 100).toFixed(0)} + delivery R
                  {(r.shippingCents / 100).toFixed(0)})
                  {r.serviceName ? ` · ${r.serviceName}` : ''}
                  {' · '}
                  {r.pdfEmailedAt
                    ? `PDF emailed ${formatWhen(r.pdfEmailedAt)}`
                    : 'PDF not emailed yet'}
                  {r.bobgoTrackingReference
                    ? ` · tracking ${r.bobgoTrackingReference}`
                    : ''}
                </div>
                {r.failureReason ? (
                  <p className="m-0 mt-1 text-[11.5px] text-[var(--red)]">
                    {r.failureReason}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  {r.status === 'PAID' ? (
                    <button
                      type="button"
                      disabled={!r.pdfEmailedAt || busy !== null}
                      onClick={() => void act(r.id, 'book')}
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                      style={{ background: 'var(--red)' }}
                      title={
                        r.pdfEmailedAt
                          ? 'Book the Bob Go collection'
                          : 'Wait for the PDF email before booking'
                      }
                    >
                      {busy === `${r.id}:book`
                        ? 'Booking…'
                        : 'Printed — book Bob Go collection'}
                    </button>
                  ) : null}
                  {r.status === 'BOOKING' ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void act(r.id, 'recheck')}
                      className="rounded-md border px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] disabled:opacity-50"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      Re-check booking
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(r.id, 'resend-pdf')}
                    className="text-[12px] text-[var(--text-tertiary)] underline disabled:opacity-50"
                  >
                    Resend PDF
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p className="mt-2 text-[12.5px] text-[var(--red)]">{error}</p>
      ) : null}
    </NeonCard>
  );
}

interface ActivityRow {
  id: string;
  motivationId: string | null;
  motivationRef: string;
  action: string;
  detail: Record<string, unknown> | null;
  path: string | null;
  createdAt: string;
}

interface MotivationSummaryRow {
  id: string;
  referenceNumber: string;
  status: string;
  createdAt: string;
}

interface Result {
  found: boolean;
  member: string | null;
  motivations: MotivationSummaryRow[];
  activity: ActivityRow[];
}

function detailText(detail: Record<string, unknown> | null): string {
  if (!detail) return '';
  return Object.entries(detail)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : String(value)}`)
    .join('  ');
}

export default function MotivationSupportPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (raw: string) => {
    const value = raw.trim().replace(/^@/, '');
    if (!value) {
      setError('Type a username, an MO reference or a motivation id.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // One box, three shapes: an MO number, a @handle, or a raw id.
      const isRef = /^MO\d+$/i.test(value);
      const isId = /^c[a-z0-9]{20,}$/i.test(value);
      const param = isRef
        ? `ref=${encodeURIComponent(value.toUpperCase())}`
        : isId
          ? `motivationId=${encodeURIComponent(value)}`
          : `username=${encodeURIComponent(value)}`;
      const data = await adminFetch<Result>(`/admin/motivations/activity?${param}`);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep-linked from the support email: ?ref=MO000123 or ?username=name.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const seed = params.get('ref') ?? params.get('username') ?? params.get('motivationId');
    if (!seed) return;
    setQuery(seed);
    void lookup(seed);
  }, [lookup]);

  /**
   * Put a failed application back in the rebuild queue after fixing the cause.
   *
   * The automatic attempts run out after a few hours of backoff; this is the
   * operator's "go again" — the retry cron picks it up within five minutes, so
   * the button does not hold the request open on a model run.
   */
  const requeue = useCallback(
    async (motivationId: string) => {
      try {
        await adminFetch(`/admin/motivations/${motivationId}/retry`, {
          method: 'POST',
        });
        setError(null);
        await lookup(query);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [lookup, query],
  );

  return (
    <div className="flex flex-col gap-4">
      <NeonCard title="Motivation support">
        <p className="text-[13px] text-[var(--text-secondary)] m-0 mb-3">
          Paste a member&apos;s <strong>@username</strong>, an{' '}
          <strong>MO reference</strong> or a motivation id. The timeline is
          newest first and carries field keys, not answers.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void lookup(query);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="@username, MO000123 or a motivation id"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {loading ? 'Looking…' : 'Look up'}
          </button>
        </form>
        {error ? (
          <p className="mt-2 text-[12.5px] text-[var(--red)]">{error}</p>
        ) : null}
      </NeonCard>

      <PrintQueue />

      {result && !result.found ? (
        <NeonCard title="No match">
          <EmptyState
            icon="search"
            title="Nothing found"
            caption="Check the username or reference. A deleted account returns nothing; a deleted application still leaves its timeline under the MO reference."
          />
        </NeonCard>
      ) : null}

      {result?.found ? (
        <NeonCard title={result.member ? `@${result.member}` : 'Timeline'}>
          {result.motivations.length > 0 ? (
            <ul className="m-0 mb-3 list-none p-0">
              {result.motivations.map((motivation) => (
                <li
                  key={motivation.id}
                  className="mb-1 flex items-center justify-between gap-2 text-[12.5px]"
                >
                  <span className="font-mono text-[var(--text-secondary)]">
                    {motivation.referenceNumber}
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone={motivation.status === 'COMPLETED' ? 'green' : 'amber'}>
                      {motivation.status}
                    </Pill>
                    <button
                      type="button"
                      className="underline text-[var(--text-tertiary)]"
                      onClick={() => {
                        setQuery(motivation.referenceNumber);
                        void lookup(motivation.referenceNumber);
                      }}
                    >
                      Only this one
                    </button>
                    <button
                      type="button"
                      className="underline text-[var(--red)]"
                      title="Queue an automatic rebuild now. The retry cron picks it up within five minutes."
                      onClick={() => void requeue(motivation.id)}
                    >
                      Re-queue
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.activity.length === 0 ? (
            <EmptyState icon="clock" title="No activity yet" caption="Nothing has been recorded for this application." />
          ) : (
            <ul className="m-0 list-none p-0">
              {result.activity.map((row) => (
                <li
                  key={row.id}
                  className="border-b border-[var(--border-divider)] py-2 text-[12px] last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[var(--text-tertiary)]">
                      {formatWhen(row.createdAt)}
                    </span>
                    <span className="font-mono text-[var(--text-primary)]">
                      {row.action}
                    </span>
                    <span className="font-mono text-[var(--text-tertiary)]">
                      {row.motivationRef}
                    </span>
                  </div>
                  {detailText(row.detail) ? (
                    <div className="mt-0.5 break-words font-mono text-[11px] text-[var(--text-secondary)]">
                      {detailText(row.detail)}
                    </div>
                  ) : null}
                  {row.path ? (
                    <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                      {row.path}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </NeonCard>
      ) : null}
    </div>
  );
}
