'use client';

import { useState, FormEvent } from 'react';
import { useUser, useAuth, SignInButton } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function OfferPanel({
  listingId,
  sellerClerkId,
}: {
  listingId: string;
  sellerClerkId: string;
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [autoAccepted, setAutoAccepted] = useState(false);
  const [offerId, setOfferId] = useState('');

  if (!isLoaded) return null;
  // Seller cannot make offers on their own listing
  if (user?.id === sellerClerkId) return null;
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

  if (done && autoAccepted) {
    return (
      <div className="mb-5">
        <div
          className="rounded-[6px] px-4 py-3 mb-3 text-sm text-center"
          style={{ background: '#16a34a20', border: '0.5px solid #16a34a', color: '#16a34a' }}
        >
          Offer auto-accepted! Complete your checkout.
        </div>
        <a
          href={`/checkout/offer/${offerId}`}
          className="block w-full py-3 rounded-[6px] text-sm text-center"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500, textDecoration: 'none' }}
        >
          Complete Checkout
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 mb-5 text-sm text-center"
        style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        Offer submitted — the seller has 48 hours to respond. View it in{' '}
        <a href="/my/offers" style={{ color: 'var(--red)' }}>My Offers</a>.
      </div>
    );
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
      setOfferId(data.offer.id);
      setAutoAccepted(data.autoAccepted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit offer');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-5 space-y-3">
      <div
        className="rounded-[6px] px-4 py-3 text-xs"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', border: '0.5px solid var(--border)' }}
      >
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Take a Shot</span>
        {' '}— name your price. The seller can accept, decline, or counter once. You get one offer.
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
