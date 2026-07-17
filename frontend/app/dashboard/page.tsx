import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { TrustDashboard, SellerTier } from '@/lib/types';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { DashboardProfileProgress } from '@/components/dashboard-profile-progress';
import { SellerQuestionsCard } from './seller-questions-card';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TIER_COLOR: Record<SellerTier, string> = {
  NEW: 'var(--text-tertiary)',
  ESTABLISHED: '#6366f1',
  TRUSTED: '#0ea5e9',
  TOP_SELLER: '#f59e0b',
  DEALER: 'var(--red)',
};

const TIER_NEXT: Partial<Record<SellerTier, { label: string; req: string }>> = {
  NEW: { label: 'Established', req: '3 sales + score ≥ 50' },
  ESTABLISHED: { label: 'Trusted', req: '10 sales + score ≥ 70' },
  TRUSTED: { label: 'Top Seller', req: '25 sales + score ≥ 85' },
};

function ScoreBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
        <span>{label}</span>
        <span>{Math.round(value)}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-inset)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: 'var(--red)', transition: 'width 0.3s' }}
        />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/dashboard');

  const token = await getToken();
  // Guard BOTH the fetch (backend unreachable) and the json() parse (a 200
  // with an empty/partial body → "Unexpected end of JSON input") so a
  // transient blip or a zero-data brand-new account never 500s this
  // post-sign-up landing page. (The name + completeness bar in the header
  // self-fetch client-side — see DashboardProfileProgress.)
  let data: TrustDashboard | null = null;
  try {
    const res = await fetch(`${API_URL}/ratings/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const text = await res.text();
      data = text ? (JSON.parse(text) as TrustDashboard) : null;
    }
  } catch {
    data = null;
  }

  return (
    <main
      className="relative max-w-[1280px] mx-auto px-4 py-6"
      style={{ zIndex: 1 }}
    >
      {/* House standard scenery — wrenches at low opacity tie this surface
          to the rest of the seller's control-room pages (Edit Profile,
          Profile). zIndex:1 on <main> keeps content above the fixed
          background layers. */}
      <PageBackground
        imageSrc="/setting.jpg"
        opacity={0.5}
        tint={0.12}
        vignette={0.7}
      />

      {/* Page header — OUTSIDE PageReveal so it renders at full opacity
          immediately (per house standard: only body cards animate). */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        {/* Greets by name + a clickable completeness bar that opens the
            unified profile form (/profile/edit). Hides the bar at 100%. */}
        <DashboardProfileProgress />
        {/* /transactions doesn't exist as an index page — the user-
            facing list pages are /my/orders + /my/sales. Link to
            /my/orders by default since the dashboard's CTA reads
            "View orders". */}
        <Link
          href="/my/orders"
          className="text-sm"
          style={{ color: 'var(--text-tertiary)', textDecoration: 'none', paddingTop: 4 }}
        >
          View orders →
        </Link>
      </div>

      {!data ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Could not load dashboard data.
        </p>
      ) : (
        <PageReveal className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* Trust score card */}
          <div
            data-reveal
            className="rounded-[8px] p-5"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-xs uppercase mb-1" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
                  Trust Score (private)
                </p>
                <p className="text-4xl font-medium" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  {data.trustScore}
                  <span className="text-lg font-normal" style={{ color: 'var(--text-tertiary)' }}>/100</span>
                </p>
              </div>
              <div className="text-right">
                <p
                  className="text-sm font-medium px-2.5 py-1 rounded-full"
                  style={{
                    background: `${TIER_COLOR[data.sellerTier]}18`,
                    color: TIER_COLOR[data.sellerTier],
                    border: `0.5px solid ${TIER_COLOR[data.sellerTier]}40`,
                  }}
                >
                  {data.sellerTier.replace('_', ' ')}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {data.totalSales} sale{data.totalSales !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <ScoreBar value={Math.min(25, (data.totalSales / 25) * 25)} max={25} label="Completed sales" />
              <ScoreBar value={data.averageRating ? (data.averageRating / 5) * 25 : 0} max={25} label="Rating average" />
              <ScoreBar value={data.trustScore * 0.2} max={20} label="Delivery success" />
              <ScoreBar value={data.trustScore * 0.15} max={15} label="Dispatch speed" />
              <ScoreBar value={data.trustScore * 0.10} max={10} label="Listing quality" />
              <ScoreBar value={data.trustScore * 0.05} max={5} label="Account age" />
            </div>

            {TIER_NEXT[data.sellerTier] && (
              <div
                className="mt-4 pt-4 text-xs"
                style={{ borderTop: '0.5px solid var(--border-divider)', color: 'var(--text-tertiary)' }}
              >
                Next tier: <span style={{ color: 'var(--text-secondary)' }}>{TIER_NEXT[data.sellerTier]!.label}</span>
                {' '}— {TIER_NEXT[data.sellerTier]!.req}
              </div>
            )}
          </div>

          {/* Recent ratings */}
          <div
            data-reveal
            className="rounded-[8px] p-5"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <p className="text-xs uppercase mb-4" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
              Recent ratings
            </p>

            {data.recentRatings.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No ratings yet.
              </p>
            ) : (
              <div className="space-y-4">
                {data.recentRatings.map((r) => (
                  <div key={r.id}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {r.rater.username ?? 'Anonymous'} · {r.transaction.listing.title.slice(0, 30)}
                      </span>
                      <span style={{ color: '#f59e0b', fontSize: '13px' }}>
                        {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
                      </span>
                    </div>
                    {r.comment && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {r.comment}
                      </p>
                    )}
                    <div
                      className="mt-2"
                      style={{ borderTop: '0.5px solid var(--border-divider)' }}
                    />
                  </div>
                ))}
              </div>
            )}

            {data.averageRating && (
              <div className="mt-4 pt-3 flex items-center gap-2" style={{ borderTop: '0.5px solid var(--border-divider)' }}>
                <span className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
                  {data.averageRating.toFixed(1)}
                </span>
                <span style={{ color: '#f59e0b' }}>★</span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  average from {data.recentRatings.length} rating{data.recentRatings.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Buyer questions on this seller's listings — spans the full
              grid width because the answer composer needs the horizontal
              room. Self-fetches via /me/questions on mount. */}
          <div className="lg:col-span-2">
            <SellerQuestionsCard />
          </div>
        </PageReveal>
      )}
    </main>
  );
}
