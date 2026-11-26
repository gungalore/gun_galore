import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { serverAuth as auth } from '../../../lib/auth-server';
import { apiFetch } from '@/lib/api';
import { Listing, CheckoutHold } from '@/lib/types';
import { CheckoutForm } from './checkout-form';
import { CheckoutProgress } from '@/components/checkout-progress';

/**
 * Read the listing this checkout is for.
 *
 * Two credentials can authorise it, and a server-side fetch cannot rely on
 * either cookie (a server-to-server fetch carries no cookie jar):
 *
 *  - `?t=<token>` — a CHECKOUT action token from the winner's SMS/email. It is
 *    the credential the middleware already exempts this page for, so the
 *    listing is read through the token-scoped endpoint instead of the
 *    ContentAccessGuard-protected public one. Without this the winner saw the
 *    404 page, because the 18+ gate 404s the public listing read.
 *  - a session — the ordinary signed-in path.
 */
async function loadCheckoutListing(
  listingId: string,
  actionToken: string | undefined,
  sessionToken: string | null,
): Promise<Listing | null> {
  if (actionToken) {
    const viaToken = await apiFetch<Listing>(
      `/actions/${encodeURIComponent(actionToken)}/checkout-listing`,
      { cache: 'no-store' },
    ).catch(() => null);
    if (viaToken) return viaToken;
  }
  return apiFetch<Listing>(`/listings/${listingId}`, {
    cache: 'no-store',
    headers: sessionToken
      ? { Authorization: `Bearer ${sessionToken}` }
      : undefined,
  }).catch(() => null);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { listingId } = await params;
  const { t: actionToken } = await searchParams;
  // Forward the buyer's session token — members-only stock (firearms) is
  // 404'd to anonymous callers, and this SSR fetch carries no cookie jar.
  const { token } = await auth();
  const listing = await loadCheckoutListing(listingId, actionToken, token);
  if (!listing) return { title: 'Checkout — ALL Outdoor' };
  return { title: `Buy ${listing.title} — ALL Outdoor` };
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ t?: string; from?: string }>;
}) {
  const { listingId } = await params;
  const { t: actionToken, from } = await searchParams;

  // Members-only stock (firearms) 404s for anonymous callers, so the buyer's
  // session token MUST be forwarded or every firearm Marketplace dead-ends on
  // a 404 here. A CHECKOUT action token is the other credential: see
  // loadCheckoutListing (the winner's SMS pay link has no session).
  const { userId, token } = await auth();
  const listing = await loadCheckoutListing(listingId, actionToken, token);


  if (!listing) return notFound();
  // P0.2 — auction winners land here from the "you won" SMS/token link.
  // finalizeAuction has already flipped the listing to PAYMENT_PENDING, so
  // the ACTIVE/BUY_NOW gate would 404 every won auction. The backend
  // enforces winner-only + the 24h window at POST time; here we render the
  // checkout with the WINNING BID as the price.
  const isAuctionWin =
    listing.listingType === 'AUCTION' && listing.status === 'PAYMENT_PENDING';

  // The 15-minute hold starts when the page opens. Fetch an existing one first
  // so a reload (which sees the listing already PAYMENT_PENDING) can still
  // render for the buyer who holds it. SMS-link buyers carry the CHECKOUT
  // action token instead of a session.
  let initialHold: CheckoutHold | null = null;
  if (listing.listingType === 'BUY_NOW' && (token || actionToken)) {
    const query = actionToken
      ? `?listingId=${encodeURIComponent(listingId)}&t=${encodeURIComponent(actionToken)}`
      : `?listingId=${encodeURIComponent(listingId)}`;
    initialHold = await apiFetch<CheckoutHold>(`/transactions/hold${query}`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => null);
  }

  // 2026-11-24 buyer report: they backed out of the Peach card page and the
  // checkout came back with a disabled Pay button. Ask whether THIS signed-in
  // buyer owns an unfinished payment for this listing — a tracked listing
  // stays ACTIVE while a HELD gateway transaction exists, so the old
  // PAYMENT_PENDING-only lookup missed exactly this case. The form shows
  // Resume payment / Start again from it.
  let unpaidTransactionId: string | null = null;
  if (
    !isAuctionWin &&
    listing.listingType === 'BUY_NOW' &&
    userId &&
    token
  ) {
    const unpaid = await apiFetch<{ transactionId: string | null }>(
      `/transactions/unpaid?listingId=${encodeURIComponent(listingId)}`,
      {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      },
    ).catch(() => null);
    unpaidTransactionId = unpaid?.transactionId ?? null;
  }

  if (!isAuctionWin) {
    if (listing.listingType !== 'BUY_NOW') return notFound();
    // ACTIVE = no hold yet. PAYMENT_PENDING is renderable when it is THIS
    // buyer's unexpired hold, and also when Pay already claimed the hold and
    // the buyer returned from Ozow: the form's POST /transactions/hold
    // reclaims their own unpaid attempt and starts a fresh hold. Another
    // buyer's reservation is rejected by that same POST, never released here.
    if (
      listing.status !== 'ACTIVE' &&
      listing.status !== 'PAYMENT_PENDING' &&
      !initialHold
    ) {
      return notFound();
    }
  }

  // Self-buy guard. Backend rejects with 400 anyway, but landing
  // here at all is confusing — kick them back to the listing detail
  // so they see the "this is your own listing" chip instead.
  if (userId && userId === listing.seller.userId) {
    redirect(`/listings/${listing.id}`);
  }

  // For an auction win the settled price is the winning bid — override the
  // (starting-bid) price so the summary + form show what the winner pays.
  const effectiveListing = isAuctionWin
    ? { ...listing, price: listing.currentBid ?? listing.price }
    : listing;

  // Back link context: the cart links here with ?from=cart (its
  // "buy this item on its own" escape for a collection-only line), so that is
  // the only case where "Back to cart" is literally true. Everything else —
  // a listing, a winner's SMS/token link — goes back to the listing.
  const backHref =
    from === 'cart' && !actionToken ? '/cart' : `/listings/${listing.id}`;
  const backLabel =
    from === 'cart' && !actionToken ? 'Back to cart' : 'Back to listing';

  return (
    <main className="max-w-[var(--content-max)] mx-auto px-4 py-6">
      <Link
        href={backHref}
        className="text-sm inline-block mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← {backLabel}
      </Link>

      <h1
        className="text-xl font-medium mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        Checkout
      </h1>
      <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Review how your item arrives, then pay securely.
      </p>

      <CheckoutProgress current={1} />

      {/* ONE form owns the whole review layout: the left review column and the
          sticky order summary/CTA are the same state, so the price beside the
          button is always the price the payload will submit. The listing card
          that used to sit outside the form now lives inside the summary. */}
      <CheckoutForm
        listing={effectiveListing}
        initialHold={initialHold}
        holdIncludedInListing={initialHold != null}
        unpaidTransactionId={unpaidTransactionId}
      />
    </main>
  );
}
