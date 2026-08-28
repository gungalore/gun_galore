'use client';

// Formal complaint intake form. Lodges a Complaint (case number CO000123),
// optionally linked to one of the user's own orders (picked from a list so we
// store the transaction id in the background), with optional evidence photos.
// A buyer's payout-affecting complaint on a still-held order auto-holds payout.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { PhotoDropzone } from '@/components/photo-dropzone';
import { SUPPORT_EMAIL } from '@/lib/brand';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const CATEGORIES = [
  { value: 'ITEM_NOT_AS_DESCRIBED', label: 'Item not as described', item: true },
  { value: 'DAMAGED', label: 'Item arrived damaged', item: true },
  { value: 'NOT_ARRIVED', label: "Item didn't arrive", item: true },
  { value: 'DELIVERY', label: 'Delivery / courier problem', item: false },
  { value: 'PAYOUT', label: 'Payout / payment', item: false },
  { value: 'ACCOUNT', label: 'Account or privacy', item: false },
  { value: 'LISTING', label: 'A listing or another user', item: false },
  // Not payout-affecting by design — see complaints.service.ts. It exists so a
  // buyer who can't reach an item has somewhere real to go instead of filing
  // "Item didn't arrive", which would freeze the seller's money.
  {
    value: 'LOCATION_OR_ACCESS',
    label: "I can't get to the item / it's further than I thought",
    item: true,
  },
  { value: 'OTHER', label: 'Something else', item: false },
];

interface OrderOption {
  id: string;
  title: string;
  ref: string;
  counterparty: string;
  date: string;
  amount: string;
  group: 'Purchases' | 'Sales';
}

interface TxRow {
  id: string;
  buyerTotal: number;
  createdAt: string;
  listing: { title: string; referenceNumber: string | null } | null;
  buyer: { username: string | null };
  seller: { username: string | null };
}

