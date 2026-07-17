import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@clerk/nextjs/server';
import { Me, SellerTier } from '@/lib/types';
import { ACCOUNT_GROUPS } from '@/lib/account-menu-data';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { AccountWishlistCount } from './wishlist-count';

// Server-rendered account hub (UX-2). One landing page that orients the buyer/
// seller: identity + GG+ tier + KYC status, then every account task grouped as
// cards (single source of truth: ACCOUNT_GROUPS). Additive — the nav dropdown,
// mobile drawer and PWA More-sheet keep their flat lists; the header cards in
// each now point here.
//
// Read-only: all GETs, no mutations, no checkout/money involvement.

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const TIER_LABEL: Record<SellerTier, string> = {
  NEW: 'New seller',
  ESTABLISHED: 'Established',
  TRUSTED: 'Trusted',
  TOP_SELLER: 'Top Seller',
  DEALER: 'Dealer',
};

const KYC_TONE: Record<string, { label: string; colour: string }> = {
  NONE: { label: 'ID not verified', colour: 'var(--text-tertiary)' },
  PENDING: { label: 'ID check pending', colour: '#f59e0b' },
  VERIFIED: { label: 'ID verified', colour: '#22c55e' },
  REJECTED: { label: 'ID check failed', colour: 'var(--red)' },
};

function Pill({ n }: { n: number }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        padding: '1px 8px',
        minWidth: 20,
        textAlign: 'center',
      }}
    >
      {n}
    </span>
  );
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Parse a fetch Response safely. Critically guards the `.json()` call: an
// endpoint can legitimately answer 200 with an EMPTY body (e.g.
// /subscriptions/me for a brand-new user with no subscription), and a raw
// res.json() on that throws "Unexpected end of JSON input", 500-ing the whole
// account page. Returns the fallback instead of throwing.
async function safeJson<T>(res: Response | null, fallback: T): Promise<T> {
  if (!res || !res.ok) return fallback;
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default async function AccountPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/account');
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}` };

  const [meRes, subRes, alertsRes, ordersRes] = await Promise.all([
    fetch(`${API_URL}/users/me`, { headers, cache: 'no-store' }).catch(() => null),
    fetch(`${API_URL}/subscriptions/me`, { headers, cache: 'no-store' }).catch(() => null),
    fetch(`${API_URL}/notifications/me/active-count`, { headers, cache: 'no-store' }).catch(() => null),
    fetch(`${API_URL}/transactions?role=buyer`, { headers, cache: 'no-store' }).catch(() => null),
  ]);

  const me = await safeJson<Me | null>(meRes, null);
  const sub = await safeJson<{ tier?: string; periodEnd?: string | null } | null>(
    subRes,
    null,
  );
  const alerts = await safeJson<{ total?: number } | null>(alertsRes, null);
  const orders = await safeJson<{ paymentStatus?: string }[]>(ordersRes, []);

  const unread = alerts?.total ?? 0;
  const activeOrders = Array.isArray(orders)
    ? orders.filter(
        (t) =>
          t.paymentStatus === 'HELD' || t.paymentStatus === 'PENDING_ADMIN_VERIFICATION',
      ).length
    : 0;

  // Live count badges, keyed by the ACCOUNT_GROUPS href they annotate.
  const countByHref: Record<string, number> = {
    '/my/orders': activeOrders,
    '/notifications': unread,
  };

  const username = me?.username ?? 'Your account';
  const kyc = KYC_TONE[me?.kycStatus ?? 'NONE'] ?? KYC_TONE.NONE;
  const ggPlus = sub?.tier === 'MEMBER' || sub?.tier === 'PRO' ? sub.tier : null;
  const periodEnd = fmtDate(sub?.periodEnd);

  return (
    <>
      <PageBackground />
      <main className="max-w-[1000px] mx-auto px-4 py-8">
        {/* Identity header card */}
        <div
          className="rounded-[10px] p-5 mb-6 flex items-center gap-4 flex-wrap"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              overflow: 'hidden',
              flexShrink: 0,
              background: 'var(--red)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 500,
              fontSize: 22,
            }}
          >
            {me?.avatarUrl ? (
              <Image src={me.avatarUrl} alt="" width={56} height={56} style={{ objectFit: 'cover' }} />
            ) : (
              username.charAt(0).toUpperCase()
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="text-lg" style={{ color: 'var(--text-primary)', fontWeight: 500, margin: 0 }}>
              {username}
            </h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {/* KYC status chip */}
              <span
                className="text-xs px-2 py-0.5 rounded-[4px]"
                style={{
                  color: kyc.colour,
                  background: 'var(--bg-inset)',
                  border: `0.5px solid ${kyc.colour}`,
                }}
              >
                {kyc.label}
              </span>
              {/* GG+ tier chip (or a join nudge) */}
              {ggPlus ? (
                <span
                  className="text-xs px-2 py-0.5 rounded-[4px]"
                  style={{ color: 'var(--red)', background: 'rgba(200,16,46,0.10)', border: '0.5px solid var(--red)' }}
                >
                  GG+ {ggPlus}
                  {periodEnd ? ` · renews ${periodEnd}` : ''}
                </span>
              ) : (
                <Link
                  href="/subscribe"
                  className="text-xs px-2 py-0.5 rounded-[4px]"
                  style={{
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    textDecoration: 'none',
                  }}
                >
                  Join GG+
                </Link>
              )}
              {me && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {TIER_LABEL[me.sellerTier]}
                </span>
              )}
            </div>
          </div>
          <Link
            href="/profile"
            className="text-sm px-3 py-2 rounded-[6px]"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            Edit profile
          </Link>
        </div>

        {/* Grouped account cards */}
        <PageReveal>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {ACCOUNT_GROUPS.map((group) => (
              <div
                key={group.title}
                className="rounded-[10px] overflow-hidden"
                style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
              >
                <p
                  className="text-xs uppercase"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.06em',
                    fontWeight: 600,
                    padding: '14px 16px 6px',
                    margin: 0,
                  }}
                >
                  {group.title}
                </p>
                {group.items.map((item) => {
                  const count = countByHref[item.href];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3"
                      style={{
                        padding: '11px 16px',
                        fontSize: 14,
                        textDecoration: 'none',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                        <item.Icon />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                      {item.href === '/wishlist' ? (
                        <AccountWishlistCount />
                      ) : count && count > 0 ? (
                        <Pill n={count} />
                      ) : null}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-tertiary)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </Link>
                  );
                })}
              </div>
            ))}

            {/* Support card — links out to help surfaces (not in ACCOUNT_GROUPS). */}
            <div
              className="rounded-[10px] overflow-hidden"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p
                className="text-xs uppercase"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  padding: '14px 16px 6px',
                  margin: 0,
                }}
              >
                Help
              </p>
              {[
                { href: '/support', label: 'Support & tickets' },
                { href: '/faq', label: 'FAQ' },
                { href: '/how-selling-works', label: 'How selling works' },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3"
                  style={{ padding: '11px 16px', fontSize: 14, textDecoration: 'none', color: 'var(--text-secondary)' }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </PageReveal>
      </main>
    </>
  );
}
