import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AccountSignOut } from '@/components/account-sign-out';
import { PushToggleRow } from '@/components/push-opt-in-banner';
import Image from 'next/image';
import { serverAuth as auth } from '../../lib/auth-server';
import { Me, SellerTier } from '@/lib/types';
import { ACCOUNT_GROUPS } from '@/lib/account-menu-data';

/** Shape of GET /users/me/account-summary. Mirrors the service's return type. */
type AccountSummary = {
  listings: {
    active: number;
    draft: number;
    pendingReview: number;
    paymentPending: number;
    sold: number;
    cancelled: number;
    expired: number;
  };
  pendingOffersAsSeller: number;
  pendingBidsAsBuyer: number;
  parcelsInTransit: number;
  totalPayoutReleasedCents: number;
};

/**
 * The quiet state total beside a destination's label — "3 active · 1 draft".
 *
 * ⚠️ NOT A BADGE, DELIBERATELY. The red pill on this page means "something is
 * waiting for your answer". These say how much of a thing exists, which is a
 * different claim, and rendering them the same way would turn every passive
 * total into a demand.
 *
 * Returns null rather than "0" for an empty state: a member with no drafts does
 * not need to be told so on a menu row.
 */
function statFor(href: string, s: AccountSummary | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  switch (href) {
    case '/my/listings': {
      if (s.listings.active) parts.push(`${s.listings.active} active`);
      if (s.listings.draft) parts.push(`${s.listings.draft} draft`);
      break;
    }
    case '/offers/received':
      if (s.pendingOffersAsSeller) {
        parts.push(
          `${s.pendingOffersAsSeller} need${s.pendingOffersAsSeller === 1 ? 's' : ''} your answer`,
        );
      }
      break;
    case '/my/bids':
      if (s.pendingBidsAsBuyer) parts.push(`${s.pendingBidsAsBuyer} open`);
      break;
    case '/shipping':
      if (s.parcelsInTransit) {
        parts.push(`${s.parcelsInTransit} on the way`);
      }
      break;
    default:
      return null;
  }
  return parts.length ? parts.join(' · ') : null;
}
import { PageReveal } from '@/components/page-reveal';
import { AccountWishlistCount } from './wishlist-count';

// Server-rendered account hub (UX-2). One landing page that orients the buyer/
// seller: identity + GG+ tier + KYC status, then every account task grouped as
// cards (single source of truth: ACCOUNT_GROUPS). Additive — the nav dropdown,
// mobile drawer and PWA More-sheet keep their flat lists; the header cards in
// each now point here.
//
// ⚠️ RENAMED / FLATTENED 2026-09-13. This page used to give the Motivation
// Centre a hero tier and flank it with Document Centre + Load Lab cards,
// because those were the highest-value destinations here. As of this date
// Motivations, the Document Centre and The Bench have been PROMOTED to their
// own "Armory" tile on the landing page — so this hub deliberately no longer
// gives them special treatment. They are now three ordinary rows inside the
// grouped card list below, same as every other destination, reading off the
// "Armory" group in ACCOUNT_GROUPS like everything else. There is exactly one
// tier of destination cards now, not three.
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

