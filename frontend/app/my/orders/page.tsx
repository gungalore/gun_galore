import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Fragment } from 'react';
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
      hint: 'The seller is not paid while we investigate.',
    };
  }
  if (tx.paymentStatus === 'PENDING_ADMIN_VERIFICATION') {
    return { text: 'Being verified by our team — nothing needed from you', tone: 'info' };
  }

  // ── HELD from here ────────────────────────────────────────────────────

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

/** True when a courier parcel is physically between the seller and the
 * buyer — dispatched, not yet arrived. Only PUDO/TCG carry a courier leg;
 * DEALER_TRANSFER, COLLECTION and PRIVATE_ARRANGE all hand over in person
 * or through a dealer, so "on the way" (a courier phrase) never applies to
 * them. Feeds the "N on the way" figure in the header — derived from the
 * same fetched list, no extra request.
 */
function isOnTheWay(tx: Transaction): boolean {
  if (tx.shippingMethod !== 'PUDO' && tx.shippingMethod !== 'TCG') return false;
  if (!tx.dispatchedAt) return false;
  if (tx.deliveredAt || tx.confirmedDeliveryAt) return false;
  if (tx.shippingStatus === 'DELIVERY_FAILED' || tx.shippingStatus === 'RETURNED') return false;
  return true;
}

interface StepNode {
  key: string;
  label: string;
  done: boolean;
}

/** The 4-node "ordered → paid → dispatched → delivered" rail the board
 * calls for — but that exact wording only fits a courier sale. A firearm
 * never couriers (release happens on dealer stock-in verification, not a
 * parcel arriving) and a collection/private-arrange/on-site item is
 * fetched or handed over in person, so nodes 3 and 4 are relabelled per
 * rail to whatever milestone that rail's OWN timestamps actually support —
 * never a courier milestone the data can't back up.
 *
 * Returns null for DISPUTED/REFUNDED: those are a detour off the happy
 * path, not a stalled point on it, and the status pill above already says
 * what happened — a 4-node rail next to it would visually claim the order
 * is still progressing toward delivery, which isn't true.
 */
