'use client';

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import RefreshButton from './refresh-button';

// Mirrors the backend's CachedBalance shape.
interface CachedBalance {
  available: number;
  lastRefreshAt: string | null; // from VerifyNow (production only)
  fetchedAt: string; // when our backend last hit /my_credits
}

interface BalanceResponse {
  balance: CachedBalance | null;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Threshold (sandbox uses fake numbers, so this matters more in prod).
// At <50 credits we tint the card red so the admin notices.
const LOW_BALANCE = 50;

export default function AdminKycPage() {
  const [data, setData] = useState<BalanceResponse | null>(null);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch('/admin/kyc/balance');
      if (cancelled) return;
      if (res.ok) setData(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bal = data?.balance ?? null;
  const mode = (process.env.NEXT_PUBLIC_VERIFYNOW_MODE ?? 'sandbox').toLowerCase();
  const low = bal !== null && bal.available < LOW_BALANCE;

  return (
    <div>
      <h1
        className="text-lg font-medium mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        KYC credits
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        VerifyNow charges one credit per successful identity verification (Home
        Affairs lookup + face match). The number below auto-refreshes every
        5&nbsp;minutes — the &ldquo;Refresh now&rdquo; button forces an
        immediate poll.
      </p>

      <div
        className="rounded-[8px] p-6 mb-6"
        style={{
          background: 'var(--bg-card)',
          border: `0.5px solid ${low ? 'var(--red)' : 'var(--border)'}`,
        }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <p
              className="text-xs uppercase mb-1"
              style={{
                color: low ? 'var(--red)' : 'var(--text-tertiary)',
                letterSpacing: '0.08em',
                fontWeight: 500,
              }}
            >
              {low ? 'Low balance' : 'Available credits'}
            </p>
            {bal === null ? (
              <p
                className="text-2xl"
                style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
              >
                —
              </p>
            ) : (
              <p
                className="text-4xl"
                style={{
                  color: low ? 'var(--red)' : 'var(--text-primary)',
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                }}
              >
                {bal.available.toLocaleString('en-ZA')}
              </p>
            )}
            {bal && (
              <p
                className="text-xs mt-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Last polled {fmtRelative(bal.fetchedAt)}
                {bal.lastRefreshAt && (
                  <>
                    {' '}· VerifyNow refresh{' '}
                    {fmtRelative(bal.lastRefreshAt)}
                  </>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <RefreshButton />
            {/* No purchase API exists — link out to VerifyNow's billing
                dashboard. Opens in a new tab so the admin keeps this
                page for context. */}
            <a
              href="https://www.verifynow.co.za"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-[6px] text-center"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Buy credits ↗
            </a>
          </div>
        </div>

        {!bal && (
          <p
            className="text-xs mt-4"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No balance fetched yet. Press &ldquo;Refresh now&rdquo; — the
            5-minute cron will keep it warm afterwards.
          </p>
        )}
      </div>

      <div
        className="rounded-[6px] p-4 text-xs"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-tertiary)',
          lineHeight: 1.55,
        }}
      >
        <p className="mb-1" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
          Current VerifyNow mode: <span style={{ color: mode === 'production' ? 'var(--red)' : '#22c55e' }}>{mode}</span>
        </p>
        <p>
          Sandbox returns mock data and does not consume credits. Set
          <code style={{ margin: '0 4px', color: 'var(--text-secondary)' }}>VERIFYNOW_MODE=production</code>
          in <code style={{ color: 'var(--text-secondary)' }}>backend/.env</code> to switch to live verification.
          Credits cannot be purchased via API — use the &ldquo;Buy credits&rdquo; button to open VerifyNow&apos;s billing dashboard.
        </p>
      </div>
    </div>
  );
}
