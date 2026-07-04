'use client';

// /my/swaps — the member's in-flight Swop/Trade deals + funding surface (S3).
// For an agreed swap, each party: (1) adds the delivery address for the item
// they receive, then (2) pays their EFT (courier + R50 fee + any cash). Both
// must pay to lock; if one doesn't, the payer is refunded in full.

import { useEffect, useState, useCallback, FormEvent } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const PROVINCES = [
  'EASTERN_CAPE',
  'FREE_STATE',
  'GAUTENG',
  'KWAZULU_NATAL',
  'LIMPOPO',
  'MPUMALANGA',
  'NORTHERN_CAPE',
  'NORTH_WEST',
  'WESTERN_CAPE',
];

interface BankDetails {
  accountName: string;
  bank: string;
  accountNumber: string;
  branchCode: string;
  accountType?: string;
}
interface Item {
  title: string;
  imageUrl: string | null;
}
interface SwapRow {
  swapId: string;
  status: string;
  side: string;
  fundingSetUp: boolean;
  payByAt: string | null;
  myAmountCents: number;
  myReference: string | null;
  myFunded: boolean;
  counterpartyFunded: boolean;
  verificationDeadlineAt: string | null;
  disputeReason: string | null;
  give: Item | null;
  get: Item | null;
  giveLegId: string | null;
  giveIsFirearm: boolean;
  giveDealerVerificationStatus: string | null;
  getIsFirearm: boolean;
  giveProofCode: string | null;
  giveProofStatus: string | null;
  giveTracking: { status: string | null; waybill: string | null; estimatedDeliveryAt: string | null } | null;
  getTracking: { status: string | null; waybill: string | null; estimatedDeliveryAt: string | null } | null;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '9px 11px',
  fontSize: 14,
  width: '100%',
};

