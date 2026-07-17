import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { auth, currentUser } from '@clerk/nextjs/server';
import { Me, TrustDashboard, SellerTier } from '@/lib/types';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { HelpTip } from '@/components/help-tip';
import { SellerVerificationProgress } from '@/components/seller-verification-progress';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Seller-tier brand colours — match the rest of the app (Dashboard,
// listing cards). Order: New → Established → Trusted → Top Seller → Dealer.
const TIER_COLOR: Record<SellerTier, string> = {
  NEW: 'var(--text-tertiary)',
  ESTABLISHED: '#6366f1',
  TRUSTED: '#0ea5e9',
  TOP_SELLER: '#f59e0b',
  DEALER: 'var(--red)',
};

const TIER_LABEL: Record<SellerTier, string> = {
  NEW: 'New seller',
  ESTABLISHED: 'Established',
  TRUSTED: 'Trusted',
  TOP_SELLER: 'Top Seller',
  DEALER: 'Dealer',
};

const KYC_TONE: Record<string, { label: string; colour: string }> = {
  NONE: { label: 'Not verified', colour: 'var(--text-tertiary)' },
  PENDING: { label: 'Verification pending', colour: '#f59e0b' },
  VERIFIED: { label: 'ID verified', colour: '#22c55e' },
  REJECTED: { label: 'Verification rejected', colour: 'var(--red)' },
  UNDER_REVIEW: { label: 'Verification being reviewed', colour: '#f59e0b' },
};

function StatCard({
  label,
  value,
  hint,
  tip,
}: {
  label: string;
  value: string;
  hint?: string;
  tip?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[8px] p-5"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-2"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {label}
        {tip && (
          <HelpTip title={label} side="bottom">
            {tip}
          </HelpTip>
        )}
      </p>
      <p
        className="text-2xl"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        {value}
      </p>
      {hint && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export const metadata = {
  title: 'My profile — Gun Galore',
};

// Parse a fetch Response safely: null on a missing/non-OK response or an
// empty/unparseable body, so a transient backend blip never throws in the
// server component (which would 500 the page).
async function safeJson<T>(res: Response | null): Promise<T | null> {
  if (!res || !res.ok) return null;
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export default async function ProfilePage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/profile');

  const clerkUser = await currentUser();
  const token = await getToken();

  // Fetch our backend's user record + the trust dashboard. The Me record
  // is the source of truth for seller tier / KYC status / totals;
  // TrustDashboard adds the recent ratings list.
  // Guard both the fetch (backend unreachable → reject) AND the json() parse
  // (a 200 with an empty/partial body → "Unexpected end of JSON input"). Either
  // failure degrades to null instead of 500-ing the whole page — matching the
  // resilience the /account page already has.
  const [meRes, trustRes] = await Promise.all([
    fetch(`${API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => null),
    fetch(`${API_URL}/ratings/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => null),
  ]);
  const me: Me | null = await safeJson<Me>(meRes);
  const trust: TrustDashboard | null = await safeJson<TrustDashboard>(trustRes);

  const displayName =
    [me?.firstName, me?.lastName].filter(Boolean).join(' ') ||
    clerkUser?.fullName ||
    clerkUser?.firstName ||
    me?.email ||
    'You';
  const tier = me?.sellerTier ?? 'NEW';
  const kyc = me ? KYC_TONE[me.kycStatus] : KYC_TONE.NONE;
  const avatarUrl = clerkUser?.imageUrl;

  return (
    <main
      className="relative max-w-[1100px] mx-auto px-4 py-8"
      style={{ zIndex: 1 }}
    >
      {/* House standard scenery — wrenches, matches /profile/edit so
          the identity pages feel like one suite. */}
      <PageBackground
        imageSrc="/setting.jpg"
        opacity={0.5}
        tint={0.12}
        vignette={0.7}
      />

      {/* ── Hero ──────────────────────────────────────────────────────
          Hero is the page <header> — sits OUTSIDE PageReveal so the
          seller's identity card renders at full opacity instantly. The
          card uses --bg-deep (slightly darker than --bg-card) so the
          wrenches scenery behind doesn't bleed through visually; the
          avatar + name carry explicit opacity:1 to immunise them
          against any inherited fade from parent transitions. */}
      <header
        className="rounded-[8px] p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-7 mb-6"
        style={{
          // STACKING NOTE — this is critical, do not delete the
          // position/zIndex below. <PageBackground> renders three
          // fixed-position divs (image, tint, vignette) at zIndex 0
          // INSIDE main. Without an explicit stacking context here, the
          // hero paints in normal flow (step 3 of the stacking algo)
          // and the fixed divs (step 5, explicit z-index) paint OVER
          // it — the visible effect is the wrenches bleeding straight
          // through the card. Stat cards below avoid this because
          // PageReveal applies `transform` to its descendants, which
          // creates a new stacking context for free. The hero is
          // outside PageReveal, so we need to make our own.
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          position: 'relative',
          zIndex: 1,
          opacity: 1,
        }}
      >
        {/* Avatar — uses Clerk's stored image, falls back to initials.
            opacity:1 on the wrapper AND the Image keeps it crisp even
            if a future CSS rule tries to fade it. */}
        <div
          className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
          style={{
            width: 88,
            height: 88,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            opacity: 1,
          }}
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={displayName}
              width={88}
              height={88}
              className="object-cover"
              style={{ opacity: 1 }}
            />
          ) : (
            <span
              className="text-2xl"
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                opacity: 1,
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p
            className="text-xs uppercase mb-1"
            style={{
              color: TIER_COLOR[tier],
              letterSpacing: '0.12em',
              fontWeight: 500,
            }}
          >
            {TIER_LABEL[tier]}
          </p>
          <h1
            className="text-2xl sm:text-3xl mb-1"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              opacity: 1,
            }}
          >
            {displayName}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {me?.email}
            {me?.createdAt && (
              <>
                {' '}·{' '}
                <span>Member since {formatRelative(me.createdAt)}</span>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span
              className="text-xs px-2.5 py-1 rounded-full"
              style={{
                background: `${kyc.colour}22`,
                color: kyc.colour,
                border: `0.5px solid ${kyc.colour}`,
                fontWeight: 500,
              }}
            >
              {kyc.label}
            </span>
            <span
              className="text-xs px-2.5 py-1 rounded-full"
              style={{
                background: `${TIER_COLOR[tier]}22`,
                color: TIER_COLOR[tier],
                border: `0.5px solid ${TIER_COLOR[tier]}`,
                fontWeight: 500,
              }}
            >
              {TIER_LABEL[tier]}
            </span>
          </div>

          {/* KYC-rejected recovery banner — when the seller is in the
              REJECTED state they were previously stuck with a red
              chip and no explanation of what to do. Surfaces the
              consequence (payouts blocked) and an explicit support
              contact path. Manual re-submit isn't available via the
              VerifyNow stub yet, so support handles it. */}
          {me?.kycStatus === 'REJECTED' && (
            <div
              className="mt-3 rounded-[6px] px-3 py-2.5 text-xs"
              style={{
                background: 'rgba(200,16,46,0.10)',
                border: '0.5px solid var(--red)',
                color: 'var(--text-primary)',
                lineHeight: 1.55,
                maxWidth: 520,
              }}
            >
              <p style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
                Identity verification was rejected
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                Your payouts are blocked until your identity is verified.
                Common causes: blurry ID photo, glare, face not centred,
                or document type not accepted. We don&apos;t auto-retry
                — email{' '}
                <a
                  href="mailto:support@gungalore.co.za?subject=KYC%20rejected%20%E2%80%94%20help%20resubmitting"
                  style={{ color: 'var(--red)', textDecoration: 'underline' }}
                >
                  support@gungalore.co.za
                </a>{' '}
                and we&apos;ll reset the verification so you can try
                again with a fresh photo.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 self-stretch sm:self-center w-full sm:w-auto">
          <Link
            href="/profile/edit"
            className="text-sm px-4 py-2 rounded-[6px] text-center"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Edit profile
          </Link>
          {/* "Verify identity" used to live here. KYC is now triggered
              automatically on the seller's first sale — see
              backend/src/kyc/kyc.service.ts → triggerSellerVerification.
              The seller is prompted via SMS + email + in-app banner. */}
          <Link
            href="/dashboard"
            className="text-sm px-4 py-2 rounded-[6px] text-center"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            Trust dashboard
          </Link>
        </div>
      </header>

      {/* Reveal — body cards animate, header above does not. */}
      <PageReveal className="space-y-6">

      {/* ── Seller setup progress ─────────────────────────────────────
          Only renders for sellers (5-section completeness shape from the
          backend). Buyers see nothing here. */}
      {me && (
        <div data-reveal>
          <SellerVerificationProgress me={me} />
        </div>
      )}

      {/* ── Stats ───────────────────────────────────────────────────── */}
      <div data-reveal className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total sales"
          value={(me?.totalSales ?? 0).toLocaleString('en-ZA')}
          hint="Completed transactions"
        />
        <StatCard
          label="Average rating"
          value={
            me?.averageRating != null && me.averageRating > 0
              ? `${me.averageRating.toFixed(1)} ★`
              : '—'
          }
          hint={
            trust && trust.recentRatings.length > 0
              ? `From ${trust.recentRatings.length}+ reviews`
              : 'No ratings yet'
          }
        />
        <StatCard
          label="Trust score"
          value={`${Math.round(me?.trustScore ?? 0)}/100`}
          hint="Tier-based metric"
          tip={
            <>
              A blended score (0-100) of your tier, sales history,
              dispute rate, and KYC status. Buyers see this on your
              listings as a quick read of how safe you are to deal with.
              Climbs automatically as you complete clean sales.
            </>
          }
        />
        <StatCard
          label="Tier"
          value={TIER_LABEL[tier]}
          hint="Auto-upgrades with sales"
          tip={
            <>
              Tiers reflect your seller experience: NEW (just signed
              up), VERIFIED (KYC complete + first sale), TRUSTED
              (10+ clean sales), DEALER (licensed firearms dealer).
              Higher tiers get faster payouts, lower fees on featured
              slots, and higher listing limits.
            </>
          }
        />
      </div>

      {/* ── Recent reviews + Account info ───────────────────────────── */}
      <div data-reveal className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Recent ratings */}
        <section
          className="rounded-[8px] p-5"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <h2
            className="text-base mb-4"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Recent reviews
          </h2>
          {trust && trust.recentRatings.length > 0 ? (
            <ul className="space-y-4">
              {trust.recentRatings.slice(0, 5).map((r) => (
                <li
                  key={r.id}
                  className="pb-4"
                  style={{ borderBottom: '0.5px solid var(--border)' }}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span
                      className="text-sm"
                      style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                    >
                      {r.rater.username ?? 'Anonymous'}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {'★'.repeat(r.stars)}
                      {'☆'.repeat(5 - r.stars)}
                    </span>
                  </div>
                  <p
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {r.transaction.listing.title} ·{' '}
                    {formatRelative(r.createdAt)}
                  </p>
                  {r.comment && (
                    <p
                      className="text-sm"
                      style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                    >
                      &ldquo;{r.comment}&rdquo;
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="text-sm py-6 text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No reviews yet. They&apos;ll show up here after your first
              completed sale.
            </p>
          )}
        </section>

        {/* Account info + quick actions */}
        <aside className="space-y-4">
          <section
            className="rounded-[8px] p-5"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <h2
              className="text-base mb-4"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Account
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt
                  className="text-xs mb-0.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Email
                </dt>
                <dd style={{ color: 'var(--text-primary)' }}>{me?.email}</dd>
              </div>
              {me?.createdAt && (
                <div>
                  <dt
                    className="text-xs mb-0.5"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Joined
                  </dt>
                  <dd style={{ color: 'var(--text-primary)' }}>
                    {new Date(me.createdAt).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
              )}
              {me?.kycVerifiedAt && (
                <div>
                  <dt
                    className="text-xs mb-0.5"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    ID verified
                  </dt>
                  <dd style={{ color: 'var(--text-primary)' }}>
                    {new Date(me.kycVerifiedAt).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section
            className="rounded-[8px] p-5"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <h2
              className="text-base mb-3"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Quick links
            </h2>
            <ul className="space-y-2">
              {[
                { href: '/my/listings', label: 'My listings' },
                { href: '/my/orders', label: 'Orders' },
                { href: '/my/sales', label: 'Sales' },
                { href: '/my/earnings', label: 'Earnings & insights' },
                { href: '/my/offers', label: 'Offers' },
                { href: '/my/bids', label: 'Bids' },
                { href: '/wishlist', label: 'Wishlist' },
                { href: '/support', label: 'Support' },
                { href: '/settings', label: 'Settings' },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm block py-1"
                    style={{
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                    }}
                  >
                    {label} →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      </PageReveal>
    </main>
  );
}
