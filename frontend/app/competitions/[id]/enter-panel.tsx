'use client';

import { useState, FormEvent } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function formatRand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

type Letter = 'A' | 'B' | 'C' | 'D';

export default function EnterPanel({
  raffleId,
  ticketPrice,
  question,
  options,
  ticketsRemaining,
}: {
  raffleId: string;
  ticketPrice: number;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  ticketsRemaining: number;
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  // Hard cap per purchase is 100 tickets (operator rule), but we also
  // refuse to let the buyer pick more than what's actually left in the
  // pool. Backend enforces both, but the picker should never let the
  // user select a quantity that will fail server-side.
  const maxQty = Math.max(0, Math.min(100, ticketsRemaining));
  const [qty, setQty] = useState(maxQty > 0 ? 1 : 0);
  // null = no answer picked yet. The Pay button stays greyed until the
  // user clicks one of the four radios — that's the operator's rule.
  const [answer, setAnswer] = useState<Letter | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{
    refCodes: string[];
    total: number;
  } | null>(null);

  if (!isLoaded) return null;

  if (!user) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm text-center"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        Sign in to enter the competition
      </div>
    );
  }

  // Sold-out edge case — raffle is still ACTIVE but every ticket is
  // accounted for (status flip to CLOSED_AWAITING_DRAW happens on the
  // next confirm/postal-entry, so there's a brief window where we'd
  // otherwise show a buy form for tickets that don't exist).
  if (maxQty === 0) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm text-center"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        All tickets sold — draw pending
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="rounded-[6px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid #16a34a',
        }}
      >
        <p
          className="text-sm mb-3"
          style={{ color: '#16a34a', fontWeight: 500 }}
        >
          You&apos;re in! {done.refCodes.length} ticket{done.refCodes.length === 1 ? '' : 's'} reserved.
        </p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
          Reference codes:
        </p>
        <div className="flex flex-wrap gap-1 mb-3">
          {done.refCodes.map((c) => (
            <code
              key={c}
              className="text-xs px-2 py-1 rounded-[3px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                border: '0.5px solid var(--border)',
              }}
            >
              {c}
            </code>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Total: {formatRand(done.total)}. You&apos;ll receive an email confirmation once the draw runs.
        </p>
        <a
          href="/my/tickets"
          className="block w-full mt-3 py-2.5 rounded-[6px] text-sm text-center"
          style={{
            background: 'var(--red)',
            color: '#fff',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          View my tickets
        </a>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!answer) {
      setError('Pick an answer to the question first');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/raffles/${raffleId}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ quantity: qty, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);

      // Confirm tickets. In dev mode we auto-confirm via the bypass
      // endpoint; in prod this would redirect to a Peach checkout
      // (TODO: full Peach integration for raffle tickets — until that
      // ships, the bypass fails loudly server-side and we surface a
      // clear message rather than the previous silent-success bug
      // that left buyers thinking they had tickets when they didn't).
      const ticketIds: string[] = data.ticketIds ?? [];
      const isDev =
        process.env.NEXT_PUBLIC_ENV !== 'production' &&
        process.env.NODE_ENV !== 'production';

      if (!isDev) {
        throw new Error(
          'Raffle payment integration is being finalised. Your ticket reservation will expire in 30 minutes — please contact support to complete payment manually.',
        );
      }

      const confirmRes = await fetch(`${API_URL}/raffles/tickets/dev-confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketIds }),
      });
      if (!confirmRes.ok) {
        const confirmBody = await confirmRes.json().catch(() => ({}));
        throw new Error(
          confirmBody.message ??
            'Tickets reserved but payment confirmation failed — please contact support before your 30-minute reservation expires.',
        );
      }

      const refCodes = (data.tickets ?? []).map(
        (t: { referenceCode: string }) => t.referenceCode,
      );
      setDone({ refCodes, total: data.totalCents });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enter');
    } finally {
      setSubmitting(false);
    }
  }

  const total = qty * ticketPrice;
  const canPay = answer !== null && !submitting;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Multiple-choice question */}
      <div
        className="rounded-[6px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-xs uppercase mb-2"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
          }}
        >
          Answer to enter
        </p>
        <p
          className="text-sm mb-3"
          style={{ color: 'var(--text-primary)' }}
        >
          {question}
        </p>

        <div className="space-y-2">
          {(['A', 'B', 'C', 'D'] as Letter[]).map((letter) => {
            const selected = answer === letter;
            return (
              <label
                key={letter}
                className="flex items-start gap-3 px-3 py-2.5 rounded-[6px] cursor-pointer"
                style={{
                  background: selected ? 'rgba(200,16,46,0.08)' : 'var(--bg-inset)',
                  border: selected
                    ? '1px solid var(--red)'
                    : '0.5px solid var(--border)',
                }}
              >
                <input
                  type="radio"
                  name="raffle-answer"
                  value={letter}
                  checked={selected}
                  onChange={() => setAnswer(letter)}
                  className="mt-1"
                  style={{ accentColor: 'var(--red)' }}
                />
                <span className="flex-1">
                  <span
                    className="inline-block text-xs mr-2 px-1.5 py-0.5 rounded-[3px]"
                    style={{
                      background: selected ? 'var(--red)' : 'var(--bg-card)',
                      color: selected ? '#fff' : 'var(--text-secondary)',
                      fontWeight: 500,
                      minWidth: '18px',
                      textAlign: 'center',
                    }}
                  >
                    {letter}
                  </span>
                  <span
                    className="text-sm"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {options[letter]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Quantity */}
      <div>
        <label
          className="block text-xs mb-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Tickets ({formatRand(ticketPrice)} each)
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="w-8 h-9 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={maxQty}
            value={qty}
            onChange={(e) =>
              setQty(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))
            }
            className="w-20 px-3 py-2 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            disabled={qty >= maxQty}
            className="w-8 h-9 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: qty >= maxQty ? 'var(--text-tertiary)' : 'var(--text-primary)',
              cursor: qty >= maxQty ? 'not-allowed' : 'pointer',
            }}
          >
            +
          </button>
          <span
            className="ml-auto text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {formatRand(total)}
          </span>
        </div>
        {/* Remaining-tickets hint — only surface when the cap is
            binding (either fewer than 100 are left, or the buyer has
            bumped against the ceiling). Avoids visual clutter on
            fresh raffles with thousands of tickets still in the pool. */}
        {ticketsRemaining < 100 && (
          <p
            className="text-xs mt-1.5"
            style={{
              color: qty >= maxQty ? 'var(--red)' : 'var(--text-tertiary)',
            }}
          >
            {qty >= maxQty
              ? `Only ${ticketsRemaining} ticket${ticketsRemaining === 1 ? '' : 's'} left — that's the most you can buy.`
              : `${ticketsRemaining} ticket${ticketsRemaining === 1 ? '' : 's'} remaining`}
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {/* Pay button — greyed until an answer is picked. */}
      <button
        type="submit"
        disabled={!canPay}
        className="w-full py-3 rounded-[6px] text-sm font-medium"
        style={{
          background: canPay ? 'var(--red)' : 'var(--bg-inset)',
          color: canPay ? '#fff' : 'var(--text-tertiary)',
          cursor: canPay ? 'pointer' : 'not-allowed',
          border: canPay ? 'none' : '0.5px solid var(--border)',
        }}
        title={!answer ? 'Answer the question to enable payment' : undefined}
      >
        {submitting
          ? 'Reserving tickets…'
          : answer
            ? `Pay & Enter — ${formatRand(total)}`
            : 'Answer the question to continue'}
      </button>
    </form>
  );
}
