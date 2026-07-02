'use client';

// /subscribe — GG+ MEMBER / PRO subscription purchase (P1.1).
//
// Prepaid monthly EFT on the manual rail (no auto-renew, CPA-clean):
// pick a tier → backend allocates an SB reference on a PENDING charge
// (24h pay-by window) → member EFTs → reconciler activates the tier.
// Renewing the same tier before expiry STACKS days from the current
// period end, so paying early never loses days.
//
// When the card paygate lands (Ivori/Peach), this page swaps its
// checkout call for the gateway flow — the tier cards stay.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { PageReveal } from '@/components/page-reveal';
import { formatPrice } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Pricing {
  memberCents: number;
  proCents: number;
  periodDays: number;
}

interface BankDetails {
  accountName: string;
  bank: string;
  accountNumber: string;
  branchCode: string;
  accountType?: string;
}

interface Mine {
  tier: 'FREE' | 'MEMBER' | 'PRO';
  isComp: boolean;
  periodEnd: string | null;
  pending: {
    reference: string | null;
    amountCents: number;
    payByAt: string | null;
    tier: 'MEMBER' | 'PRO' | null;
    detected: boolean;
  } | null;
  pricing: Pricing;
  bankDetails: BankDetails;
}

interface CheckoutResponse {
  manual: true;
  reference: string;
  amountCents: number;
  payByAt: string;
  tier: 'MEMBER' | 'PRO';
  periodDays: number;
  bankDetails: BankDetails;
}

const TIER_PERKS: Record<'MEMBER' | 'PRO', string[]> = {
  MEMBER: [
    'Ask GG: 20 messages / hour',
    'Unlimited photo identification (5/query)',
    'Ballistic calculator',
    'GG+ username badge',
    '25% off featured-listing bids',
    'Weekly Member raffle entry',
  ],
  PRO: [
    'Ask GG: 60 messages / hour',
    'Unlimited photo identification (10/query)',
    'Ballistic calculator + Load Lab',
    'Verified-expert badge',
    '50% off featured-listing bids',
    'Weekly Pro raffle entry',
  ],
};

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
      className="text-xs px-2 py-1 rounded-[4px]"
      style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

