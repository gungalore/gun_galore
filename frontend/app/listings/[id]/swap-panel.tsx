'use client';

// Swap / Trade panel on the listing detail page (SWOP S2).
//
//  • Owner   → sees received proposals; can Accept / Reject / Counter the cash.
//  • Viewer  → proposes a swap (one of their SWOP listings ± cash), or, if they
//              already have one, sees its status + can withdraw / act on a counter.
//  • Anon    → prompted to sign in.
//
// Money: a swap has no sale price. Funding (cash top-up) + shipping are
// arranged after both sides agree (S3+). This panel is negotiation only.

import { useEffect, useState, useCallback, FormEvent } from 'react';
import { useUser, useAuth, SignInButton } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

type SwapRole = 'INITIATOR_GIVES' | 'OWNER_GIVES';

interface Offerable {
  id: string;
  title: string;
  images: { url: string }[];
}
interface MiniListing {
  id: string;
  title: string;
  images?: { url: string }[];
}
interface Proposal {
  id: string;
  status: string;
  cashAmount: number;
  cashDirection: SwapRole | null;
  counterCashAmount: number | null;
  counterCashDirection: SwapRole | null;
  proposerNote: string | null;
  ownerNote: string | null;
  listing: MiniListing;
  offeredListing: MiniListing;
  proposer: { username: string | null };
  owner: { username: string | null };
}
interface ForListing {
  role: 'owner' | 'viewer' | 'anon';
  proposals: Proposal[];
}

function rand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA')}`;
}

const card: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
};
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 14,
  width: '100%',
};