function orderStepNodes(tx: Transaction): StepNode[] | null {
  if (tx.paymentStatus === 'DISPUTED' || tx.paymentStatus === 'REFUNDED') return null;

  const method = tx.shippingMethod;
  let step3Label = 'Dispatched';
  let step3Done = !!tx.dispatchedAt;
  let step4Label = 'Delivered';
  let step4Done = !!(tx.deliveredAt || tx.confirmedDeliveryAt);

  if (method === 'DEALER_TRANSFER') {
    // No physical dispatch on a dealer transfer — the equivalent event is
    // the dealer's stock-in paperwork clearing, and "delivered" becomes the
    // payout release that unlocks the dealer's contact details (mirrors
    // the RELEASED branch of nextActionCue above).
    step3Label = 'Dealer verified';
    step3Done = tx.dealerVerificationStatus === 'APPROVED';
    step4Label = 'Released';
    step4Done = tx.paymentStatus === 'RELEASED';
  } else if (method === 'COLLECTION') {
    step3Label = 'Accepted';
    step3Done = !!tx.acceptedAt;
    step4Label = 'Collected';
    step4Done = !!tx.confirmedDeliveryAt;
  } else if (method === 'PRIVATE_ARRANGE' || method === 'ON_SITE_SERVICE') {
    // Both hand over outside any courier or confirm-delivery step — the
    // seller is paid on capture/acceptance and the parties arrange the rest
    // between themselves, so there's no "delivered" timestamp to point at.
    // Released is the last event the data actually records.
    step3Label = 'Accepted';
    step3Done = !!tx.acceptedAt;
    step4Label = 'Released';
    step4Done = tx.paymentStatus === 'RELEASED';
  }

  return [
    { key: 'ordered', label: 'Ordered', done: true },
    { key: 'paid', label: 'Paid', done: !!tx.paidAt },
    { key: 'step3', label: step3Label, done: step3Done },
    { key: 'step4', label: step4Label, done: step4Done },
  ];
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
  const onTheWayCount = transactions.filter(isOnTheWay).length;
  // Filter pills — only the payment-status values actually present in this
  // buyer's list, kept in PAYMENT_STATUS's own declared order (not
  // first-seen order) so the pills always read in the same priority the
  // rest of the app uses for this field. A single status present means
  // every order would land in the one pill anyway, so the bar only earns
  // its place once there's an actual choice to make.
  const presentStatusCodes = Object.keys(PAYMENT_STATUS).filter((code) =>
    transactions.some((tx) => tx.paymentStatus === code),
  );

  return (
    <main className="max-w-[var(--content-max)] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
      <div data-reveal className="mb-6">
        <h1
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display), Archivo, sans-serif',
            fontWeight: 700,
            fontSize: 22,
          }}
        >
          My Orders
        </h1>
        {/* Count + "on the way" both fall out of the list already fetched
            above — no second request. Omitted on the empty-list path since
            the empty-state card below already explains that. */}
        {transactions.length > 0 && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {transactions.length} order{transactions.length === 1 ? '' : 's'}
            {onTheWayCount > 0 ? ` · ${onTheWayCount} on the way` : ''}
          </p>
        )}
      </div>

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
        <div data-reveal className="space-y-4">
          {/* `.order-filter-scope` is the shared ancestor `:has()` reaches
              through below — the radios live in their own row for layout,
              so they aren't adjacent siblings of `.order-list` and a plain
              `~`/`+` selector can't connect them. `:has()` already does this
              job for the listing-detail buy-bar (app/listings/[id]/page.tsx),
              so this isn't a new trick for the codebase, just a new use of
              the same one — and it needs zero client JS, which matters here
              since this stays a Server Component (Clerk's `auth()` below
              can't run in one marked 'use client'). */}
          <div className="order-filter-scope">
            {presentStatusCodes.length > 1 && (
              <>
                <style
                  dangerouslySetInnerHTML={{
                    __html:
                      [
                        `.order-filter-scope:has(#order-filter-ALL:checked) label[for="order-filter-ALL"]{background:var(--text-primary);border-color:var(--text-primary);color:#fff;}`,
                        `.order-filter-scope:has(#order-filter-ALL:focus-visible) label[for="order-filter-ALL"]{outline:2px solid var(--red);outline-offset:2px;}`,
                      ].join('') +
                      presentStatusCodes
                        .map(
                          (code) =>
                            // Hide every row except the ones matching the
                            // checked pill's own status code.
                            `.order-filter-scope:has(#order-filter-${code}:checked) .order-list [data-tx-status]:not([data-tx-status="${code}"]){display:none;}` +
                            `.order-filter-scope:has(#order-filter-${code}:checked) label[for="order-filter-${code}"]{background:var(--text-primary);border-color:var(--text-primary);color:#fff;}` +
                            `.order-filter-scope:has(#order-filter-${code}:focus-visible) label[for="order-filter-${code}"]{outline:2px solid var(--red);outline-offset:2px;}`,
                        )
                        .join(''),
                  }}
                />
                {/* Inputs live INSIDE the radiogroup, each immediately
                    before its own label — a screen reader needs the radios
                    themselves inside role="radiogroup" to announce group
                    membership and count; the earlier draft of this had them
                    as a flat list of siblings ahead of the group, which
                    left the group empty of actual radios. */}
                <div
                  role="radiogroup"
                  aria-label="Filter orders by status"
                  className="flex flex-wrap gap-2 mb-4"
                >
                  <input
                    type="radio"
                    id="order-filter-ALL"
                    name="order-status-filter"
                    defaultChecked
                    className="sr-only"
                  />
                  <label
                    htmlFor="order-filter-ALL"
                    className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer transition-colors"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    All
                  </label>
                  {presentStatusCodes.map((code) => (
                    <Fragment key={code}>
                      <input
                        type="radio"
                        id={`order-filter-${code}`}
                        name="order-status-filter"
                        className="sr-only"
                      />
                      <label
                        htmlFor={`order-filter-${code}`}
                        className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer transition-colors"
                        style={{
                          background: 'var(--bg-inset)',
                          border: '0.5px solid var(--border)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {PAYMENT_STATUS[code]?.label ?? code}
                      </label>
                    </Fragment>
                  ))}
                </div>
              </>
            )}

            <div className="order-list space-y-3">
              {transactions.map((tx) => {
                const status = resolveStatus(PAYMENT_STATUS, tx.paymentStatus);
                const color = toneColor(status.tone);
                const cue = nextActionCue(tx, now);
                const cueColor = cue ? toneColor(cue.tone) : undefined;
                const steps = orderStepNodes(tx);
                const currentStepIdx = steps ? steps.findIndex((s) => !s.done) : -1;
                return (
                  // `data-tx-status` is what the filter CSS above matches on.
                  // ⚠️ NOT a <Link> — the old row-as-<Link> would have nested
                  // the footer button below inside an <a>, which is invalid
                  // HTML and silently breaks keyboard/tab order. Only the
                  // title is a link now; the footer action is a sibling.
                  <div
                    key={tx.id}
                    data-tx-status={tx.paymentStatus}
                    className="rounded-[8px] p-4"
                    style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
                  >
                    <div className="flex items-start gap-4">
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
                        {/* Reference chip. No backend order-reference field
                            exists yet — this is the same fallback the order
                            detail page itself renders
                            (app/transactions/[id]/page.tsx), reused verbatim
                            so a buyer sees ONE reference for the same order,
                            not two different-looking ones. */}
                        <p className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          Order #{tx.id.slice(-8).toUpperCase()}
                        </p>
                        <Link
                          href={`/transactions/${tx.id}`}
                          className="font-medium truncate block"
                          style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                        >
                          {tx.listing.title}
                        </Link>
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
                            background: `color-mix(in srgb, ${color} 9%, transparent)`,
                          }}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>

                    {/* 4-node progress stepper — see orderStepNodes() above
                        for why the last two nodes are relabelled per
                        shipping rail. Binary done/not-done only (no third
                        "in progress" dot): AA contrast for the not-done
                        label already rules out --text-faint at this size
                        (see globals.css's contrast table), and a third
                        visual state isn't verifiable without eyes on the
                        rendered page. */}
                    {steps && (
                      <ol className="flex items-center mt-4" aria-label="Order progress">
                        {steps.map((s, i) => (
                          <li
                            key={s.key}
                            className="flex min-w-0 flex-1 items-center gap-1.5"
                            aria-current={i === currentStepIdx ? 'step' : undefined}
                          >
                            <span
                              aria-hidden="true"
                              className="shrink-0 rounded-full"
                              style={{
                                width: 8,
                                height: 8,
                                background: s.done ? 'var(--success)' : 'var(--bg-inset)',
                                border: s.done ? 'none' : '1.5px solid var(--border-hover)',
                              }}
                            />
                            <span
                              className="truncate text-[10px]"
                              style={{
                                color: s.done ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                                fontWeight: s.done ? 500 : 400,
                              }}
                            >
                              {s.label}
                            </span>
                            {i < steps.length - 1 && (
                              <span
                                aria-hidden="true"
                                className="mx-1 h-px flex-1"
                                style={{
                                  background:
                                    s.done && steps[i + 1].done ? 'var(--success)' : 'var(--border)',
                                }}
                              />
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    {/* Footer action — separate from the title <Link> above
                        so nothing is nested. Kept to one safe CTA: the
                        state-changing buttons (confirm receipt, raise a
                        dispute, …) already live as their own client
                        components on the order page and touch payout/refund
                        state, which is out of scope for this file and not
                        something to fork a second copy of here. */}
                    <div
                      className="flex justify-end mt-3 pt-3"
                      style={{ borderTop: '0.5px solid var(--border)' }}
                    >
                      <Link
                        href={`/transactions/${tx.id}`}
                        className="text-xs px-3 py-1.5 rounded-[6px]"
                        style={
                          cue?.action
                            ? { background: 'var(--red)', color: '#fff', fontWeight: 500, textDecoration: 'none' }
                            : {
                                background: 'var(--bg-inset)',
                                border: '0.5px solid var(--border)',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                                textDecoration: 'none',
                              }
                        }
                      >
                        {cue?.action ? 'View order — action needed' : 'View order'}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      </PageReveal>
    </main>
  );
}
