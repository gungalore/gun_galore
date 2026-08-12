import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Transaction } from '@/lib/types';
import {
  PAYMENT_STATUS,
  resolveStatus,
  toneColor,
  paymentStatusHint,
  type StatusTone,
} from '@/lib/status-labels';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface OrderCue {
  text: string;
  tone: StatusTone;
  /** True when the BUYER is the one holding the order up — rendered with a
   *  dot + weight so it reads differently from a passive progress note. */
  action?: boolean;
  /** Optional tooltip (same `title` treatment as the status pill). */
  hint?: string;
}

/** Short date for cue copy, matching the en-ZA formatting used on this page. */
function cueDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

/** The one thing that happens next on this order, from the BUYER's side.
 *
 * The status pill answers "where is my money"; it never answered "what do I
 * do". Every in-flight order — awaiting seller accept, in transit, or
 * delivered and waiting on the buyer — carried the identical amber "Payment
 * held" chip, so the buyer's only genuinely blocking action (confirming
 * receipt, which is what releases the seller's payout) was invisible until
 * they opened the transaction. That silence is what feeds the 72h
 * stuck-held-funds admin alerts.
 *
 * Everything below is derived from fields already in the list payload (the
 * API returns whole Transaction rows) — no extra fetch — and mirrors the
 * exact gates the order page uses to decide which panel to render, so the
 * cue can never promise a button that isn't there.
 *
 * Kept pure and role-agnostic in shape so the seller-side twin ("accept this
 * sale", "dispatch by …") can lift it into lib/ and add a branch rather than
 * fork it. (It can't be exported from a page file — Next rejects non-Next
 * exports from page modules — so the lift needs a shared module.)
 */