export default function SwapPanel({
  listingId,
  sellerClerkId,
  isOwnListing,
}: {
  listingId: string;
  sellerClerkId: string;
  isOwnListing: boolean;
}) {
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();

  const [data, setData] = useState<ForListing | null>(null);
  const [offerable, setOfferable] = useState<Offerable[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const authedFetch = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(opts.headers ?? {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
      return body;
    },
    [getToken],
  );

  const load = useCallback(async () => {
    try {
      const d = (await authedFetch(
        `/swaps/proposals/for-listing/${listingId}`,
      )) as ForListing;
      setData(d);
      // A signed-in viewer with no proposal yet → fetch their offerable items.
      if (d.role === 'viewer' && d.proposals.length === 0) {
        const o = (await authedFetch(
          `/swaps/proposals/offerable?exclude=${listingId}`,
        )) as Offerable[];
        setOfferable(o);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load swap details');
    }
  }, [authedFetch, listingId]);

  useEffect(() => {
    if (isLoaded && user) void load();
  }, [isLoaded, user, load]);

  if (!isLoaded) return null;

  // Anon — prompt sign-in.
  if (!user) {
    return (
      <div className="mb-5" style={{ ...card, padding: 16 }}>
        <div className="text-sm mb-2" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          Open to swaps
        </div>
        <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The owner wants to trade this item. Sign in to propose a swap from your
          own listings.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="w-full py-3 rounded-[6px] text-sm font-medium"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Sign in to propose a swap
          </button>
        </SignInButton>
      </div>
    );
  }

  const refresh = async () => {
    setOfferable(null);
    await load();
  };

  async function act(path: string, body?: unknown, okMsg?: string) {
    setBusy(true);
    setError('');
    try {
      await authedFetch(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      if (okMsg) setFlash(okMsg);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5" style={{ ...card, padding: 16 }}>
      <div className="text-sm mb-3" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {data?.role === 'owner' || isOwnListing ? 'Swap proposals' : 'Propose a swap'}
      </div>

      {flash && (
        <p className="text-xs mb-2" style={{ color: '#16a34a' }}>
          {flash}
        </p>
      )}
      {error && (
        <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      )}

      {data?.role === 'owner' && (
        <OwnerView proposals={data.proposals} busy={busy} act={act} />
      )}

      {data?.role === 'viewer' && data.proposals.length > 0 && (
        <ViewerProposalView proposal={data.proposals[0]} busy={busy} act={act} />
      )}

      {data?.role === 'viewer' && data.proposals.length === 0 && (
        <ProposeForm
          listingId={listingId}
          offerable={offerable}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          authedFetch={authedFetch}
          onDone={async () => {
            setFlash('Swap proposed — the owner has 48 hours to respond.');
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Owner: received proposals ──────────────────────────────────────────
function OwnerView({
  proposals,
  busy,
  act,
}: {
  proposals: Proposal[];
  busy: boolean;
  act: (path: string, body?: unknown, okMsg?: string) => Promise<void>;
}) {
  if (proposals.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        No open swap proposals yet. When someone proposes a trade, you’ll be able
        to accept, decline, or counter the cash here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {proposals.map((p) => (
        <OwnerProposalCard key={p.id} p={p} busy={busy} act={act} />
      ))}
    </div>
  );
}

function cashSummary(p: Proposal): string {
  const useCounter = p.status === 'COUNTERED';
  const amt = useCounter ? p.counterCashAmount ?? 0 : p.cashAmount;
  const dir = useCounter ? p.counterCashDirection : p.cashDirection;
  if (!amt) return 'No cash top-up';
  return dir === 'INITIATOR_GIVES'
    ? `They add ${rand(amt)} cash`
    : `You add ${rand(amt)} cash`;
}

function OwnerProposalCard({
  p,
  busy,
  act,
}: {
  p: Proposal;
  busy: boolean;
  act: (path: string, body?: unknown, okMsg?: string) => Promise<void>;
}) {
  const [countering, setCountering] = useState(false);
  const [cash, setCash] = useState('');
  const [dir, setDir] = useState<SwapRole>('INITIATOR_GIVES');
  const [note, setNote] = useState('');

  return (
    <div style={{ ...card, padding: 12 }}>
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
        <strong>{p.proposer.username ?? 'A member'}</strong> offers their{' '}
        <strong>{p.offeredListing.title}</strong> for your{' '}
        <strong>{p.listing.title}</strong>.
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
        {cashSummary(p)}
        {p.status === 'COUNTERED' ? ' · you countered — awaiting their reply' : ''}
      </p>
      {p.proposerNote && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          “{p.proposerNote}”
        </p>
      )}

      {p.status === 'PENDING' && !countering && (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/swaps/proposals/${p.id}/accept`, undefined, 'Swap agreed!')}
            className="flex-1 py-2 rounded-[6px] text-sm font-medium"
            style={{ background: 'var(--red)', color: '#fff' }}
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setCountering(true)}
            className="flex-1 py-2 rounded-[6px] text-sm"
            style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            Counter cash
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/swaps/proposals/${p.id}/reject`)}
            className="flex-1 py-2 rounded-[6px] text-sm"
            style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            Decline
          </button>
        </div>
      )}

      {p.status === 'PENDING' && countering && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="number"
            min={0}
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="Cash amount (R) — 0 for none"
            style={inputStyle}
          />
          <select value={dir} onChange={(e) => setDir(e.target.value as SwapRole)} style={inputStyle}>
            <option value="INITIATOR_GIVES">They pay me the cash</option>
            <option value="OWNER_GIVES">I pay them the cash</option>
          </select>
          <input
            type="text"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional, no contact details)"
            style={inputStyle}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(
                  `/swaps/proposals/${p.id}/counter`,
                  {
                    counterCashAmount: Math.round(parseFloat(cash || '0') * 100),
                    counterCashDirection: dir,
                    ownerNote: note || undefined,
                  },
                  'Counter sent.',
                )
              }
              className="flex-1 py-2 rounded-[6px] text-sm font-medium"
              style={{ background: 'var(--red)', color: '#fff' }}
            >
              Send counter
            </button>
            <button
              type="button"
              onClick={() => setCountering(false)}
              className="py-2 px-3 rounded-[6px] text-sm"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Viewer: their existing proposal ────────────────────────────────────
function ViewerProposalView({
  proposal: p,
  busy,
  act,
}: {
  proposal: Proposal;
  busy: boolean;
  act: (path: string, body?: unknown, okMsg?: string) => Promise<void>;
}) {
  const statusLabel: Record<string, string> = {
    PENDING: 'Sent — awaiting the owner’s response (48h).',
    COUNTERED: 'The owner countered the cash. Accept or decline.',
    CONVERTED: 'Agreed! Funding + shipping details are on the way.',
    REJECTED: 'The owner declined this proposal.',
    WITHDRAWN: 'You withdrew this proposal.',
    EXPIRED: 'This proposal expired.',
  };
  return (
    <div style={{ ...card, padding: 12 }}>
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
        You offered your <strong>{p.offeredListing.title}</strong> for this item.
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
        {cashSummary(p)}
      </p>
      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
        {statusLabel[p.status] ?? p.status}
      </p>
      {p.ownerNote && p.status === 'COUNTERED' && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Owner: “{p.ownerNote}”
        </p>
      )}

      {p.status === 'COUNTERED' && (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/swaps/proposals/${p.id}/accept-counter`, undefined, 'Swap agreed!')}
            className="flex-1 py-2 rounded-[6px] text-sm font-medium"
            style={{ background: 'var(--red)', color: '#fff' }}
          >
            Accept counter
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/swaps/proposals/${p.id}/reject-counter`)}
            className="flex-1 py-2 rounded-[6px] text-sm"
            style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            Decline
          </button>
        </div>
      )}

      {p.status === 'PENDING' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(`/swaps/proposals/${p.id}/withdraw`, undefined, 'Proposal withdrawn.')}
          className="w-full mt-3 py-2 rounded-[6px] text-sm"
          style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Withdraw proposal
        </button>
      )}
    </div>
  );
}

// ── Viewer: propose form ───────────────────────────────────────────────
function ProposeForm({
  listingId,
  offerable,
  busy,
  setBusy,
  setError,
  authedFetch,
  onDone,
}: {
  listingId: string;
  offerable: Offerable[] | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (s: string) => void;
  authedFetch: (path: string, opts?: RequestInit) => Promise<unknown>;
  onDone: () => Promise<void>;
}) {
  const [offeredId, setOfferedId] = useState('');
  const [cash, setCash] = useState('');
  const [dir, setDir] = useState<SwapRole>('INITIATOR_GIVES');
  const [note, setNote] = useState('');

  if (offerable === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading your items…
      </p>
    );
  }
  if (offerable.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        To propose a swap you first need an active{' '}
        <strong>Swop / Trade</strong> listing of your own to offer. List the item
        you’d trade, then come back here.
      </p>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!offeredId) {
      setError('Pick one of your items to offer.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const cashCents = Math.round(parseFloat(cash || '0') * 100);
      await authedFetch(`/swaps/proposals`, {
        method: 'POST',
        body: JSON.stringify({
          listingId,
          offeredListingId: offeredId,
          cashAmount: cashCents,
          cashDirection: cashCents > 0 ? dir : undefined,
          proposerNote: note || undefined,
        }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit proposal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Item you’ll trade
      </label>
      <select value={offeredId} onChange={(e) => setOfferedId(e.target.value)} style={inputStyle}>
        <option value="">Select one of your Swop listings…</option>
        {offerable.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>

      <label className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
        Add cash to balance the deal? (optional)
      </label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={cash}
        onChange={(e) => setCash(e.target.value)}
        placeholder="0.00"
        style={inputStyle}
      />
      {parseFloat(cash || '0') > 0 && (
        <select value={dir} onChange={(e) => setDir(e.target.value as SwapRole)} style={inputStyle}>
          <option value="INITIATOR_GIVES">I add the cash (I pay the owner)</option>
          <option value="OWNER_GIVES">Owner adds the cash (they pay me)</option>
        </select>
      )}

      <input
        type="text"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note to the owner (optional)"
        style={inputStyle}
      />
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        No phone numbers, emails, or social handles — Gun Galore arranges both
        couriers and holds any cash until both parcels are delivered.
      </p>

      <button
        type="submit"
        disabled={busy}
        className="w-full py-3 rounded-[6px] text-sm font-medium mt-1"
        style={{ background: busy ? 'var(--bg-inset)' : 'var(--red)', color: busy ? 'var(--text-tertiary)' : '#fff' }}
      >
        {busy ? 'Sending…' : 'Propose swap'}
      </button>
    </form>
  );
}