export default function MySwapsPage() {
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const [bank, setBank] = useState<BankDetails | null>(null);
  const [swaps, setSwaps] = useState<SwapRow[] | null>(null);
  const [error, setError] = useState('');

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
      const data = (await authedFetch('/swaps/mine')) as {
        bankDetails: BankDetails;
        swaps: SwapRow[];
      };
      setBank(data.bankDetails);
      setSwaps(data.swaps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your swaps');
    }
  }, [authedFetch]);

  useEffect(() => {
    if (isLoaded && user) void load();
  }, [isLoaded, user, load]);

  if (!isLoaded) return null;
  if (!user) {
    return (
      <main className="max-w-[760px] mx-auto px-4 py-10">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Please sign in to view your swaps.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <h1 className="text-2xl mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
        My swaps
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Agreed Swop / Trade deals. Add your delivery address, then pay your
        share by EFT — both sides must pay to lock the swap.
      </p>

      {error && (
        <p className="text-sm mb-4" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      {!swaps && !error && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      )}
      {swaps && swaps.length === 0 && (
        <div
          className="rounded-[10px] p-6 text-center text-sm"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          No active swaps. Browse{' '}
          <Link href="/?listingType=SWOP" style={{ color: 'var(--red)' }}>Swop / Trade listings</Link>{' '}
          to propose one.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {swaps?.map((s) => (
          <SwapCard key={s.swapId} swap={s} bank={bank} authedFetch={authedFetch} onChange={load} />
        ))}
      </div>
    </main>
  );
}

function SwapCard({
  swap,
  bank,
  authedFetch,
  onChange,
}: {
  swap: SwapRow;
  bank: BankDetails | null;
  authedFetch: (path: string, opts?: RequestInit) => Promise<unknown>;
  onChange: () => Promise<void>;
}) {
  return (
    <div
      className="rounded-[10px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 mb-3">
        <ItemThumb item={swap.give} />
        <span style={{ color: 'var(--text-tertiary)', fontSize: 18 }}>⇅</span>
        <ItemThumb item={swap.get} />
        <div className="ml-auto">
          <StatusChip status={swap.status} />
        </div>
      </div>
      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        You give <strong style={{ color: 'var(--text-primary)' }}>{swap.give?.title ?? '—'}</strong>{' '}
        for <strong style={{ color: 'var(--text-primary)' }}>{swap.get?.title ?? '—'}</strong>.
      </p>

      {swap.status === 'AWAITING_FUNDING' && swap.giveProofStatus !== 'APPROVED' && (
        <ProofSection swap={swap} onChange={onChange} />
      )}
      {swap.status === 'AWAITING_FUNDING' && swap.giveProofStatus === 'APPROVED' && (
        <FundingSection swap={swap} bank={bank} authedFetch={authedFetch} onChange={onChange} />
      )}
      {swap.status === 'LOCKED' && (
        <Note tone="success">
          Both sides have paid — your swap is locked in. We&apos;re arranging the
          couriers; watch for your parcel&apos;s collection details.
        </Note>
      )}
      {swap.status === 'IN_TRANSIT' && (
        <>
          <Note tone="info">
            {swap.giveIsFirearm || swap.getIsFirearm
              ? 'In progress. Firearm legs transfer through a licensed dealer; courier legs are on the way.'
              : 'Both couriers are booked — your parcels are on the way. We’ll confirm here once both are delivered.'}
          </Note>
          <div className="mt-2 flex flex-col gap-1.5">
            <TrackingLine label="Parcel you're sending" t={swap.giveTracking} isFirearm={swap.giveIsFirearm} />
            <TrackingLine label="Parcel you're receiving" t={swap.getTracking} isFirearm={swap.getIsFirearm} />
          </div>
        </>
      )}
      {/* S6 — firearm the caller is SENDING: prompt the dealer drop + SAPS 534
          upload (the same page normal firearm sellers use). */}
      {['LOCKED', 'IN_TRANSIT'].includes(swap.status) &&
        swap.giveIsFirearm &&
        swap.giveLegId &&
        swap.giveDealerVerificationStatus !== 'APPROVED' && (
          <div className="mt-2">
            <Note tone="warn">
              Your <strong>{swap.give?.title}</strong> is a firearm — take it to a
              licensed dealer to book it into stock, then upload the SAPS 534 +
              stock-register photos so we can verify the transfer.
            </Note>
            <a
              href={`/transactions/${swap.giveLegId}/dealer-verification`}
              className="inline-block mt-2 py-2 px-3 rounded-[6px] text-sm font-medium"
              style={{ background: 'var(--red)', color: '#fff' }}
            >
              {swap.giveDealerVerificationStatus
                ? 'Continue dealer verification →'
                : 'Upload dealer verification →'}
            </a>
          </div>
        )}
      {['LOCKED', 'IN_TRANSIT'].includes(swap.status) && swap.getIsFirearm && (
        <Note tone="info">
          The firearm you&apos;re receiving transfers via a licensed dealer.
          We&apos;ll send you the dealer&apos;s collection details once the sender
          has booked it into stock.
        </Note>
      )}
      {swap.status === 'AWAITING_VERIFICATION' && (
        <VerificationSection swap={swap} authedFetch={authedFetch} onChange={onChange} />
      )}
      {swap.status === 'DISPUTED' && (
        <Note tone="warn">
          This swap is under review{swap.disputeReason ? ` — reported: “${swap.disputeReason}”` : ''}.
          Any held funds stay protected while our team looks into it.
        </Note>
      )}
    </div>
  );
}

// Both parcels delivered. A short window to flag a problem before the cash
// auto-releases to the recipient and the swap closes.
function VerificationSection({
  swap,
  authedFetch,
  onChange,
}: {
  swap: SwapRow;
  authedFetch: (path: string, opts?: RequestInit) => Promise<unknown>;
  onChange: () => Promise<void>;
}) {
  const [show, setShow] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const deadline = swap.verificationDeadlineAt
    ? new Date(swap.verificationDeadlineAt)
    : null;

  async function raise(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) {
      setErr('Please describe the problem (at least 10 characters).');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await authedFetch(`/swaps/${swap.swapId}/dispute`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await onChange();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not raise the issue');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Note tone="success">
        Both items delivered ✓ Please check the item you received.
        {deadline && (
          <>
            {' '}If everything&apos;s fine you don&apos;t need to do anything — the
            swap completes automatically on{' '}
            <strong>{deadline.toLocaleString('en-ZA')}</strong>.
          </>
        )}
      </Note>
      {!show ? (
        <button
          type="button"
          onClick={() => setShow(true)}
          className="text-xs self-start px-3 py-1.5 rounded-[6px]"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
        >
          Something&apos;s wrong with what I received
        </button>
      ) : (
        <form onSubmit={raise} className="flex flex-col gap-2">
          <textarea
            style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
            placeholder="Tell us what's wrong with the item you received…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy}
              className="py-2 px-3 rounded-[6px] text-sm font-medium"
              style={{ background: busy ? 'var(--bg-inset)' : '#f59e0b', color: busy ? 'var(--text-tertiary)' : '#fff' }}>
              {busy ? 'Submitting…' : 'Raise an issue'}
            </button>
            <button type="button" onClick={() => { setShow(false); setErr(''); }}
              className="py-2 px-3 rounded-[6px] text-sm"
              style={{ background: 'transparent', color: 'var(--text-tertiary)' }}>
              Cancel
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            This pauses the swap and puts it in front of our team. Any held funds
            stay protected while we review.
          </p>
        </form>
      )}
    </div>
  );
}

function FundingSection({
  swap,
  bank,
  authedFetch,
  onChange,
}: {
  swap: SwapRow;
  bank: BankDetails | null;
  authedFetch: (path: string, opts?: RequestInit) => Promise<unknown>;
  onChange: () => Promise<void>;
}) {
  // Not yet quoted → need this party's delivery address (or waiting on the
  // other party / a retry).
  if (!swap.fundingSetUp || !swap.myReference) {
    return <AddressForm swap={swap} authedFetch={authedFetch} onChange={onChange} />;
  }
  if (swap.myFunded && !swap.counterpartyFunded) {
    return (
      <Note tone="success">
        Payment received ✓ — waiting for the other party to pay their side. If
        they don&apos;t, you&apos;ll be refunded in full.
      </Note>
    );
  }
  // Funding set up, not yet paid → show EFT instructions.
  return <EftBlock swap={swap} bank={bank} />;
}

function AddressForm({
  swap,
  authedFetch,
  onChange,
}: {
  swap: SwapRow;
  authedFetch: (path: string, opts?: RequestInit) => Promise<unknown>;
  onChange: () => Promise<void>;
}) {
  const [f, setF] = useState({
    street: '',
    suburb: '',
    city: '',
    postalCode: '',
    province: 'GAUTENG',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await authedFetch(`/swaps/${swap.swapId}/delivery-address`, {
        method: 'POST',
        body: JSON.stringify(f),
      });
      await onChange();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save address');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 mt-1">
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Where should we deliver the item you&apos;re receiving? (Door-to-door.)
      </p>
      <input style={inputStyle} placeholder="Street address" value={f.street}
        onChange={(e) => setF({ ...f, street: e.target.value })} required />
      <div className="grid grid-cols-2 gap-2">
        <input style={inputStyle} placeholder="Suburb" value={f.suburb}
          onChange={(e) => setF({ ...f, suburb: e.target.value })} required />
        <input style={inputStyle} placeholder="City" value={f.city}
          onChange={(e) => setF({ ...f, city: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input style={inputStyle} placeholder="Postal code" value={f.postalCode}
          onChange={(e) => setF({ ...f, postalCode: e.target.value })} required />
        <select style={inputStyle} value={f.province}
          onChange={(e) => setF({ ...f, province: e.target.value })}>
          {PROVINCES.map((p) => (
            <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
      <button type="submit" disabled={busy}
        className="w-full py-2.5 rounded-[6px] text-sm font-medium mt-1"
        style={{ background: busy ? 'var(--bg-inset)' : 'var(--red)', color: busy ? 'var(--text-tertiary)' : '#fff' }}>
        {busy ? 'Saving…' : 'Save delivery address'}
      </button>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Once both of you have added an address, we&apos;ll price the shipping and
        show your payment details here.
      </p>
    </form>
  );
}

function EftBlock({ swap, bank }: { swap: SwapRow; bank: BankDetails | null }) {
  return (
    <div className="mt-1">
      <div
        className="rounded-[8px] p-3 mb-3"
        style={{ background: 'var(--bg-inset, var(--bg-card))', border: '0.5px solid var(--red)' }}
      >
        <KV label="Pay this exact amount" value={formatPrice(swap.myAmountCents)} emphasize />
        <KV label="Use this reference" value={swap.myReference ?? ''} emphasize />
        {swap.payByAt && (
          <KV label="Pay by" value={new Date(swap.payByAt).toLocaleString('en-ZA')} />
        )}
      </div>
      {bank && (
        <div
          className="rounded-[8px] p-3 mb-2"
          style={{ background: 'var(--bg-inset, var(--bg-card))', border: '0.5px solid var(--border)' }}
        >
          <p className="text-xs uppercase mb-1" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Pay into
          </p>
          <KV label="Account name" value={bank.accountName} />
          <KV label="Bank" value={bank.bank} />
          <KV label="Account number" value={bank.accountNumber} />
          <KV label="Branch code" value={bank.branchCode} />
          {bank.accountType && <KV label="Account type" value={bank.accountType} />}
        </div>
      )}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        EFT the exact amount with the reference above. We confirm payments
        automatically and SMS you once it clears. Both sides must pay to lock the
        swap — if the other side doesn&apos;t, you&apos;re refunded in full. Your
        funds are held until both parcels are delivered.
      </p>
    </div>
  );
}

// Proof-of-possession: show the per-leg code + let the sender upload a photo of
// their item next to it. Gates funding — both sides must verify before paying.
function ProofSection({
  swap,
  onChange,
}: {
  swap: SwapRow;
  onChange: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const status = swap.giveProofStatus;

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !swap.giveLegId) return;
    setBusy(true);
    setErr('');
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append('photo', file);
      const res = await fetch(`${API_URL}/swaps/legs/${swap.giveLegId}/proof`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }, // no Content-Type — browser sets the multipart boundary
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
      await onChange();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Note tone="warn">
        Before you pay, verify your item. Write this code on a piece of paper and
        photograph it next to your <strong>{swap.give?.title ?? 'item'}</strong>:
      </Note>
      <div
        className="text-center py-2.5 rounded-[8px]"
        style={{ background: 'var(--bg-inset)', border: '0.5px dashed var(--red)' }}
      >
        <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--red)' }}>
          {swap.giveProofCode ?? '—'}
        </span>
      </div>
      {status === 'PENDING_REVIEW' && (
        <Note tone="info">
          Photo received — we&apos;re checking it. If it needs a human it&apos;ll
          be reviewed shortly.
        </Note>
      )}
      {status === 'REJECTED' && (
        <Note tone="warn">
          We couldn&apos;t verify that photo. Make sure the whole item and the
          handwritten code are sharp and in frame, then try again.
        </Note>
      )}
      <label
        className="w-full py-2.5 rounded-[6px] text-sm font-medium text-center cursor-pointer"
        style={{ background: busy ? 'var(--bg-inset)' : 'var(--red)', color: busy ? 'var(--text-tertiary)' : '#fff' }}
      >
        {busy ? 'Uploading…' : status === 'REJECTED' ? 'Upload a new photo' : 'Upload item photo'}
        <input type="file" accept="image/*" capture="environment" hidden onChange={upload} disabled={busy} />
      </label>
      {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        This proves your item is real and in your hands before anyone ships —
        both sides must verify before the swap can be funded.
      </p>
    </div>
  );
}

function TrackingLine({
  label,
  t,
  isFirearm,
}: {
  label: string;
  t: { status: string | null; waybill: string | null; estimatedDeliveryAt: string | null } | null;
  isFirearm: boolean;
}) {
  // Firearm legs move via a dealer, not a courier waybill — say so plainly.
  if (isFirearm) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <span>{label}</span>
        <span>Via licensed dealer</span>
      </div>
    );
  }
  const waybill = t?.waybill;
  const status = t?.status;
  return (
    <div className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
      <span>{label}</span>
      <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
        {waybill ? <>Waybill <strong style={{ color: 'var(--text-primary)' }}>{waybill}</strong></> : 'Booking…'}
        {status ? ` · ${status.replace(/_/g, ' ').toLowerCase()}` : ''}
      </span>
    </div>
  );
}

function KV({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5"
      style={{ borderTop: '0.5px solid var(--border)' }}>
      <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="text-sm" style={{
        color: emphasize ? 'var(--red)' : 'var(--text-primary)',
        fontWeight: emphasize ? 600 : 500,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}

function ItemThumb({ item }: { item: Item | null }) {
  return item?.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imageUrl} alt={item.title}
      style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '0.5px solid var(--border)' }} />
  ) : (
    <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }} />
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    AWAITING_FUNDING: { label: 'Awaiting payment', color: 'var(--red)' },
    LOCKED: { label: 'Locked in', color: '#16a34a' },
    IN_TRANSIT: { label: 'In transit', color: 'var(--text-secondary)' },
    AWAITING_VERIFICATION: { label: 'Verifying', color: 'var(--text-secondary)' },
    DISPUTED: { label: 'Under review', color: '#f59e0b' },
  };
  const m = map[status] ?? { label: status, color: 'var(--text-tertiary)' };
  return (
    <span className="text-xs px-2 py-0.5 rounded-[3px]"
      style={{ background: 'var(--bg-inset)', color: m.color, border: '0.5px solid var(--border)' }}>
      {m.label}
    </span>
  );
}

function Note({ tone, children }: { tone: 'success' | 'info' | 'warn'; children: React.ReactNode }) {
  const color = tone === 'success' ? '#16a34a' : tone === 'warn' ? '#f59e0b' : 'var(--text-secondary)';
  return (
    <div className="rounded-[8px] p-3 text-sm"
      style={{ background: 'var(--bg-inset, var(--bg-card))', border: '0.5px solid var(--border)', color, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}