function nextActionCue(tx: Transaction, now: number): OrderCue | null {
  const method = tx.shippingMethod;
  const isExperience = !!tx.listing?.isExperience || method === 'ON_SITE_SERVICE';

  // ── Settled states ────────────────────────────────────────────────────
  // The pill already says "Payout released" / "Refunded". Only name a next
  // step where one genuinely exists after the money moved.
  if (tx.paymentStatus === 'RELEASED') {
    if (method === 'PRIVATE_ARRANGE' && tx.privateArrangeAcceptedAt) {
      // Release is exactly the moment the order page unlocks the seller's
      // contact details for the in-person hand-over.
      return {
        text: 'Seller contact details unlocked — arrange the hand-over',
        tone: 'info',
        action: true,
      };
    }
    if (method === 'DEALER_TRANSFER' && tx.dealerVerificationStatus === 'APPROVED') {
      return {
        text: 'Firearm booked in at the dealer — arrange the transfer',
        tone: 'info',
        action: true,
        hint: "Open the order for the dealer's name, address and phone number.",
      };
    }
    return null;
  }
  if (tx.paymentStatus === 'REFUNDED') return null;
  if (tx.paymentStatus === 'DISPUTED') {
    return {
      text: 'Dispute under review — our team will be in touch',
      tone: 'error',
      hint: 'Your payment stays held while we investigate.',
    };
  }
  if (tx.paymentStatus === 'PENDING_ADMIN_VERIFICATION') {
    return { text: 'Being verified by our team — nothing needed from you', tone: 'info' };
  }

  // ── HELD from here ────────────────────────────────────────────────────
  // Experiences run their own lifecycle (outfitter accept → attend → buyer
  // confirms it happened); they never touch dispatch or delivery.
  if (isExperience) {
    if (tx.bookingDeclinedAt) return null;
    if (!tx.bookingConfirmedAt) {
      return { text: 'Waiting on the outfitter to confirm your booking', tone: 'pending' };
    }
    if (tx.eventCompletedConfirmedAt) {
      return { text: 'Confirmed — payout is being released to the outfitter', tone: 'info' };
    }
    const eventPassed = !!tx.eventDate && new Date(tx.eventDate).getTime() <= now;
    if (eventPassed) {
      return {
        text: 'Action needed: confirm the experience happened',
        tone: 'pending',
        action: true,
        hint: "Confirming releases the outfitter's payment and is final.",
      };
    }
    const when = cueDate(tx.eventDate);
    return {
      text: when ? `Booked for ${when} — confirm here afterwards` : 'Booking confirmed',
      tone: 'info',
    };
  }

  // PRIVATE_ARRANGE releases on capture, so a HELD one is still settling —
  // the contact details aren't revealed yet and there's nothing to arrange.
  if (method === 'PRIVATE_ARRANGE') {
    return { text: 'Confirming payment — contact details unlock after that', tone: 'pending' };
  }

  // Seller accept gates everything downstream (TOK-7).
  if (!tx.acceptedAt && !tx.rejectedAt) {
    const missed = !!tx.acceptDeadlineAt && new Date(tx.acceptDeadlineAt).getTime() <= now;
    // There is NO auto-refund on the accept timeout — escalateStaleAccepts
    // flags it and a human decides. Same reason the order-page chip never
    // promises one; don't promise one in a list row either.
    return missed
      ? {
          text: 'Seller missed the accept window — our team is following it up',
          tone: 'error',
          hint: "You don't need to do anything. Your payment is still held.",
        }
      : {
          text: 'Waiting on the seller to accept the sale',
          tone: 'pending',
          hint: 'Sellers have 48 hours to confirm they can fulfil the order.',
        };
  }
  if (tx.rejectedAt) return null; // a rejection also flips the row to REFUNDED

  // Firearms: no buyer confirm step at all — payout releases on dealer
  // stock-in verification, so never ask this buyer to "confirm receipt".
  // (The isFirearm test matches the order page's own gate: a non-firearm
  // dealer transfer keeps the ordinary confirm-delivery button, so it must
  // NOT be told "nothing needed from you".)
  if (method === 'DEALER_TRANSFER' && tx.listing?.isFirearm) {
    switch (tx.dealerVerificationStatus) {
      case 'APPROVED':
        // Verified — the auto-release is in flight; the hand-off is the
        // buyer's to arrange from here.
        return {
          text: 'Firearm booked in at the dealer — arrange the transfer',
          tone: 'info',
          action: true,
          hint: "Open the order for the dealer's name, address and phone number.",
        };
      case 'PENDING_CLAUDE':
      case 'PENDING_ADMIN_REVIEW':
        return { text: 'Dealer paperwork under review', tone: 'info' };
      case 'REJECTED':
        return { text: 'Dealer paperwork sent back to the seller', tone: 'error' };
      default:
        return {
          text: 'Dealer transfer in progress — nothing needed from you yet',
          tone: 'info',
          hint: "We'll tell you once the firearm is booked into the dealer's stock.",
        };
    }
  }

  // Collection: no courier, no dispatch. The buyer fetches it, then confirms.
  if (method === 'COLLECTION') {
    if (tx.confirmedDeliveryAt) {
      return { text: 'Collection confirmed — payout releasing to the seller', tone: 'info' };
    }
    return {
      text: 'Arrange collection with the seller, then confirm it here',
      tone: 'pending',
      action: true,
      hint: 'Contact details are on the order page. Confirm only once you have the item.',
    };
  }

  // Consolidated parcel sibling — the carrier line owns dispatch, tracking
  // and the single confirm that releases the whole group.
  if (tx.shipsWithId) {
    return { text: 'Ships with another item in this order', tone: 'info' };
  }

  // Courier (PUDO / TCG) only past this point — the confirm-receipt prompt
  // belongs to those two rails and nothing else. An unrecognised (or null)
  // method gets no cue rather than a wrong one.
  if (method !== 'PUDO' && method !== 'TCG') return null;

  if (!tx.dispatchedAt) {
    return { text: 'Seller is preparing your parcel for dispatch', tone: 'pending' };
  }
  if (tx.confirmedDeliveryAt) {
    return { text: 'Receipt confirmed — payout releasing to the seller', tone: 'info' };
  }
  if (tx.deliveredAt || tx.shippingStatus === 'DELIVERED') {
    return {
      text: 'Action needed: confirm receipt',
      tone: 'pending',
      action: true,
      hint: "Confirming that the item arrived as described releases the seller's payment.",
    };
  }
  switch (tx.shippingStatus) {
    case 'DELIVERY_FAILED':
      return {
        text: 'Delivery failed — check with the courier',
        tone: 'error',
        action: true,
      };
    case 'RETURNED':
      return {
        text: 'Parcel returned to sender — open the order to raise it',
        tone: 'error',
        action: true,
      };
    case 'OUT_FOR_DELIVERY':
      return { text: 'Out for delivery', tone: 'info' };
    default:
      return { text: 'In transit — tap to track', tone: 'info' };
  }
}

