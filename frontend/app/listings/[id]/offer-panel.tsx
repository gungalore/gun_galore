'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useUser, useAuth, SignInButton } from '@clerk/nextjs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Mirrors backend/src/offers/offers.service.ts MAX_OFFER_ATTEMPTS. Keep in
// sync — the buyer-facing "N of 5" counter is worthless if it drifts from
// the constant the submit endpoint actually enforces.
const MAX_OFFER_ATTEMPTS = 5;

// Only the fields this panel renders. Deliberately a local shape rather than
// lib/types' Offer: that one has no attemptCount, which is the whole point of
// the "you've used N of 5" line.
interface MyOffer {
  id: string;
  status:
    | 'PENDING'
    | 'COUNTERED'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'WITHDRAWN'
    | 'EXPIRED'
    | 'CONVERTED';
  offerAmount: number;
  counterAmount: number | null;
  sellerNote: string | null;
  attemptCount: number;
  expiresAt: string;
  transactionId: string | null;
  listing: { id: string };
}

function rand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

// Relative deadline for the PENDING / COUNTERED / ACCEPTED windows. Computed
// on the client only (this whole panel renders after a fetch), so there's no
// SSR clock to mismatch against.
function timeLeft(iso: string): { text: string; urgent: boolean } | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: 'expired', urgent: true };
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return {
    text: hours >= 1 ? `${hours}h ${mins}m left` : `${mins}m left`,
    urgent: hours < 6,
  };
}

