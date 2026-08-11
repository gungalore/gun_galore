'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

function formatRand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Shape of GET /transactions/:id/experience/cancel-quote (mirrors
// TransactionsService.getExperienceCancelQuote).
interface CancelQuote {
  transactionId: string;
  buyerTotalCents: number;
  eventDate: string | null;
  tierLabel: string;
  refundCents: number;
  retainedCents: number;
  outfitterReleaseCents: number;
  ggRetainedCents: number;
  adminFeeCents: number;
  exemptReason: string | null;
  summary: string;
}

// Hunting Packages / Experiences (Phase E) — the order-page lifecycle panel.
// Renders on /transactions/[id] when the booking is an experience
// (listing.isExperience + shippingMethod ON_SITE_SERVICE). It drives the
// three actor flows off the existing experience endpoints:
//   • outfitter (seller): Accept / Decline while HELD + unaccepted
//   • buyer: a live CPA-s17 cancel quote + Cancel, "Confirm the experience
//     happened" (enabled on/after eventDate), and a Dispute escape hatch
// Payment stays HELD until the buyer confirms completion (or a cancellation
// / dispute resolves it). No money moves in this component beyond the POSTs.
export default function ExperienceOrderPanel({
  transactionId,
  role,
  paymentStatus,
  eventDate,
  bookingConfirmedAt,
  bookingDeclinedAt,
  eventCompletedConfirmedAt,
}: {
  transactionId: string;
  role: 'buyer' | 'seller' | 'other';
  paymentStatus: string;
  eventDate: string | null;
  bookingConfirmedAt: string | null;
  bookingDeclinedAt: string | null;
  eventCompletedConfirmedAt: string | null;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const isHeld = paymentStatus === 'HELD';
  const isBuyer = role === 'buyer';
  const isSeller = role === 'seller';

  async function post(path: string, body?: Record<string, unknown>) {
    setBusy(path);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  // The buyer can confirm the experience happened only on/after the event
  // date (the backend enforces `now >= eventDate` too).
  const eventPassed =
    !!eventDate && new Date(eventDate).getTime() <= Date.now();

  return (
    <div className="space-y-3">
      {error && (
        <p
          className="text-xs p-2 rounded-[6px]"
          style={{
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
          }}
        >
          {error}
        </p>
      )}

      {/* Outfitter (seller): Accept / Decline while HELD and undecided. */}
      {isSeller &&
        isHeld &&
        !bookingConfirmedAt &&
        !bookingDeclinedAt && (
          <div
            className="rounded-[8px] p-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--red)',
            }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{
                color: 'var(--red)',
                letterSpacing: '0.06em',
                fontWeight: 600,
              }}
            >
              Action needed
            </p>
            <p
              className="text-sm mb-1"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Confirm you&apos;ll honour this booking
            </p>
            <p
              className="text-xs mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              The guest has paid and the funds are held by All Outdoor. Accept to
              confirm the booking, or decline for a full refund. Your payout is
              released after the guest confirms the experience happened.
            </p>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                post(`/transactions/${transactionId}/experience/accept`)
              }
              className="w-full py-3 px-4 rounded-[8px] text-sm mb-2"
              style={{
                background: busy ? 'var(--bg-inset)' : 'var(--red)',
                color: busy ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                fontWeight: 500,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy?.endsWith('/accept') ? 'Accepting…' : 'Accept booking'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                post(`/transactions/${transactionId}/experience/decline`)
              }
              className="w-full py-2.5 px-4 rounded-[6px] text-xs"
              style={{
                background: 'transparent',
                border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy?.endsWith('/decline')
                ? 'Declining…'
                : 'Decline — refund the guest'}
            </button>
          </div>
        )}

      {/* Seller: outfitter-cancel while still HELD after accepting (supplier
          can't make the date after all → full refund to the buyer). */}
      {isSeller && isHeld && !!bookingConfirmedAt && !eventCompletedConfirmedAt && (
        <div
          className="rounded-[8px] p-4"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p
            className="text-sm font-medium mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Can&apos;t honour this booking?
          </p>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
          >
            If you can no longer run this experience, cancel here — the guest is
            refunded in full. Repeated supplier cancellations affect your
            standing.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              post(`/transactions/${transactionId}/experience/outfitter-cancel`)
            }
            className="text-sm px-3 py-1.5 rounded-md"
            style={{
              background: 'transparent',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy?.endsWith('/outfitter-cancel')
              ? 'Cancelling…'
              : 'Cancel & refund the guest'}
          </button>
        </div>
      )}

      {/* Buyer: awaiting outfitter accept chip. */}
      {isBuyer && isHeld && !bookingConfirmedAt && !bookingDeclinedAt && (
        <div
          className="rounded-[8px] px-4 py-3"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '0.5px solid rgba(245,158,11,0.45)',
            lineHeight: 1.55,
          }}
        >
          <p
            className="text-xs uppercase mb-1"
            style={{ color: '#f59e0b', letterSpacing: '0.06em', fontWeight: 600 }}
          >
            Awaiting outfitter confirmation
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Your payment is held safely by All Outdoor. The outfitter will
            confirm your booking shortly. If they decline, you&apos;re refunded
            in full.
          </p>
        </div>
      )}

      {/* Buyer: confirm the experience happened (on/after the event date). */}
      {isBuyer &&
        isHeld &&
        !!bookingConfirmedAt &&
        !eventCompletedConfirmedAt && (
          <div
            className="rounded-[8px] p-4 space-y-3"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <div>
              <p
                className="text-sm font-medium mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                Did the experience happen?
              </p>
              <p
                className="text-xs mb-3"
                style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
              >
                Confirming releases payment to the outfitter and is final.
                {eventPassed
                  ? ' If something went wrong, raise a dispute instead — payment stays held while we review.'
                  : ` You can confirm from ${
                      eventDate
                        ? new Date(eventDate).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'the event date'
                    } onwards.`}
              </p>
              <button
                type="button"
                disabled={!eventPassed || !!busy}
                onClick={() =>
                  post(
                    `/transactions/${transactionId}/experience/confirm-completed`,
                  )
                }
                className="w-full py-2.5 rounded-[6px] text-sm"
                style={{
                  background:
                    eventPassed && !busy ? '#00a03c' : 'var(--bg-inset)',
                  color:
                    eventPassed && !busy ? '#fff' : 'var(--text-tertiary)',
                  border: 'none',
                  fontWeight: 500,
                  cursor: eventPassed && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {busy?.endsWith('/confirm-completed')
                  ? 'Releasing…'
                  : 'Confirm the experience happened'}
              </button>
            </div>
            {!disputeOpen ? (
              <button
                type="button"
                onClick={() => setDisputeOpen(true)}
                className="text-xs"
                style={{
                  background: 'transparent',
                  color: 'var(--red)',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Something went wrong — raise a dispute instead
              </button>
            ) : (
              <div
                className="rounded-[6px] p-3 space-y-2"
                style={{
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--red)',
                }}
              >
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
                >
                  Tell us what went wrong. Your payment stays held while an
                  admin reviews — don&apos;t confirm the experience until it&apos;s
                  resolved.
                </p>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Describe the problem (min 3 characters)"
                  className="w-full p-2 rounded-[6px] text-sm"
                  style={{
                    background: 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDisputeOpen(false)}
                    disabled={!!busy}
                    className="flex-1 py-2 rounded text-sm"
                    style={{
                      background: 'transparent',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={disputeReason.trim().length < 3 || !!busy}
                    onClick={() =>
                      post(`/transactions/${transactionId}/experience/dispute`, {
                        reason: disputeReason.trim(),
                      })
                    }
                    className="flex-1 py-2 rounded text-sm font-medium"
                    style={{
                      background:
                        disputeReason.trim().length < 3 || busy
                          ? 'var(--bg-card)'
                          : 'var(--red)',
                      color:
                        disputeReason.trim().length < 3 || busy
                          ? 'var(--text-tertiary)'
                          : '#fff',
                      border: 'none',
                      cursor:
                        disputeReason.trim().length < 3 || busy
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {busy?.endsWith('/dispute') ? 'Submitting…' : 'Raise dispute'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Buyer: live CPA-s17 cancel quote + Cancel. Shown while HELD and the
          buyer hasn't already confirmed completion. Shows the tier + the
          refund / retained split so the buyer sees the consequence before
          committing. */}
      {isBuyer && isHeld && !eventCompletedConfirmedAt && (
        <BuyerCancelQuote
          transactionId={transactionId}
          busy={busy}
          onCancel={() =>
            post(`/transactions/${transactionId}/experience/cancel`)
          }
        />
      )}

    </div>
  );
}

// Buyer-facing live cancel quote. Fetches GET .../experience/cancel-quote on
// mount so the buyer sees exactly what a cancellation costs them under the
// CPA-s17 tiered policy, then a two-tap Cancel confirmation.
function BuyerCancelQuote({
  transactionId,
  busy,
  onCancel,
}: {
  transactionId: string;
  busy: string | null;
  onCancel: () => void;
}) {
  const { getToken } = useAuth();
  const [quote, setQuote] = useState<CancelQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_URL}/transactions/${transactionId}/experience/cancel-quote`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(j.message ?? `Error ${res.status}`);
        }
        const data = (await res.json()) as CancelQuote;
        if (!cancelled) setQuote(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Could not load cancel quote',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId, getToken]);

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-sm font-medium mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        Need to cancel?
      </p>
      {loadError ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {loadError}
        </p>
      ) : !quote ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Calculating your cancellation quote…
        </p>
      ) : (
        <>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            {quote.summary}
          </p>
          <div
            className="rounded-[6px] p-3 mb-3 text-xs space-y-1.5"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
            }}
          >
            <QuoteRow label="Cancellation tier" value={quote.tierLabel} />
            <QuoteRow
              label="Refunded to you"
              value={formatRand(quote.refundCents)}
              highlight="#00a03c"
            />
            {quote.retainedCents > 0 && (
              <QuoteRow
                label="Retained under policy"
                value={formatRand(quote.retainedCents)}
              />
            )}
            {quote.adminFeeCents > 0 && (
              <QuoteRow
                label="Admin fee"
                value={formatRand(quote.adminFeeCents)}
              />
            )}
          </div>

          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-sm px-3 py-1.5 rounded-md"
              style={{
                background: 'transparent',
                border: '0.5px solid var(--red)',
                color: 'var(--red)',
                cursor: 'pointer',
              }}
            >
              Cancel this booking
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!!busy}
                className="flex-1 py-2 rounded text-sm"
                style={{
                  background: 'transparent',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={!!busy}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy?.endsWith('/cancel')
                  ? 'Cancelling…'
                  : `Confirm — refund ${formatRand(quote.refundCents)}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuoteRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: highlight ?? 'var(--text-primary)', fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}