export default function NewComplaintPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [category, setCategory] = useState('ITEM_NOT_AS_DESCRIBED');
  // Order to preselect, sent by the raise-a-dispute flow on a transaction.
  const preselectTx = useSearchParams().get('tx');
  const [transactionId, setTransactionId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; held: boolean } | null>(null);

  const isItemCategory = useMemo(
    () => CATEGORIES.find((c) => c.value === category)?.item ?? false,
    [category],
  );

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? 'Request failed');
      return data;
    },
    [getToken],
  );

  // Load the user's own orders (both sides) for the picker.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const [buys, sales] = await Promise.all([
          authed('/transactions?role=buyer').catch(() => []),
          authed('/transactions?role=seller').catch(() => []),
        ]);
        if (cancelled) return;
        const fmt = (rows: TxRow[], group: 'Purchases' | 'Sales'): OrderOption[] =>
          (rows ?? []).map((t) => ({
            id: t.id,
            title: t.listing?.title ?? 'Item',
            ref: t.listing?.referenceNumber ?? `#${t.id.slice(-8).toUpperCase()}`,
            counterparty:
              group === 'Purchases'
                ? t.seller?.username ?? 'seller'
                : t.buyer?.username ?? 'buyer',
            date: new Date(t.createdAt).toLocaleDateString('en-ZA'),
            amount: `R ${(t.buyerTotal / 100).toFixed(0)}`,
            group,
          }));
        const all = [...fmt(buys, 'Purchases'), ...fmt(sales, 'Sales')];
        setOrders(all);
        // ?tx=<id> preselect. The dispute flow on a transaction page sends the
        // buyer here to attach evidence to THAT order — making them re-find it
        // in a list of every order they've ever placed is exactly the friction
        // that stops evidence being uploaded at all. Only honoured once the
        // orders have loaded and only for an order that is genuinely theirs,
        // so a hand-crafted ?tx= can't attach a complaint to someone else's
        // order (the backend re-checks party membership regardless).
        if (preselectTx && all.some((o) => o.id === preselectTx)) {
          setTransactionId((current) => current || preselectTx);
        }
      } catch {
        /* picker is optional — silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, authed, preselectTx]);

  const purchases = orders.filter((o) => o.group === 'Purchases');
  const sales = orders.filter((o) => o.group === 'Sales');

  async function submit() {
    setError(null);
    if (subject.trim().length < 3) return setError('Add a short subject.');
    if (body.trim().length < 15)
      return setError('Please describe the issue in a bit more detail.');
    setBusy(true);
    try {
      const created = (await authed('/complaints', {
        method: 'POST',
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          body: body.trim(),
          transactionId: transactionId || null,
        }),
      })) as { id: string; referenceNumber: string; drovePayoutHold: boolean };

      // Upload evidence photos one at a time (fresh token per file — the
      // slow-mobile token-expiry fix used by the listing uploader).
      for (const file of photos) {
        const fd = new FormData();
        fd.append('photo', file);
        const token = await getToken();
        await fetch(`${API_URL}/complaints/${created.id}/photos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        }).catch(() => undefined);
      }

      setDone({ ref: created.referenceNumber, held: created.drovePayoutHold });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not lodge the complaint.');
    } finally {
      setBusy(false);
    }
  }

  if (isLoaded && !isSignedIn) {
    return (
      <div style={{ padding: '8px 0' }}>
        <p>
          Please{' '}
          <Link href="/sign-in" style={{ color: 'var(--red)' }}>
            sign in
          </Link>{' '}
          to lodge a formal complaint, so we can link it to your account and
          give you a case number to track. You can also email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div
        style={{
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 20,
          background: 'var(--bg-card)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Complaint lodged ✓</h2>
        <p>
          Your case reference is{' '}
          <strong style={{ fontSize: 18, color: 'var(--red)' }}>{done.ref}</strong>.
          Keep it for your records — we&apos;ll use it in all correspondence.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          We aim to acknowledge within 2 business days and resolve within 14.
          {done.held
            ? ' Because this concerns a paid order, we’ve placed the payout on hold while we investigate.'
            : ''}
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Link
            href="/support"
            style={{
              background: 'var(--red)',
              color: '#fff',
              padding: '8px 14px',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            View my cases
          </Link>
          <button
            onClick={() => {
              setDone(null);
              setSubject('');
              setBody('');
              setPhotos([]);
              setTransactionId('');
            }}
            style={{
              background: 'transparent',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Lodge another
          </button>
        </div>
      </div>
    );
  }

  const labelStyle = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    color: 'var(--text-secondary)',
  } as const;
  const fieldStyle = {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '0.5px solid var(--border)',
    background: 'var(--bg-inset)',
    color: 'var(--text-primary)',
    fontSize: 14,
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
        Lodge a formal complaint. You&apos;ll get a case reference number to
        track it. For quick questions,{' '}
        <Link href="/support" style={{ color: 'var(--red)' }}>
          contact support
        </Link>{' '}
        instead.
      </p>

      <div>
        <label style={labelStyle}>What is your complaint about?</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={fieldStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          Which order? {isItemCategory ? '(required for item complaints)' : '(optional)'}
        </label>
        <select
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          style={fieldStyle}
        >
          <option value="">— Not about a specific order —</option>
          {purchases.length > 0 && (
            <optgroup label="Purchases">
              {purchases.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} · {o.ref} · {o.date} · {o.amount} · from {o.counterparty}
                </option>
              ))}
            </optgroup>
          )}
          {sales.length > 0 && (
            <optgroup label="Sales">
              {sales.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} · {o.ref} · {o.date} · {o.amount} · to {o.counterparty}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {orders.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            No orders found on your account yet.
          </p>
        )}
      </div>

      <div>
        <label style={labelStyle}>Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A one-line summary"
          maxLength={120}
          style={fieldStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Tell us what happened</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Describe the problem in as much detail as you can."
          style={{ ...fieldStyle, resize: 'vertical' }}
        />
      </div>

      {isItemCategory && (
        <div>
          <label style={labelStyle}>
            Photos of the item (strongly recommended)
          </label>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
            Clear photos of the problem — all angles, plus any damage, wrong
            markings or serial numbers — help us resolve it faster. Kept private
            to you and our review team.
          </p>
          <PhotoDropzone
            files={photos}
            onChange={setPhotos}
            minFiles={0}
            maxFiles={6}
          />
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--red)', fontSize: 13, margin: 0 }}>{error}</p>
      )}

      <div>
        <button
          onClick={submit}
          disabled={busy}
          style={{
            background: 'var(--red)',
            color: '#fff',
            padding: '11px 20px',
            borderRadius: 8,
            border: 'none',
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Lodging…' : 'Lodge complaint'}
        </button>
      </div>
    </div>
  );
}