export default function OfferPanel({
  listingId,
  sellerClerkId,
}: {
  listingId: string;
  sellerClerkId: string;
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Backend outcome flags: autoDeclined = at/below the seller's lowball
  // threshold, instantly REJECTED (an attempt was consumed); meetsAutoAccept
  // = at/above their asking threshold, seller pinged to one-tap confirm.
  // There is deliberately NO autoAccepted flag: operator decision 2026-07-23
  // means the backend always returns autoAccepted:false — the seller confirms
  // every accept, so nothing here may ever send a buyer straight to checkout.
  const [autoDeclined, setAutoDeclined] = useState(false);
  const [meetsAutoAccept, setMeetsAutoAccept] = useState(false);

  // The buyer's EXISTING offer on this listing, loaded from the server.
  // Before this the panel only knew about an offer it had just submitted in
  // this browser tab: refresh, and a buyer with a live PENDING offer saw a
  // blank form again and discovered the truth by getting "You already have an
  // active offer on this listing" back from submit. Worse, a seller COUNTER
  // (24h to answer, then it dies) was completely invisible here.
  // `undefined` = not loaded yet, `null` = loaded, no offer on this listing.
  const [mine, setMine] = useState<MyOffer | null | undefined>(undefined);
  const [acting, setActing] = useState(false);
  // Buyer explicitly chose to re-offer after a closed attempt — bypasses the
  // closed-offer card so the form comes back.
  const [showForm, setShowForm] = useState(false);

  const isOwner = isLoaded && user?.id === sellerClerkId;

  // /offers/mine returns every offer this buyer has ever made, each with its
  // listing.id — filter to this listing client-side. No new endpoint needed.
  const loadMine = useCallback(async () => {
    if (!user || isOwner) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/offers/mine`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        // Treat a failed lookup as "no offer" rather than blocking the form —
        // a buyer who genuinely has none must still be able to make one, and
        // the submit endpoint enforces the one-active-offer rule anyway.
        setMine(null);
        return;
      }
      const rows = (await res.json()) as MyOffer[];
      setMine(rows.find((o) => o.listing?.id === listingId) ?? null);
    } catch {
      setMine(null);
    }
  }, [getToken, user, isOwner, listingId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user || isOwner) {
      setMine(null);
      return;
    }
    void loadMine();
  }, [isLoaded, user, isOwner, loadMine]);

  // Buyer-side transitions on an existing offer. All three endpoints exist
  // (offers.controller.ts) and all reload the row afterwards so the card
  // re-renders from server truth, never from an optimistic guess.
  async function act(path: string) {
    setActing(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/offers/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      await loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents < 100) {
      setError('Minimum offer is R1.00');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listingId, offerAmount: cents, buyerNote: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setDone(true);
      setShowForm(false);
      setAutoDeclined(!!data.autoDeclined);
      setMeetsAutoAccept(!!data.meetsAutoAccept);
      // Pull the persisted row in the background so a refresh (or the
      // "try again" path) renders real state instead of the blank form.
      void loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit offer');
      setSubmitting(false);
    }
  }

  if (!isLoaded) return null;
  // Seller cannot make offers on their own listing
  if (isOwner) return null;
  if (!user) {
    return (
      <div className="mb-5">
        <SignInButton mode="modal">
          <button
            type="button"
            className="w-full py-3 rounded-[6px] text-sm font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Sign in to make an offer
          </button>
        </SignInButton>
      </div>
    );
  }

  if (done && autoDeclined) {
    // The offer was at/below the seller's auto-decline threshold and was
    // rejected INSTANTLY — never tell the buyer to wait 48 hours for a
    // response that will not come. It also consumed one of their limited
    // attempts, so say that plainly.
    return (
      <div className="mb-5">
        <div
          className="rounded-[6px] px-4 py-3 mb-2 text-sm text-center"
          style={{ background: '#f59e0b14', border: '0.5px solid var(--warning)', color: 'var(--warning)' }}
        >
          This offer was below the seller&apos;s minimum and was declined
          automatically. You can try a higher offer — attempts are limited, so
          make it count.
        </div>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setAutoDeclined(false);
            setSubmitting(false);
            // Skip the closed-offer card the reload just produced — the buyer
            // has already said they want to try again.
            setShowForm(true);
          }}
          className="block w-full py-2.5 rounded-[6px] text-sm text-center"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          Try a higher offer
        </button>
      </div>
    );
  }

  if (done) {
    // Threshold-met offers get a green card: the seller has been pinged to
    // one-tap confirm, so it is materially closer to a sale than a plain
    // pending offer. It is still NOT accepted — the seller decides — so the
    // copy promises a confirmation, never a checkout.
    return (
      <div
        className="rounded-[6px] px-4 py-3 mb-5 text-sm text-center"
        style={
          meetsAutoAccept
            ? { background: '#16a34a14', border: '0.5px solid var(--success)', color: 'var(--text-secondary)' }
            : { background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }
        }
      >
        {meetsAutoAccept
          ? 'Offer submitted — it meets the seller’s asking price, so they’ve been pinged to confirm. '
          : 'Offer submitted — the seller has 48 hours to respond. '}
        View it in{' '}
        <a href="/my/offers" style={{ color: 'var(--red)' }}>My Offers</a>.
      </div>
    );
  }

  if (mine === undefined) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 mb-5 text-sm text-center"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        Checking your offers…
      </div>
    );
  }

  // An offer still in play — never show a blank submit form over the top of
  // it. The seller's counter in particular is time-boxed (24h) and this is
  // the surface the buyer comes back to.
  if (mine && ['PENDING', 'COUNTERED', 'ACCEPTED', 'CONVERTED'].includes(mine.status)) {
    return (
      <ExistingOfferCard
        offer={mine}
        acting={acting}
        error={error}
        onWithdraw={() => act(`${mine.id}/withdraw`)}
        onAcceptCounter={() => act(`${mine.id}/accept-counter`)}
        onRejectCounter={() => act(`${mine.id}/reject-counter`)}
      />
    );
  }

  // A closed offer (rejected / withdrawn / expired). The row survives and its
  // attemptCount is what the 5-attempt cap is enforced against, so show the
  // count before the buyer burns another one.
  if (mine && !showForm) {
    const used = mine.attemptCount;
    const spent = used >= MAX_OFFER_ATTEMPTS;
    const closedLabel: Record<string, string> = {
      REJECTED: 'The seller declined your offer of',
      WITHDRAWN: 'You withdrew your offer of',
      EXPIRED: 'Your offer expired without a response —',
    };
    return (
      <div className="mb-5">
        <div
          className="rounded-[6px] px-4 py-3 mb-2 text-sm"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          <p>
            {closedLabel[mine.status] ?? 'Your last offer:'}{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {rand(mine.offerAmount)}
            </strong>
            .
          </p>
          {mine.sellerNote && (
            <p className="mt-1 italic" style={{ color: 'var(--text-tertiary)' }}>
              Seller: &ldquo;{mine.sellerNote}&rdquo;
            </p>
          )}
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
            You&apos;ve used {used} of {MAX_OFFER_ATTEMPTS} offers on this
            listing.
          </p>
        </div>
        {spent ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            That&apos;s all {MAX_OFFER_ATTEMPTS} attempts used — you can&apos;t
            make another offer on this listing.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="block w-full py-2.5 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Make another offer
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-5 space-y-3">
      <div
        className="rounded-[6px] px-4 py-3 text-xs"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', border: '0.5px solid var(--border)' }}
      >
        {/* Copy mirrors the backend policy constants in
            backend/src/offers/offers.service.ts — MAX_OFFER_ATTEMPTS = 5,
            OFFER_TTL_HOURS = 48, COUNTER_TTL_HOURS = 24, and one counter per
            offer. Keep the numbers in sync if those constants change. */}
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Take a Shot</span>
        {' '}— name your price. The seller has 48 hours to accept, decline, or
        counter once (you then get 24 hours to answer the counter). You can
        make up to {MAX_OFFER_ATTEMPTS} offers on this listing, so make each
        one count.
        {mine && (
          <>
            {' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              You&apos;ve used {mine.attemptCount} of {MAX_OFFER_ATTEMPTS} so
              far.
            </span>
          </>
        )}
      </div>

      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Your offer (ZAR)
        </label>
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            R
          </span>
          <input
            type="number"
            min="1"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full pl-7 pr-3 py-2.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Note to seller (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. Local pickup preferred"
          className="w-full px-3 py-2 rounded-[6px] text-sm resize-none"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          No phone numbers, emails, or social handles — once payment goes through, the platform handles handoff.
        </p>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-[6px] text-sm font-medium"
        style={{
          background: submitting ? 'var(--bg-inset)' : 'var(--red)',
          color: submitting ? 'var(--text-tertiary)' : '#fff',
        }}
      >
        {submitting ? 'Submitting…' : 'Submit Offer'}
      </button>
    </form>
  );
}

// ─── The buyer's live offer on this listing ─────────────────────────
// PENDING → amount + expiry + withdraw. COUNTERED → the counter amount with
// accept/decline (this was previously invisible outside /my/offers, and the
// counter dies in 24h). ACCEPTED → the pay link. CONVERTED → done, point at
// My Orders.
function ExistingOfferCard({
  offer,
  acting,
  error,
  onWithdraw,
  onAcceptCounter,
  onRejectCounter,
}: {
  offer: MyOffer;
  acting: boolean;
  error: string;
  onWithdraw: () => void;
  onAcceptCounter: () => void;
  onRejectCounter: () => void;
}) {
  const left = timeLeft(offer.expiresAt);
  const settled = offer.counterAmount ?? offer.offerAmount;

  const secondary: React.CSSProperties = {
    background: 'var(--bg-inset)',
    color: 'var(--text-secondary)',
    border: '0.5px solid var(--border)',
    cursor: acting ? 'not-allowed' : 'pointer',
    opacity: acting ? 0.6 : 1,
  };

  return (
    <div
      className="rounded-[6px] px-4 py-4 mb-5 text-sm"
      style={{
        background: 'var(--bg-card)',
        border:
          offer.status === 'COUNTERED'
            ? '0.5px solid var(--info)'
            : '0.5px solid var(--border)',
        color: 'var(--text-secondary)',
        lineHeight: 1.55,
      }}
    >
      <p className="text-xs uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
        Your offer
      </p>
      <p className="mt-1">
        You offered{' '}
        <strong style={{ color: 'var(--text-primary)' }}>
          {rand(offer.offerAmount)}
        </strong>
        .
      </p>

      {offer.status === 'PENDING' && (
        <>
          <p className="mt-1">
            Waiting on the seller — they can accept, decline, or counter once.
            {left && (
              <>
                {' '}
                <span style={{ color: left.urgent ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                  ({left.text} to respond)
                </span>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={onWithdraw}
            disabled={acting}
            className="block w-full mt-3 py-2.5 rounded-[6px] text-sm text-center"
            style={secondary}
          >
            {acting ? 'Working…' : 'Withdraw offer'}
          </button>
        </>
      )}

      {offer.status === 'COUNTERED' && (
        <>
          <p className="mt-1">
            The seller countered at{' '}
            <strong style={{ color: 'var(--info)' }}>
              {rand(offer.counterAmount ?? 0)}
            </strong>
            . Accept or decline — sellers only get one counter, so this is
            final.
            {left && (
              <>
                {' '}
                <span style={{ color: left.urgent ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                  ({left.text} to answer — after that the counter lapses.)
                </span>
              </>
            )}
          </p>
          {offer.sellerNote && (
            <p className="mt-1 italic text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Seller: &ldquo;{offer.sellerNote}&rdquo;
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={onAcceptCounter}
              disabled={acting}
              className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
              style={{
                background: 'var(--red)',
                color: '#fff',
                border: 'none',
                cursor: acting ? 'not-allowed' : 'pointer',
                opacity: acting ? 0.6 : 1,
              }}
            >
              Accept {rand(offer.counterAmount ?? 0)}
            </button>
            <button
              type="button"
              onClick={onRejectCounter}
              disabled={acting}
              className="flex-1 py-2.5 rounded-[6px] text-sm"
              style={secondary}
            >
              Decline
            </button>
          </div>
        </>
      )}

      {offer.status === 'ACCEPTED' && (
        <>
          <p className="mt-1" style={{ color: 'var(--success)' }}>
            Accepted at {rand(settled)}.
            {left && (
              <>
                {' '}
                <span style={{ color: left.urgent ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                  ({left.text} to complete checkout — after that the offer
                  expires and the listing goes back on sale.)
                </span>
              </>
            )}
          </p>
          <a
            href={`/checkout/offer/${offer.id}`}
            className="block w-full mt-3 py-3 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Complete checkout — {rand(settled)}
          </a>
        </>
      )}

      {offer.status === 'CONVERTED' && (
        <p className="mt-1">
          Purchased at {rand(settled)} — track it in{' '}
          <a href="/my/orders" style={{ color: 'var(--red)' }}>
            My Orders
          </a>
          .
        </p>
      )}

      {error && (
        <p className="text-xs mt-2" role="alert" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
        Full history in{' '}
        <a href="/my/offers" style={{ color: 'var(--red)' }}>
          My Offers
        </a>
        .
      </p>
    </div>
  );
}