function Row({
  label,
  value,
  copyLabel,
  emphasize,
}: {
  label: string;
  value: string;
  copyLabel?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2"
      style={{ borderTop: '0.5px solid var(--border)' }}
    >
      <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
      <span className="flex items-center gap-2">
        <span
          className="text-sm"
          style={{
            color: emphasize ? 'var(--red)' : 'var(--text-primary)',
            fontWeight: emphasize ? 600 : 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {copyLabel && <Copyable value={value} label={copyLabel} />}
      </span>
    </div>
  );
}

/** EFT payment instructions for an open subscription charge. */
function EftInstructions({
  reference,
  amountCents,
  payByAt,
  tier,
  bank,
  detected,
}: {
  reference: string;
  amountCents: number;
  payByAt: string | null;
  tier: string;
  bank: BankDetails;
  detected: boolean;
}) {
  const [remaining, setRemaining] = useState<number>(() =>
    payByAt ? Math.max(0, new Date(payByAt).getTime() - Date.now()) : 0,
  );
  useEffect(() => {
    if (!payByAt) return;
    const t = setInterval(() => {
      setRemaining(Math.max(0, new Date(payByAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [payByAt]);

  const expired = payByAt !== null && remaining <= 0;
  const totalMin = Math.floor(remaining / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const countdownLabel = `${hrs}h ${mins}m`;

  return (
    <div className="mt-6">
      <h2 className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Pay for GG+ {tier} by bank transfer (EFT)
      </h2>
      <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Card payments are coming soon — for now, activate your subscription
        with a quick bank transfer. Your perks switch on as soon as the
        payment is picked up (usually within minutes of paying).
      </p>

      {detected && (
        <div
          className="rounded-[6px] px-4 py-3 mb-4 text-sm"
          style={{
            background: 'rgba(22,163,74,0.08)',
            border: '0.5px solid rgba(22,163,74,0.35)',
            color: 'var(--text-secondary)',
          }}
        >
          Payment detected — we&apos;re activating your subscription. Refresh in a
          minute if your tier hasn&apos;t updated yet.
        </div>
      )}

      {!detected && payByAt && (
        <div
          className="rounded-[6px] px-4 py-3 mb-4 text-sm"
          style={{
            background: expired ? 'rgba(200,16,46,0.10)' : 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {expired ? (
            <span style={{ color: 'var(--red)' }}>
              This payment window has passed. If you&apos;ve already paid, don&apos;t
              pay again — contact support with your reference. Otherwise just
              pick your tier again for a fresh reference.
            </span>
          ) : (
            <>
              Pay within{' '}
              <strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {countdownLabel}
              </strong>{' '}
              using the reference below.
            </>
          )}
        </div>
      )}

      <div
        className="rounded-[8px] p-4 mb-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)' }}
      >
        <Row
          label="Amount (pay this exact amount)"
          value={formatPrice(amountCents)}
          copyLabel="amount"
          emphasize
        />
        <Row
          label="Reference (use EXACTLY this)"
          value={reference}
          copyLabel="reference"
          emphasize
        />
      </div>

      <div
        className="rounded-[8px] p-4 mb-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <p
          className="text-xs uppercase mb-1"
          style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
        >
          Pay into
        </p>
        <Row label="Account name" value={bank.accountName} />
        <Row label="Bank" value={bank.bank} />
        <Row label="Account number" value={bank.accountNumber} copyLabel="account number" />
        <Row label="Branch code" value={bank.branchCode} copyLabel="branch code" />
        {bank.accountType && <Row label="Account type" value={bank.accountType} />}
      </div>

      <div
        className="rounded-[6px] p-4 text-sm"
        style={{
          background: 'var(--bg-inset, var(--bg-card))',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <p style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 6 }}>
          How it works
        </p>
        <ol style={{ paddingLeft: 18, listStyle: 'decimal' }}>
          <li>
            EFT the <strong>exact amount</strong> above into the Gun Galore account.
          </li>
          <li>
            Use <strong style={{ color: 'var(--red)' }}>{reference}</strong> as
            the payment reference — nothing else.
          </li>
          <li>
            We verify payments automatically — you&apos;ll get an SMS and your
            perks activate the moment it&apos;s confirmed.
          </li>
        </ol>
        <p style={{ marginTop: 8, color: 'var(--text-tertiary)' }}>
          No auto-renew, no debit order: your subscription is prepaid for 31
          days and we&apos;ll remind you before it ends.
        </p>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [mine, setMine] = useState<Mine | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [instructions, setInstructions] = useState<CheckoutResponse | null>(null);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Public pricing loads for everyone (signed-out prospects included).
  useEffect(() => {
    fetch(`${API_URL}/subscriptions/pricing`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Pricing | null) => p && setPricing(p))
      .catch(() => undefined);
  }, []);

  const loadMine = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_URL}/subscriptions/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!r.ok) return;
      setMine((await r.json()) as Mine);
    } catch {
      // silent — page still renders pricing
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void loadMine();
  }, [isLoaded, isSignedIn, loadMine]);

  const checkout = useCallback(
    async (tier: 'MEMBER' | 'PRO') => {
      setError(null);
      setBusyTier(tier);
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`${API_URL}/subscriptions/checkout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tier }),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { message?: string } | null;
          setError(body?.message ?? 'Something went wrong — please try again.');
          return;
        }
        setInstructions((await r.json()) as CheckoutResponse);
      } catch {
        setError('Something went wrong — please try again.');
      } finally {
        setBusyTier(null);
      }
    },
    [getToken],
  );

  const currentTier = mine?.tier ?? null;
  const periodEndLabel = mine?.periodEnd
    ? new Date(mine.periodEnd).toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  // An open charge from a previous visit (or another device) takes
  // precedence over freshly-returned instructions when both exist for
  // the same reference — they're the same thing.
  const open =
    instructions ??
    (mine?.pending?.reference
      ? {
          manual: true as const,
          reference: mine.pending.reference,
          amountCents: mine.pending.amountCents,
          payByAt: mine.pending.payByAt ?? '',
          tier: (mine.pending.tier ?? 'MEMBER') as 'MEMBER' | 'PRO',
          periodDays: mine.pricing.periodDays,
          bankDetails: mine.bankDetails,
        }
      : null);

  const tiers: Array<{ key: 'MEMBER' | 'PRO'; cents: number | null; accent: boolean }> = [
    { key: 'MEMBER', cents: pricing?.memberCents ?? null, accent: false },
    { key: 'PRO', cents: pricing?.proCents ?? null, accent: true },
  ];

  return (
    <PageReveal>
      <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          GG+ subscriptions
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Prepaid monthly. No debit orders, no auto-renew — renew when it
          suits you and unused days always stack.
        </p>

        {currentTier && currentTier !== 'FREE' && (
          <div
            className="rounded-[8px] px-4 py-3 mb-6 text-sm"
            style={{
              background: 'rgba(200,16,46,0.06)',
              border: '0.5px solid rgba(200,16,46,0.40)',
              color: 'var(--text-secondary)',
            }}
          >
            You&apos;re on <strong style={{ color: 'var(--text-primary)' }}>GG+ {currentTier}</strong>
            {mine?.isComp
              ? ' (complimentary — no renewal needed).'
              : periodEndLabel
                ? ` until ${periodEndLabel}. Renewing before then adds 31 days on top.`
                : '.'}
          </div>
        )}

        {/* Tier cards */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {tiers.map((t) => (
            <div
              key={t.key}
              className="rounded-[10px] p-5"
              style={{
                background: 'var(--bg-card)',
                border: `0.5px solid ${t.accent ? 'rgba(200,16,46,0.35)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold m-0" style={{ color: 'var(--text-primary)' }}>
                  {t.key === 'MEMBER' ? 'Member' : 'Pro'}
                </h2>
                {t.accent && (
                  <span
                    className="text-[10px] uppercase px-2 py-0.5 rounded-[4px] font-semibold"
                    style={{
                      letterSpacing: 0.6,
                      color: 'var(--red)',
                      background: 'rgba(200,16,46,0.12)',
                    }}
                  >
                    Most value
                  </span>
                )}
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {t.cents !== null ? (
                  <>
                    <strong style={{ color: 'var(--text-primary)', fontSize: 18 }}>
                      {formatPrice(t.cents)}
                    </strong>{' '}
                    / month
                  </>
                ) : (
                  '…'
                )}
              </p>
              <ul className="m-0 p-0 mb-5" style={{ listStyle: 'none', fontSize: 13, lineHeight: 1.7 }}>
                {TIER_PERKS[t.key].map((perk) => (
                  <li key={perk} style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--red)', marginRight: 6 }}>✓</span>
                    {perk}
                  </li>
                ))}
              </ul>
              {isSignedIn ? (
                <button
                  type="button"
                  disabled={busyTier !== null || mine?.isComp}
                  onClick={() => void checkout(t.key)}
                  className="w-full text-sm px-4 py-2.5 rounded-[6px]"
                  style={{
                    background: t.accent ? 'var(--red)' : 'transparent',
                    color: t.accent ? '#fff' : 'var(--text-primary)',
                    border: t.accent ? 'none' : '0.5px solid var(--border)',
                    fontWeight: 500,
                    opacity: busyTier !== null || mine?.isComp ? 0.6 : 1,
                    cursor: busyTier !== null || mine?.isComp ? 'default' : 'pointer',
                  }}
                >
                  {busyTier === t.key
                    ? 'Preparing…'
                    : currentTier === t.key
                      ? 'Renew (+31 days)'
                      : `Get ${t.key === 'MEMBER' ? 'Member' : 'Pro'}`}
                </button>
              ) : (
                <Link
                  href="/sign-in?redirect_url=/subscribe"
                  className="block text-center text-sm px-4 py-2.5 rounded-[6px]"
                  style={{
                    background: t.accent ? 'var(--red)' : 'transparent',
                    color: t.accent ? '#fff' : 'var(--text-primary)',
                    border: t.accent ? 'none' : '0.5px solid var(--border)',
                    fontWeight: 500,
                  }}
                >
                  Sign in to subscribe
                </Link>
              )}
            </div>
          ))}
        </div>

        {mine?.isComp && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
            Your subscription is complimentary — there&apos;s nothing to pay.
          </p>
        )}

        {error && (
          <div
            className="rounded-[6px] px-4 py-3 mt-4 text-sm"
            style={{
              background: 'rgba(200,16,46,0.10)',
              border: '0.5px solid rgba(200,16,46,0.40)',
              color: 'var(--red)',
            }}
          >
            {error}
          </div>
        )}

        {open && (
          <EftInstructions
            reference={open.reference}
            amountCents={open.amountCents}
            payByAt={open.payByAt || null}
            tier={open.tier}
            bank={open.bankDetails}
            detected={!instructions && !!mine?.pending?.detected}
          />
        )}

        <p className="text-xs mt-8" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          Subscriptions are prepaid for 31 days and do not renew
          automatically. We&apos;ll remind you 3 days before your period ends.
          Prices include VAT where applicable. See our{' '}
          <Link href="/terms" style={{ textDecoration: 'underline' }}>
            Terms of Service
          </Link>{' '}
          for details.
        </p>
      </div>
    </PageReveal>
  );
}
