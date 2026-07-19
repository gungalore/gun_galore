'use client';

// /subscribe — GG+ MEMBER / PRO subscription purchase (P1.1).
//
// Phase 1 (manual-EFT retirement): card payments are launching soon and the
// manual bank-transfer purchase rail is retired, so picking a tier now shows
// the "card payments launching soon" state instead of EFT bank-details.
// The tier cards + perks stay. When the card paygate lands (Ivori/Peach),
// this page swaps its checkout call for the gateway flow.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { PageReveal } from '@/components/page-reveal';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import { formatPrice } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Pricing {
  proCents: number;
  periodDays: number;
}

interface Mine {
  tier: 'FREE' | 'MEMBER' | 'PRO';
  isComp: boolean;
  periodEnd: string | null;
}

// Single paid tier since 2026-07-19: FREE demos every feature, PRO
// unlocks it all. The prize-draw line deliberately says only "amazing
// prizes" — the actual prize of the running cycle is shown on /raffle.
const TIER_PERKS: Record<'PRO', string[]> = {
  PRO: [
    'Automatic entry into the free PRO prize draw — amazing prizes, every cycle',
    'Ask GG: 60 messages / hour',
    'Unlimited photo identification (10/query)',
    'Ballistic calculator + full Load Lab load data',
    'Unlimited open swap proposals + 25% off swap service fees',
    'GG+ PRO username badge',
    '50% off featured-listing bids',
  ],
};

// What FREE gets — an honest demo of everything PRO unlocks.
const FREE_DEMOS: string[] = [
  'Ask GG: 5 messages / 30 days',
  'Load Lab: preview 3 published loads per calibre',
  'One open swap proposal at a time',
  'Watch the PRO prize draw (PRO members are entered free)',
];

export default function SubscribePage() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [mine, setMine] = useState<Mine | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  // Phase-1 payment gate — subscriptions checkout returns 503 "launching
  // soon". True once we've detected that (or the user taps a tier).
  const [comingSoon, setComingSoon] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Public pricing loads for everyone (signed-out prospects included).
  // Review fix: surface a fetch failure instead of leaving the price as
  // "…" forever.
  const [pricingFailed, setPricingFailed] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/subscriptions/pricing`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Pricing | null) =>
        p ? setPricing(p) : setPricingFailed(true),
      )
      .catch(() => setPricingFailed(true));
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
    async (tier: 'PRO') => {
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
          // Phase-1 payment gate: subscriptions checkout returns 503 "card
          // payments are launching soon". Show the coming-soon state rather
          // than a red error banner.
          if (r.status === 503 || /launching soon/i.test(body?.message ?? '')) {
            setComingSoon(true);
            return;
          }
          setError(body?.message ?? 'Something went wrong — please try again.');
          return;
        }
        // Manual EFT is retired, so no payment instructions come back. Until
        // the card paygate is wired up, land on the launching-soon state.
        setComingSoon(true);
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

  const tiers: Array<{ key: 'PRO'; cents: number | null; accent: boolean }> = [
    { key: 'PRO', cents: pricing?.proCents ?? null, accent: true },
  ];

  return (
    <PageReveal>
      <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          GG+ subscriptions
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Prepaid monthly. No debit orders, no auto-renew — renew your tier
          when it suits you and your unused days stack on top.
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
                ? ` until ${periodEndLabel}. Renewing before then adds 31 days on top — and you can switch tiers once this period ends, so your paid days are never lost.`
                : '.'}
          </div>
        )}

        {/* Tier cards — FREE (demo of everything) alongside PRO. */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <div
            className="rounded-[10px] p-5"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <h2 className="text-lg font-semibold m-0 mb-1" style={{ color: 'var(--text-primary)' }}>
              Free
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)', fontSize: 18 }}>R0</strong> — try
              everything
            </p>
            <ul className="m-0 p-0 mb-5" style={{ listStyle: 'none', fontSize: 13, lineHeight: 1.7 }}>
              {FREE_DEMOS.map((perk) => (
                <li key={perk} style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>•</span>
                  {perk}
                </li>
              ))}
            </ul>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Every PRO feature has a free taste — upgrade when it earns its keep.
            </p>
          </div>
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
                  Pro
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
                ) : pricingFailed ? (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    Price unavailable — please refresh
                  </span>
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
                (() => {
                  // A LIVE paid period can only be RENEWED at its own tier on
                  // the EFT rail (no mid-period tier changes — matches the
                  // backend guard). Disable the other paid tier so a member
                  // can't accidentally start a cross-tier charge that would
                  // be refused (or, worse, discard paid days).
                  const hasLivePaid =
                    !!currentTier &&
                    currentTier !== 'FREE' &&
                    !!mine?.periodEnd;
                  const isCrossTierBlocked =
                    hasLivePaid && currentTier !== t.key;
                  const disabled =
                    busyTier !== null || !!mine?.isComp || isCrossTierBlocked;
                  const label = busyTier === t.key
                    ? 'Preparing…'
                    : currentTier === t.key
                      ? 'Renew (+31 days)'
                      : isCrossTierBlocked
                        ? `Switch at renewal`
                        : 'Get Pro';
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      title={
                        isCrossTierBlocked
                          ? `You're on GG+ ${currentTier} until your period ends. You can switch to Pro then.`
                          : undefined
                      }
                      onClick={() => void checkout(t.key)}
                      className="w-full text-sm px-4 py-2.5 rounded-[6px]"
                      style={{
                        background: t.accent ? 'var(--red)' : 'transparent',
                        color: t.accent ? '#fff' : 'var(--text-primary)',
                        border: t.accent ? 'none' : '0.5px solid var(--border)',
                        fontWeight: 500,
                        opacity: disabled ? 0.55 : 1,
                        cursor: disabled ? 'default' : 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  );
                })()
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

        {/* Phase-1 payment gate — card payments aren't live yet. */}
        {comingSoon && (
          <div className="mt-6">
            <PaymentsComingSoon />
          </div>
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