// Every count this page can show today comes from unresolved-notification
// data (module-counts / active-count, fetched below) — the same "action
// needed" rows the bell counts, which the nav dropdown's CountBadge and the
// bottom-tab-bar's Account badge already render as a filled red pill (see
// account-menu.tsx). This page was the one surface still drawing them
// neutral, which is exactly the design-review gap: "2 offers need your
// answer" read no more urgent than a total. Filled --red matches those
// other surfaces rather than inventing a new treatment.
//
// The Wishlist row next to these stays a neutral pill on purpose — see
// AccountWishlistCount in ./wishlist-count.tsx — because a saved-items
// count genuinely isn't urgent. Nothing here fabricates a number: this only
// ever renders counts the page already fetched.
function UrgentPill({ n }: { n: number }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#fff',
        background: 'var(--red)',
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

// Trailing row chevron, shared by every destination row in the grouped card
// list below.
function RowChevron() {
  return (
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
      style={{ flexShrink: 0 }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
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

  const [meRes, alertsRes, moduleCountsRes, summaryRes] = await Promise.all([
    fetch(`${API_URL}/users/me`, { headers, cache: 'no-store' }).catch(() => null),
    fetch(`${API_URL}/notifications/me/active-count`, { headers, cache: 'no-store' }).catch(() => null),
    // Same per-module notification counts the dropdown / drawer / PWA More
    // sheet badge with, so the hub cards and the menus always agree.
    fetch(`${API_URL}/notifications/me/module-counts`, { headers, cache: 'no-store' }).catch(() => null),
    // State totals for the hub's stat lines. In the same Promise.all as the
    // rest — this page already makes three calls and a fourth in series would
    // add its whole latency to a page opened on every visit.
    fetch(`${API_URL}/users/me/account-summary`, { headers, cache: 'no-store' }).catch(() => null),
  ]);

  // Distinguish "the backend answered and this is your real state" from
  // "we couldn't reach the backend". safeJson degrades both to null, and
  // rendering the fallback as fact is actively misleading here: a verified
  // seller would be shown "ID not verified" with no way to tell it's a blip.
  const meFailed = !meRes || !meRes.ok;

  const me = await safeJson<Me | null>(meRes, null);
  const alerts = await safeJson<{ total?: number } | null>(alertsRes, null);
  const moduleCounts = await safeJson<Record<string, number>>(moduleCountsRes, {});

  // Null, not zeros, when the call fails — see the note at the top of the stat
  // helpers. Every line keys off this being present.
  const summary = await safeJson<AccountSummary | null>(summaryRes, null);

  // A 200 with an empty/unparseable body is just as unusable as a non-OK
  // one — /users/me always returns a record for a synced user.
  const identityUnknown = meFailed || !me;

  const unread = alerts?.total ?? 0;

  // Live count badges, keyed by the ACCOUNT_GROUPS href they annotate —
  // the shared per-module notification counts, plus the overall unread
  // total on the Notifications row itself.
  const countByHref: Record<string, number> = {
    ...moduleCounts,
    '/notifications': unread,
  };

  const username = me?.username ?? 'Your account';
  const kyc = KYC_TONE[me?.kycStatus ?? 'NONE'] ?? KYC_TONE.NONE;

  return (
    <>
      <main className="max-w-[var(--content-max)] mx-auto px-4 py-8">
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
              {/* KYC status chip — hidden when we couldn't load the user, so
                  a verified seller is never told "ID not verified" by an
                  outage (that reads as a broken account, not a broken fetch). */}
              {!identityUnknown && (
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
              )}
              {me && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {TIER_LABEL[me.sellerTier]}
                </span>
              )}
            </div>
            {/* Transient-failure notice. Neutral tone on purpose — this is
                our problem, not a problem with their account, and the chips
                above are absent rather than wrong while it shows. */}
            {identityUnknown && (
              <p
                className="text-xs"
                style={{ color: 'var(--text-tertiary)', margin: '8px 0 0' }}
              >
                Couldn&apos;t load your account status — refresh to try again.
                Everything else on this page still works.
              </p>
            )}
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

          {/* ⚠️ THE ONLY DESKTOP SIGN-OUT NOW. It used to live solely
              inside the nav's avatar dropdown; the avatar became a link to
              this page on 2026-08-27, so without this there is no way out
              on desktop at all. The design's Account board puts Log out
              here, at the top right of the identity card. */}
          <AccountSignOut />
        </div>

        {/* Grouped account cards — every ACCOUNT_GROUPS destination, one
            flat tier. Motivations, the Paper Work Vault and the Reloading
            Tool (the "Armory" group) used to get a hero + flanking-card
            treatment here; as of 2026-09-13 they were promoted to their own
            Armory tile on the landing page, so this hub no longer singles
            them out — they render as ordinary rows below like everything
            else. */}
        <PageReveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  className="gg-tile rounded-[10px] overflow-hidden"
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
                        {/* The board's passive state total. NOT the same
                            thing as `count` below, which is an unresolved-
                            notification tally — see statFor(). */}
                        {(() => {
                          const stat = statFor(item.href, summary);
                          return stat ? (
                            <span
                              className="text-xs"
                              style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
                            >
                              {stat}
                            </span>
                          ) : null;
                        })()}
                        {item.href === '/wishlist' ? (
                          <AccountWishlistCount />
                        ) : count && count > 0 ? (
                          <UrgentPill n={count} />
                        ) : null}
                        <RowChevron />
                      </Link>
                    );
                  })}
                </div>
              ))}

              {/* Help now lives in ACCOUNT_GROUPS (shared with the dropdown /
                  drawer / More sheet), so it renders with the groups above. */}

              {/* ⚠️ PUSH NOTIFICATIONS HAVE NOWHERE ELSE TO GO. This toggle used
                  to exist in exactly one place — the bottom tab bar's "More"
                  sheet — and that sheet is no longer reachable now the Account
                  tab is a link to this page rather than a sheet trigger. Without
                  it here an installed member has no way to turn notifications on
                  or off at all. It self-hides where push is unsupported.

                  ⚠️ THE <ul> AND THE CARD AROUND IT ARE BOTH REQUIRED.
                  PushToggleRow returns a bare <li> — it was written for the
                  sheet's list. Dropped straight into this grid it rendered as an
                  orphan list item: a bullet point and a label, floating under the
                  card grid with no card around it. Verified on the live site
                  before this wrapper existed. */}
              <div
                className="gg-tile rounded-[10px] overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  // ⚠️ NO maxWidth HERE. This is a cell in a
                  // `repeat(auto-fit, minmax(240px, 1fr))` grid, so a
                  // `calc(50% - 8px)` cap halved the CELL, not the row —
                  // squeezing the tile to 140px, wrapping "Push
                  // notifications" onto two lines and pushing its state
                  // label clean outside the card. Measured on the live site
                  // at 2026-08-28. A `marginTop: 16` went with it: on a grid
                  // item it only dropped this one tile below its own row.
                }}
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
                  Notifications
                </p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  <PushToggleRow />
                </ul>
              </div>
            </div>
          </div>
        </PageReveal>
      </main>
    </>
  );
}
