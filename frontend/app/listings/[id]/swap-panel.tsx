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
import Link from 'next/link';
import { useUser, useAuth, SignInButton } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

type SwapRole = 'INITIATOR_GIVES' | 'OWNER_GIVES';

interface Offerable {
  id: string;
  title: string;
  isFirearm?: boolean;
  declaredValueCents?: number | null;
  images: { url: string }[];
}
interface MiniListing {
  id: string;
  title: string;
  isFirearm?: boolean;
  declaredValueCents?: number | null;
  images?: { url: string }[];
}
interface Proposal {
  id: string;
  status: string;
  cashAmount: number;
  cashDirection: SwapRole | null;
  counterCashAmount: number | null;
  counterCashDirection: SwapRole | null;
  // P0.5 — commission retained from the cash top-up at settlement (bands
  // on the excess above R1,000) + the net figure the recipient is paid.
  cashCommissionCents?: number;
  cashNetToRecipientCents?: number;
  // Value-based swap service fee estimates (base rate; PRO discount is
  // applied at funding). proposer = fee on the offered item, owner = fee
  // on the listed item.
  proposerServiceFeeEstimateCents?: number | null;
  ownerServiceFeeEstimateCents?: number | null;
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

// S6 — 18+/competency affirmation, required whenever a party is about to
// receive a firearm in a swap. The firearm transfers via a licensed dealer.
function FirearmAttest({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="text-xs p-2 rounded-[6px]"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--warning)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
    >
      <p className="mb-1.5" style={{ color: 'var(--warning)', fontWeight: 600 }}>
        Firearm — dealer transfer
      </p>
      <p className="mb-2">
        This firearm is transferred through a licensed dealer (SAPS 534). You
        collect it from the dealer once it’s stocked in.
      </p>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          I confirm I am over 18 and (where applicable) hold the relevant SAPS
          competency / licence to acquire this firearm.
        </span>
      </label>
    </div>
  );
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
  isFirearm = false,
}: {
  listingId: string;
  sellerClerkId: string;
  isOwnListing: boolean;
  isFirearm?: boolean;
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
        <p className="text-xs mb-2" style={{ color: 'var(--success)' }}>
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
          wantedIsFirearm={isFirearm}
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
  const base =
    dir === 'INITIATOR_GIVES'
      ? `They add ${rand(amt)} cash`
      : `You add ${rand(amt)} cash`;
  // P0.5 — cash over R1,000 carries standard platform commission,
  // deducted from the cash the receiver is paid at settlement.
  const fee = p.cashCommissionCents ?? 0;
  if (fee > 0 && p.cashNetToRecipientCents !== undefined) {
    return `${base} · receiver is paid ${rand(p.cashNetToRecipientCents)} after the ${rand(fee)} platform commission`;
  }
  return base;
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
  const [attested, setAttested] = useState(false);
  // The owner RECEIVES the offered item — attest if it's a firearm.
  const needsAttest = !!p.offeredListing.isFirearm;
  const attestOk = !needsAttest || attested;

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
      {(p.offeredListing.declaredValueCents || p.ownerServiceFeeEstimateCents) && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {p.offeredListing.declaredValueCents
            ? `Their item's declared value: ${rand(p.offeredListing.declaredValueCents)}. `
            : ''}
          {p.ownerServiceFeeEstimateCents
            ? `Your swap service fee if you accept: ~${rand(p.ownerServiceFeeEstimateCents)} (PRO saves 25%).`
            : ''}
        </p>
      )}
      {p.proposerNote && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          “{p.proposerNote}”
        </p>
      )}

      {p.status === 'PENDING' && needsAttest && !countering && (
        <div className="mt-3">
          <FirearmAttest checked={attested} onChange={setAttested} />
        </div>
      )}

      {p.status === 'PENDING' && !countering && (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            disabled={busy || !attestOk}
            onClick={() =>
              act(
                `/swaps/proposals/${p.id}/accept`,
                needsAttest ? { firearmAttestation18Plus: attested } : undefined,
                'Swap agreed!',
              )
            }
            className="flex-1 py-2 rounded-[6px] text-sm font-medium"
            style={{ background: 'var(--red)', color: '#fff', opacity: attestOk ? 1 : 0.5 }}
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
          {needsAttest && (
            <FirearmAttest checked={attested} onChange={setAttested} />
          )}
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
              disabled={busy || !attestOk}
              onClick={() =>
                act(
                  `/swaps/proposals/${p.id}/counter`,
                  {
                    counterCashAmount: Math.round(parseFloat(cash || '0') * 100),
                    counterCashDirection: dir,
                    ownerNote: note || undefined,
                    firearmAttestation18Plus: needsAttest ? attested : undefined,
                  },
                  'Counter sent.',
                )
              }
              className="flex-1 py-2 rounded-[6px] text-sm font-medium"
              style={{ background: 'var(--red)', color: '#fff', opacity: attestOk ? 1 : 0.5 }}
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
      {(p.listing.declaredValueCents || p.proposerServiceFeeEstimateCents) && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {p.listing.declaredValueCents
            ? `Their item's declared value: ${rand(p.listing.declaredValueCents)}. `
            : ''}
          {p.proposerServiceFeeEstimateCents
            ? `Your swap service fee if agreed: ~${rand(p.proposerServiceFeeEstimateCents)} (PRO saves 25%).`
            : ''}
        </p>
      )}
      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
        {statusLabel[p.status] ?? p.status}
      </p>
      {p.status === 'CONVERTED' && (
        <a href="/my/swaps" className="inline-block text-xs mt-2" style={{ color: 'var(--red)' }}>
          Go to My Swaps to add your address &amp; pay →
        </a>
      )}
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
  wantedIsFirearm,
  offerable,
  busy,
  setBusy,
  setError,
  authedFetch,
  onDone,
}: {
  listingId: string;
  wantedIsFirearm: boolean;
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
  const [attested, setAttested] = useState(false);

  if (offerable === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading your items…
      </p>
    );
  }
  if (offerable.length === 0) {
    // Dead end until now: the viewer was told to go list something with no
    // way to get there. The sell form does NOT read a ?type= param (it only
    // seeds from ?relistFrom), so the link is plain and the copy names the
    // selling mode they must pick instead of pretending it is pre-selected.
    return (
      <div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          To propose a swap you first need an active{' '}
          <strong>Swop / Trade</strong> listing of your own to offer.
        </p>
        <Link
          href="/listings/new?type=SWOP"
          className="block w-full py-3 mt-3 rounded-[6px] text-sm font-medium text-center"
          style={{ background: 'var(--red)', color: '#fff', textDecoration: 'none' }}
        >
          List an item to trade
        </Link>
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          The sell form opens on the <strong>Swop / Trade</strong> selling
          mode — publish your item, then come back here to propose the swap.
        </p>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!offeredId) {
      setError('Pick one of your items to offer.');
      return;
    }
    if (wantedIsFirearm && !attested) {
      setError('Please confirm the firearm declaration to continue.');
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
          firearmAttestation18Plus: wantedIsFirearm ? attested : undefined,
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
            {o.declaredValueCents ? ` — declared ${rand(o.declaredValueCents)}` : ''}
          </option>
        ))}
      </select>
      {(() => {
        // Value-based service fee preview for the item the proposer will
        // SEND: 1.5% of declared value, clamped [min, R750]. Base rate —
        // the PRO discount is applied at funding.
        const sel = offerable.find((o) => o.id === offeredId);
        if (!sel) return null;
        const min = sel.isFirearm ? 10000 : 5000;
        const fee = Math.min(
          Math.max(Math.round((sel.declaredValueCents ?? 0) * 0.015), min),
          75000,
        );
        return (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Your swap service fee if agreed: ~{rand(fee)} (1.5% of your
            declared value, min {rand(min)}, max R750 — PRO members save 25%).
            It&apos;s added to your funding payment along with your courier
            cost.
          </p>
        );
      })()}

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
      {parseFloat(cash || '0') > 1000 && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Cash top-ups over R1,000 carry standard platform commission on the
          amount above R1,000, deducted from the cash the receiver is paid.
        </p>
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
        No phone numbers, emails, or social handles — All Outdoor arranges both
        couriers and holds any cash until both parcels are delivered.
      </p>

      {wantedIsFirearm && (
        <FirearmAttest checked={attested} onChange={setAttested} />
      )}

      <button
        type="submit"
        disabled={busy || (wantedIsFirearm && !attested)}
        className="w-full py-3 rounded-[6px] text-sm font-medium mt-1"
        style={{ background: busy ? 'var(--bg-inset)' : 'var(--red)', color: busy ? 'var(--text-tertiary)' : '#fff' }}
      >
        {busy ? 'Sending…' : 'Propose swap'}
      </button>
    </form>
  );
}