export default async function MyOrdersPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/orders');

  const token = await getToken();
  const res = await fetch(`${API_URL}/transactions?role=buyer`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const transactions: Transaction[] = res.ok ? await res.json() : [];
  // One clock for the whole list so two rows can't disagree about whether a
  // deadline has passed. The page is `no-store`, so this is request-fresh.
  const now = Date.now();

  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
      <h1 data-reveal className="text-xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        My Orders
      </h1>

      {transactions.length === 0 ? (
        <div
          data-reveal
          className="rounded-[8px] py-12 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p
            className="text-base mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            No orders yet
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            When you buy something on All Outdoor, your order will show
            up here with shipping updates and dispatch details.
          </p>
          <Link
            href="/"
            className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Browse the marketplace →
          </Link>
        </div>
      ) : (
        <div data-reveal className="space-y-3">
          {transactions.map((tx) => {
            const status = resolveStatus(PAYMENT_STATUS, tx.paymentStatus);
            const color = toneColor(status.tone);
            const cue = nextActionCue(tx, now);
            const cueColor = cue ? toneColor(cue.tone) : undefined;
            return (
              <Link
                key={tx.id}
                href={`/transactions/${tx.id}`}
                className="flex items-center gap-4 p-4 rounded-[8px] transition-colors"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  textDecoration: 'none',
                }}
              >
                {tx.listing.images?.[0] && (
                  <Image
                    src={tx.listing.images[0].url}
                    alt={tx.listing.title}
                    width={56}
                    height={56}
                    sizes="56px"
                    className="w-14 h-14 rounded-[6px] object-cover shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {tx.listing.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    Seller: {tx.seller.username ?? 'Anonymous'}
                    {' · '}{new Date(tx.createdAt).toLocaleDateString('en-ZA')}
                  </p>
                  {/* Next-action cue. The dot only appears when the buyer is
                      the blocker, so a scan down the list picks out the rows
                      that actually need them. */}
                  {cue && (
                    <p
                      className="text-xs mt-1 flex items-center gap-1.5"
                      title={cue.hint}
                      style={{ color: cueColor, fontWeight: cue.action ? 500 : 400 }}
                    >
                      {cue.action && (
                        <span
                          aria-hidden="true"
                          className="shrink-0"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: cueColor,
                          }}
                        />
                      )}
                      <span className="truncate">{cue.text}</span>
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                    R{(tx.buyerTotal / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                  </p>
                  {/* `title` gives the hover tooltip on desktop + the
                      long-press tooltip on iOS — long enough text to
                      explain what "Payment held" means without making
                      the pill itself verbose. */}
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    title={
                      paymentStatusHint(tx.paymentStatus, tx.shippingMethod) ??
                      status.hint ??
                      status.label
                    }
                    style={{
                      color,
                      background: `${color}18`,
                    }}
                  >
                    {status.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      </PageReveal>
    </main>
  );
}
