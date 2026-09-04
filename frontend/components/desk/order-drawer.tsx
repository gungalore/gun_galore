'use client';

/**
 * THE DESK — the Order drawer.
 *
 * Replaces the legacy /admin/transactions/[id] page and, through the parent
 * Order every cart line hangs off, /admin/orders/[id]. One drawer, opened over
 * whichever board the operator was working, because a dossier is something you
 * consult to finish the card in front of you — not somewhere you navigate to
 * and then have to find your way back from.
 *
 * ⚠️ THIS DRAWER MOVES MONEY. Release, resolve-and-release, refund, payout
 * hold and lift all live at its foot in OrderActions, each behind a confirm
 * that restates the party, the amount and what happens next.
 *
 * 🚨 THIS PARAGRAPH USED TO SAY THE OPPOSITE — "this drawer reads, it moves no
 * money and changes no state, so it carries no footer and no confirm" — while
 * OrderActions was mounted eighty lines below it and the `note` prop three
 * lines down told the operator where the money levers were. It was true when
 * written and nobody revisited it, which is how the cutover map came to record
 * that every action here was missing and left this entry looking far larger
 * than it was. A comment describing a limitation is a claim with an expiry
 * date on it.
 *
 * Two levers were genuinely absent until now, both with a live endpoint and no
 * caller: the dealer stock-in override — which is the ONLY way a firearm
 * DEALER_TRANSFER payout is ever released once the automated check says no —
 * and the Zoho Books retry for a failed commission post.
 *
 * ⚠️ MONEY IS RENDERED, NEVER DERIVED — see lib/desk-order.ts. Every figure
 * below is a stored column on the sale. The buyer's receipt and the seller's
 * statement are built by the platform's single fee presenter; this surface
 * does not become a ninth guess at them.
 *
 * 🚨 USERNAMES ONLY. The dossier returns both parties' email and phone, the
 * seller's bank account and the buyer's delivery address. None of them are
 * needed to answer "is the money right, where is the parcel, why is the payout
 * stuck", so none of them are rendered — the data module does not even declare
 * them. Bank readiness shows as a yes/no, which is the fact without the risk.
 */
import * as React from 'react';
// Sibling files, not the barrel: this component lives INSIDE the kit, and
// every other kit file reaches its neighbours the same way. Importing
// './index' from here would close a cycle the moment the barrel re-exports
// this drawer. Screens outside the kit still import from '@/components/desk'.
import { IconAlert, IconBanknote, IconShield } from './icons';
import { Button, Tag } from './primitives';
import { Kv, Ribbon, formatRand } from './numbers';
import { Drawer, Section, Timeline } from './overlays';
import { OrderActions } from './order-actions';
import { FailedRegion, SkeletonPile } from './states';
import { describeFailure } from '@/lib/desk-auth';
import {
  fetchOrderDossier,
  formatWhen,
  gatewayIdentifiers,
  humanise,
  orderMoney,
  orderReferenceOf,
  parcelPosition,
  paymentTimeline,
  paymentTone,
  readResultCode,
  retryZohoPost,
  resultTone,
  shippingTimeline,
  zohoNeedsAttention,
  type OrderDossier,
  type OrderParty,
  type OrderTransaction,
} from '@/lib/desk-order';
// 🚨 desk-orderS, PLURAL — the CART PARENT's module, not desk-order's. See its
// header: one character apart, two different units of money.
import type { OrderCard } from '@/lib/desk-orders';

export interface OrderDrawerProps {
  open: boolean;
  /**
   * The Transaction id — the unit of a sale everywhere on the Desk. A cart's
   * parent Order is reached through any one of its lines, so a board opening
   * this from an order row passes that order's first line.
   */
  transactionId: string | null;
  /**
   * The parent order, when the board that opened this already had it.
   *
   * ⚠️ OPTIONAL, AND NULL IS THE NORMAL CASE. A payout row is one sale and has
   * no cart parent to describe, so the Ledger's run lens passes null and this
   * drawer looks exactly as it did. The Orders lens passes the card it had to
   * fetch anyway to learn which line to open — which is how the order-level
   * money split and the manual-EFT stamps the legacy /admin/orders/[id] page
   * owned come back for free.
   *
   * ⚠️ IT IS ALSO CHECKED AGAINST THE LOADED SALE BEFORE ANYTHING IS DRAWN.
   * The parent can swap `transactionId` to a payout row without clearing the
   * card, and one frame of the wrong order's totals under the right order's
   * reference is exactly the lie the ticket guard below exists to prevent.
   */
  orderCard?: OrderCard | null;
  /**
   * Step to another line of the same order.
   *
   * ⚠️ ABSENT MEANS THE SIBLING LIST STAYS INERT — today's markup exactly. When
   * supplied, each sibling row in the Parcel fold becomes a button. Without
   * it, lines 2..N of a multi-seller order are visible and unreachable: the
   * only way in is a board that happens to list that exact transaction.
   */
  onOpenLine?: (transactionId: string) => void;
  onClose: () => void;
}

export function OrderDrawer({
  open,
  transactionId,
  orderCard = null,
  onOpenLine,
  onClose,
}: OrderDrawerProps) {
  const [dossier, setDossier] = React.useState<OrderDossier | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * ⚠️ EVERY READ TAKES A TICKET, AND ONLY THE NEWEST MAY WRITE. Two reads are
   * in flight the moment an operator steps from one order to the next, and
   * nothing orders their replies — the slower one landing last would paint the
   * previous sale's figures under the new sale's reference, which on a money
   * surface is the worst possible way to be wrong.
   */
  const ticketRef = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!transactionId) return;
    const ticket = ++ticketRef.current;
    setError(null);
    setDossier(null);
    try {
      const next = await fetchOrderDossier(transactionId);
      if (ticketRef.current === ticket) setDossier(next);
    } catch (err) {
      if (ticketRef.current === ticket) setError(describeFailure(err));
    }
  }, [transactionId]);

  // Re-fetched every time it opens. A dossier read from a cache is a dossier
  // of the order as it was before the last webhook landed, which on a disputed
  // sale is exactly the wrong minute to be looking at.
  React.useEffect(() => {
    if (!open) {
      // 🚨 CLOSING DROPS THE DOSSIER. The response carries far more than this
      // drawer renders — both parties' email and phone, the seller's bank
      // account, the buyer's delivery address — so holding it in state after
      // the operator has moved on keeps all of it alive in the tab, in a
      // React devtools panel and in any error report, for no decision at all.
      // Burning the ticket first stops an in-flight read putting it back.
      ticketRef.current++;
      setDossier(null);
      setError(null);
      return;
    }
    void load();
  }, [open, load]);

  /**
   * ⚠️ THE DOSSIER OF THE PREVIOUS ORDER IS NOT THIS ORDER. The effect that
   * clears state runs AFTER the render that changed transactionId, so for one
   * frame the last sale's money, parties and gateway ids sit under the new
   * sale's reference. Matching the loaded row against the requested id turns
   * that frame into a loading state instead of a plausible-looking lie.
   */
  const loaded = dossier && dossier.transaction.id === transactionId ? dossier : null;
  const tx = loaded?.transaction ?? null;
  const reference = tx ? orderReferenceOf(tx) : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      typeLabel="Order"
      reference={reference?.value}
      icon={IconBanknote}
      title={tx ? tx.listing.title : error ? 'Order' : 'Loading…'}
      meta={tx ? <HeaderMeta tx={tx} /> : undefined}
      tags={loaded ? <HeaderTags dossier={loaded} /> : undefined}
      note="Reading is safe. The money levers are at the foot of this drawer."
    >
      {error ? (
        <div style={{ padding: '16px 20px' }}>
          <FailedRegion
            title="Couldn't load the order"
            detail={error}
            onRetry={() => void load()}
            scopeNote="only this drawer failed"
          />
        </div>
      ) : !loaded || !tx ? (
        <div style={{ padding: '16px 20px' }}>
          <SkeletonPile count={2} />
        </div>
      ) : (
        <Body
          dossier={loaded}
          tx={tx}
          /* ⚠️ THE CARD IS ONLY THIS ORDER'S IF IT NAMES THIS ORDER. A parent
             that swaps transactionId without clearing the card would otherwise
             put one cart's totals under another cart's reference. */
          orderCard={orderCard && orderCard.id === tx.order?.id ? orderCard : null}
          onOpenLine={onOpenLine}
          referenceSource={reference?.source ?? 'transaction'}
          /* Every lever changes what this drawer says, so it re-reads rather
             than patching state: a dossier half-updated from a response is a
             dossier that disagrees with the database. */
          onActed={() => void load()}
        />
      )}
    </Drawer>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Header
 * ──────────────────────────────────────────────────────────────────────── */

function HeaderMeta({ tx }: { tx: OrderTransaction }) {
  const parcel = parcelPosition(tx);
  // Usernames, never real names — this line is the first thing on screen and
  // the most likely to be read over someone's shoulder.
  const parts = [
    `${tx.buyer.username ?? 'unknown buyer'} → ${tx.seller.username ?? 'unknown seller'}`,
    humanise(tx.listing.listingType),
    parcel ? `Item ${parcel.index} of ${parcel.total}` : null,
  ].filter(Boolean);
  return <>{parts.join(' · ')}</>;
}

function HeaderTags({ dossier }: { dossier: OrderDossier }) {
  const tx = dossier.transaction;
  const money = orderMoney(tx);
  return (
    <>
      <Tag kind={paymentTone(tx.paymentStatus)}>{humanise(tx.paymentStatus)}</Tag>
      {tx.shippingStatus ? <Tag kind="ink">{humanise(tx.shippingStatus)}</Tag> : null}
      {tx.payoutHeldAt ? <Tag kind="bad">Payout held</Tag> : null}
      {dossier.complaints.length ? (
        <Tag kind="bad">
          {dossier.complaints.length === 1 ? '1 complaint' : `${dossier.complaints.length} complaints`}
        </Tag>
      ) : null}
      {tx.listing.isFirearm ? (
        <Tag kind="ink" icon={IconShield}>
          Firearm
        </Tag>
      ) : null}
      <Tag kind="neutral">{money.feeModelLabel}</Tag>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Body
 * ──────────────────────────────────────────────────────────────────────── */

function Body({
  dossier,
  tx,
  orderCard,
  onOpenLine,
  referenceSource,
  onActed,
}: {
  dossier: OrderDossier;
  tx: OrderTransaction;
  /** Already checked against this sale's parent by the caller. */
  orderCard: OrderCard | null;
  onOpenLine?: (transactionId: string) => void;
  referenceSource: 'order' | 'gateway' | 'transaction';
  /** Re-read the dossier after a lever lands. */
  onActed: () => void;
}) {
  const money = orderMoney(tx);
  const parcel = parcelPosition(tx);
  const code = readResultCode(tx.peachResultCode);
  const shipping = shippingTimeline(tx);
  const thumb = tx.listing.images[0]?.url ?? null;

  return (
    <>
      <Section label="Item">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt=""
              style={{
                width: 56,
                height: 56,
                flex: 'none',
                objectFit: 'cover',
                borderRadius: 8,
                border: '1px solid var(--dk-line-2)',
              }}
            />
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kv k="Listing ref" v={tx.listing.referenceNumber ?? '—'} />
            <Kv k="Quantity" v={String(tx.quantity)} />
            <Kv k="Opened" v={formatWhen(tx.createdAt)} last />
          </div>
        </div>
      </Section>

      {/* ⚠️ Two headline numbers, both straight off the row: what the buyer was
          charged and what the seller is owed. Everything under them is a
          labelled column, not a calculation. */}
      <Section label="Money">
        <Ribbon
          compact
          cells={[
            {
              label: 'Buyer paid',
              value: formatRand(money.buyerPaidCents),
              sub: humanise(tx.paymentStatus),
            },
            {
              label: 'Seller receives',
              value: formatRand(money.sellerReceivesCents),
              sub: tx.paidOutAt
                ? 'settled'
                : tx.releasedAt
                  ? 'released, not settled'
                  : 'not released',
            },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          {money.recorded.map((r) => (
            <Kv
              key={r.label}
              k={
                <>
                  {r.label}
                  {r.note ? (
                    <span style={{ color: 'var(--dk-ink-3)' }}> · {r.note}</span>
                  ) : null}
                </>
              }
              v={formatRand(r.cents)}
            />
          ))}
          {money.refundedCents > 0 ? (
            <Kv
              k="Refunded to buyer"
              v={formatRand(money.refundedCents)}
              tone="warn"
            />
          ) : null}
          {money.wastedCourierCents > 0 ? (
            <Kv
              k={
                <>
                  Wasted courier charge
                  {/* A money qualifier: it says the charge is DEDUCTED, not
                      merely noted. Losing it changes what the line means. */}
                  <span style={{ color: 'var(--dk-ink-3)' }}> · taken off at payout</span>
                </>
              }
              v={formatRand(money.wastedCourierCents)}
              tone="warn"
            />
          ) : null}
          <Kv k="Fee model" v={money.feeModel} last />
        </div>
        <Muted style={{ marginTop: 10 }}>{money.feeModelNote}</Muted>
        <Muted style={{ marginTop: 6 }}>
          Stored columns, shown as recorded. The buyer&rsquo;s receipt and the seller&rsquo;s
          statement are built by the platform&rsquo;s one fee presenter; the Desk adds nothing
          up.
        </Muted>
      </Section>

      <Section label="Parties">
        {/*
         * ⚠️ A LINK, NOT A NESTED DRAWER. The cutover note recorded that the
         * legacy page printed the buyer's email and phone under their name and
         * that neither is rendered here — deliberate, per the usernames-only
         * rule, but a real workflow change: an operator who used to copy a
         * phone number off the order page now needs the Member drawer.
         *
         * Mounting MemberDrawer inside this one is the obvious fix and is
         * wrong: Drawer binds Escape on `document` and defers only to a
         * `.dk-dialog` above it, so two mounted at once both hear one keypress
         * and both close — the failure this file's own header warns about. The
         * Pile solves that with a stack; the Ledger has none, so a party opens
         * the People board on that member instead. It also makes the identity
         * reveal happen where the reveal is designed, behind its deliberate
         * press, rather than as a side effect of reading an order.
         */}
        <Kv k="Buyer" v={<PartyLink party={tx.buyer} />} mono={false} />
        <Kv
          k="Buyer KYC"
          v={humanise(tx.buyer.kycStatus)}
          tone={tx.buyer.kycStatus === 'APPROVED' ? 'ok' : undefined}
        />
        <Kv k="Seller" v={<PartyLink party={tx.seller} />} mono={false} />
        <Kv
          k="Seller KYC"
          v={humanise(tx.seller.kycStatus)}
          tone={tx.seller.kycStatus === 'APPROVED' ? 'ok' : 'warn'}
        />
        <Kv k="Seller tier" v={tx.seller.sellerTier ?? '—'} />
        {/* A yes/no, never the account. The operator needs to know whether a
            payout can go out; they do not need the number to know that. */}
        <Kv
          k="Bank verified"
          v={tx.seller.bankVerifiedAt ? 'Yes' : 'No'}
          tone={tx.seller.bankVerifiedAt ? 'ok' : 'warn'}
          last
        />
      </Section>

      <Section label="Payment">
        <Timeline steps={paymentTimeline(tx)} />
        {tx.riskScore > 0 || tx.riskFlags.length ? (
          <div style={{ marginTop: 6 }}>
            {/* Log-only signals scored after capture — they never blocked the
                payment, so they are context here, not a verdict. */}
            <Kv k="Risk score" v={String(tx.riskScore)} />
            <Kv k="Risk flags" v={tx.riskFlags.join(', ') || '—'} last />
          </div>
        ) : null}
      </Section>

      <Section label="Shipping">
        <div style={{ marginBottom: 12 }}>
          <Kv k="Method" v={humanise(tx.shippingMethod)} />
          <Kv k="Status" v={humanise(tx.shippingStatus)} />
          {tx.carrierProvider ? <Kv k="Carrier" v={tx.carrierProvider} /> : null}
          {tx.shippingServiceCode ? <Kv k="Service" v={tx.shippingServiceCode} /> : null}
          {tx.trackingReference ? <Kv k="Waybill" v={tx.trackingReference} /> : null}
          {tx.shipmentRebookCount > 0 ? (
            // A rising count says the listing's measurements are wrong, not
            // that any one collection went badly.
            <Kv k="Re-booked" v={`${tx.shipmentRebookCount}×`} tone="warn" />
          ) : null}
          <Kv k="Buyer confirmed" v={formatWhen(tx.confirmedDeliveryAt)} last />
        </div>
        {/* ⚠️ AN EMPTY TIMELINE IS BLANK SPACE, AND BLANK SPACE READS AS A
            FAILED FETCH. An unpaid — or rejected — sale has no booking, no
            dispatch and no carrier events, and shippingTimeline correctly
            draws nothing; the same doctrine as the Messages section applies,
            so the absence gets said out loud. */}
        {shipping.length ? (
          <Timeline steps={shipping} />
        ) : (
          <Muted>
            Nothing has happened to the parcel: no booking, no dispatch and no carrier
            events are recorded on this sale.
          </Muted>
        )}
      </Section>

      {dossier.complaints.length ? (
        <Fold
          label={`Complaints · ${dossier.complaints.length}`}
          summary={dossier.complaints
            .map((c) => `${c.referenceNumber} — ${humanise(c.status)}`)
            .join(' · ')}
        >
          {dossier.complaints.map((c) => (
            <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
                  {c.referenceNumber}
                </span>
                <Tag kind={c.resolvedAt ? 'ok' : 'warn'}>{humanise(c.status)}</Tag>
                {c.drovePayoutHold ? (
                  <Tag kind="bad" icon={IconAlert}>
                    Froze the payout
                  </Tag>
                ) : null}
              </div>
              <div style={{ fontSize: 13, color: 'var(--dk-ink)', marginTop: 6 }}>{c.subject}</div>
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: 'var(--dk-ink-2)',
                  marginTop: 4,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {c.body}
              </div>
              <Muted style={{ marginTop: 6 }}>
                {[
                  humanise(c.category),
                  c.user?.username ?? 'unknown member',
                  formatWhen(c.createdAt),
                  c.outcome ? `outcome ${humanise(c.outcome)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
              {c.photos.length ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {c.photos.map((p) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'block', lineHeight: 0 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt="Complaint evidence"
                        style={{
                          width: 64,
                          height: 64,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid var(--dk-line-2)',
                        }}
                      />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </Fold>
      ) : null}

      {/* ⚠️ SAID OUT LOUD RATHER THAN LEFT BLANK. The endpoint's own comment
          says the messages include was dropped on purpose — buyer↔seller chat
          was never built. An operator who cannot see a messages section
          assumes it failed to load; one who reads this line knows there is
          nothing to look for. */}
      <Section label="Messages">
        <Muted>
          None. Buyer↔seller chat was never built, and the dossier returns no messages.
          {dossier.complaints.length
            ? ' What the parties have written about this order is under Complaints.'
            : ''}
        </Muted>
      </Section>

      <Fold
        label="Gateway"
        summary={`${code.code ?? 'no result code'} · ${code.bucket}`}
      >
        {/* ⚠️ THE RAW CODE IS THE PAYLOAD. It gets read to a support line and
            pasted into the gateway's docs, so it is shown exactly as stored,
            with our own classifier's word beside it and nothing friendlier
            invented. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            background: 'var(--dk-surface)',
            border: '1px solid var(--dk-line-2)',
            borderRadius: 10,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="dk-mono" style={{ fontSize: 13, color: 'var(--dk-ink)' }}>
              {code.code ?? '—'}
            </span>
            <Tag kind={resultTone(code.bucket)}>{code.bucket}</Tag>
          </span>
          <Muted>{code.meaning}</Muted>
        </div>
        <div style={{ marginTop: 10 }}>
          {gatewayIdentifiers(tx).map((g, i, all) => (
            <Kv key={g.label} k={g.label} v={g.value} last={i === all.length - 1} />
          ))}
        </div>
        <Muted style={{ marginTop: 8 }}>
          The reference in the header is the{' '}
          {referenceSource === 'order'
            ? 'parent order number'
            : referenceSource === 'gateway'
              ? 'gateway merchant reference'
              : 'transaction id'}
          .
        </Muted>
      </Fold>

      {tx.dealer || tx.shippingMethod === 'DEALER_TRANSFER' ? (
        <Fold
          label="Dealer"
          summary={
            tx.dealer
              ? `${tx.dealer.name} · ${humanise(tx.dealerVerificationStatus ?? 'not started')}`
              : 'Firearm transfer with no dealer on the sale'
          }
        >
          {/* A firearm's payout gates on the dealer's stock-in being APPROVED,
              so this is a money question as much as a logistics one. */}
          {tx.dealer ? (
            <>
              <Kv k="Dealer" v={tx.dealer.name} mono={false} />
              <Kv k="Licence" v={tx.dealer.licenceNumber ?? '—'} />
              <Kv k="City" v={tx.dealer.city ?? '—'} mono={false} />
            </>
          ) : (
            <Muted style={{ marginBottom: 10 }}>
              No dealer is attached to this sale.
            </Muted>
          )}
          <Kv
            k="Stock-in verification"
            v={humanise(tx.dealerVerificationStatus ?? 'not started')}
            tone={tx.dealerVerificationStatus === 'APPROVED' ? 'ok' : 'warn'}
          />
          <Kv k="Verified" v={formatWhen(tx.dealerVerifiedAt)} />
          <Kv
            k="Model score"
            v={
              tx.dealerVerificationScore === null
                ? '— (not measured)'
                : tx.dealerVerificationScore.toFixed(2)
            }
          />
          <Kv k="Attempts" v={String(tx.dealerVerifyAttempts ?? 0)} />
          <Kv k="Stock register ref" v={tx.dealerStockRegisterRef ?? '—'} />
          <DealerEvidence tx={tx} />
        </Fold>
      ) : null}

      <ZohoFold tx={tx} onActed={onActed} />

      {orderCard ? <OrderCardSection card={orderCard} /> : null}

      {parcel && tx.order ? (
        <Fold
          label={`Parcel · item ${parcel.index} of ${parcel.total}`}
          summary={`${tx.order.orderReference} · ${humanise(tx.order.status)} · ${formatRand(
            tx.order.buyerTotal,
          )}`}
        >
          {/* The parent Order owns the single payment capture; each line is its
              own sub-order with its own dispatch and payout. Seeing the
              siblings is how a consolidated support request gets answered. */}
          <Kv k="Order" v={tx.order.orderReference} />
          <Kv k="Order status" v={humanise(tx.order.status)} />
          <Kv k="Order total" v={formatRand(tx.order.buyerTotal)} />
          <Kv k="Order paid" v={formatWhen(tx.order.paidAt)} last />
          <div style={{ marginTop: 10 }}>
            {tx.order.transactions.map((sib) => {
              const head = (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: sib.id === tx.id ? 'var(--dk-ink)' : 'var(--dk-ink-2)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {sib.listing?.title ?? 'Item'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink)' }}>
                      {formatRand(sib.buyerTotal)}
                    </span>
                  </div>
                  <Muted style={{ marginTop: 3 }}>
                    {[
                      sib.id === tx.id ? 'this line' : null,
                      humanise(sib.paymentStatus),
                      humanise(sib.shippingMethod),
                      // The line's own shipping state, which is what says
                      // WHICH of a cart's parcels is the one that is stuck.
                      sib.shippingStatus ? humanise(sib.shippingStatus) : null,
                      sib.shipsWithId ? 'ships with another line' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                </>
              );

              /* ⚠️ THE LINE ALREADY ON SCREEN IS NOT A CONTROL. Making it one
                 would offer to open the drawer that is already open — a click
                 whose only effect is a reload and a lost scroll position. */
              const steppable = Boolean(onOpenLine) && sib.id !== tx.id;

              return (
                <div
                  key={sib.id}
                  style={{ padding: '8px 0', borderBottom: '1px solid var(--dk-line)' }}
                >
                  {steppable ? (
                    /* A row is a button, not a div with an onClick: it has to
                       be reachable by Tab and announced as opening a dialog —
                       the same rule the Ledger's payout rows follow. */
                    <button
                      type="button"
                      onClick={() => onOpenLine?.(sib.id)}
                      aria-haspopup="dialog"
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: 0,
                        background: 'transparent',
                        border: 'none',
                        textAlign: 'left',
                        font: 'inherit',
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      {head}
                    </button>
                  ) : (
                    head
                  )}
                </div>
              );
            })}
          </div>
        </Fold>
      ) : null}

      {tx.rating ? (
        <Section label="Rating">
          <Kv k="Stars" v={`${tx.rating.stars} / 5`} />
          <Kv k="Left" v={formatWhen(tx.rating.createdAt)} last />
          {tx.rating.comment ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--dk-ink-2)',
                marginTop: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {tx.rating.comment}
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* Always drawn, and always last: an empty admin trail is itself the
          answer to "has anybody touched this order". */}
      <Fold
        label={`Admin trail · ${dossier.auditEvents.length}`}
        summary={
          dossier.auditEvents.length
            ? `Last: ${humanise(dossier.auditEvents[0].action)} · ${formatWhen(
                dossier.auditEvents[0].createdAt,
              )}`
            : 'No admin has acted on this order.'
        }
        /* not `last` any more: the levers sit below it */
      >
        {dossier.auditEvents.length === 0 ? (
          <Muted>No admin has acted on this order.</Muted>
        ) : (
          dossier.auditEvents.map((e) => (
            <div key={e.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--dk-line)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{humanise(e.action)}</div>
              <Muted style={{ marginTop: 3 }}>
                {[formatWhen(e.createdAt), e.adminUser?.email, e.reason].filter(Boolean).join(' · ')}
              </Muted>
            </div>
          ))
        )}
      </Fold>

      {/* 🚨 THE LEVERS COME AFTER EVERYTHING THAT EXPLAINS THE ORDER.
          An operator should have scrolled past the money, the parties, the
          shipping and the admin trail before a button that moves cash is in
          reach — the reading is the safeguard, and putting the buttons at the
          top would let someone act on a header alone. */}
      {/* ⚠️ KEYED ON THE TRANSACTION, SO A LEVER CANNOT OUTLIVE ITS ORDER.
          OrderActions holds the operator's typed refund amount and reason in
          its own state. Without a key React reuses the instance when the
          drawer moves to another line — the panel stays open, the typed amount
          survives, and the confirm would restate a different order's names
          around a figure composed for the previous one. */}
      <OrderActions
        key={dossier.transaction.id}
        txId={dossier.transaction.id}
        sellerPayoutCents={dossier.transaction.sellerPayout ?? null}
        buyerTotalCents={dossier.transaction.buyerTotal ?? null}
        released={Boolean(dossier.transaction.releasedAt)}
        payoutHeld={Boolean(dossier.transaction.payoutHeldAt)}
        disputed={dossier.complaints.length > 0}
        seller={dossier.transaction.seller?.username ?? 'the seller'}
        buyer={dossier.transaction.buyer?.username ?? 'the buyer'}
        /* Which line the levers act on. parcelPosition returns null on a
           single-line sale, and the confirm then says nothing about lines —
           there is no sibling to be wrong about. */
        line={(() => {
          const at = parcelPosition(dossier.transaction);
          return at
            ? { title: dossier.transaction.listing.title, index: at.index, total: at.total }
            : null;
        })()}
        {.../**
         * ⚠️ ONLY ON A FIREARM GOING THROUGH A DEALER. OrderActions offers the
         * override when this is a non-APPROVED string, so passing the raw
         * column on every sale would put a firearms control on a pair of
         * binoculars whose column happens to be null — and, worse, would keep
         * offering it on the sales where it means nothing.
         */
        (tx.shippingMethod === 'DEALER_TRANSFER' || tx.dealer
          ? { dealerVerificationStatus: tx.dealerVerificationStatus ?? 'not started' }
          : {})}
        onDone={onActed}
      />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The Order card — the cart parent, when a board handed one over
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The order-level money split and the manual-EFT lifecycle.
 *
 * This is the half of the legacy /admin/orders/[id] page that the transaction
 * dossier genuinely could not show: the split belongs to the ORDER, which owns
 * the single payment capture, while every column in the Money section above
 * belongs to one LINE.
 *
 * ⚠️ ALL FIVE PARTS ARE PRINTED AND NOTHING IS ADDED UP. items + shipping +
 * handling + processingFee == buyerTotal is the backend's invariant, held by
 * the one fee presenter the platform has. A UI that recomputed the total would
 * be a ninth guess at it, and the day the two disagreed the operator would
 * have no way to tell which number was the real charge. buyerTotal is what was
 * actually taken; the four above it are what it was made of, as recorded.
 *
 * ⚠️ THE MANUAL-EFT BLOCK IS DRAWN ONLY FOR MANUAL_EFT. Three em dashes under
 * a gateway order is noise pretending to be a timeline.
 */
function OrderCardSection({ card }: { card: OrderCard }) {
  const manual = card.paymentMethod === 'MANUAL_EFT';
  return (
    <Section label="Order">
      <Kv k="Order" v={card.orderReference ?? '—'} />
      <Kv k="Paid by" v={humanise(card.paymentMethod)} />
      <Kv k="Lines" v={String(card.lineCount)} />
      <Kv k="Items" v={formatRand(card.itemsSubtotal)} />
      <Kv k="Shipping" v={formatRand(card.shippingSubtotal)} />
      <Kv k="Handling" v={formatRand(card.handlingSubtotal)} />
      <Kv k="Processing fee" v={formatRand(card.processingFee)} />
      <Kv k="Order total" v={formatRand(card.buyerTotal)} last />

      {manual ? (
        <div style={{ marginTop: 10 }}>
          <Kv k="Pay by" v={formatWhen(card.manualPayByAt)} />
          <Kv k="Payment detected" v={formatWhen(card.manualDetectedAt)} />
          <Kv
            k="Cancelled"
            v={formatWhen(card.manualCancelledAt)}
            tone={card.manualCancelledAt ? 'warn' : undefined}
            last
          />
        </div>
      ) : null}

      <Muted style={{ marginTop: 10 }}>
        Stored columns on the order, shown as recorded. The four parts are what
        the total was made of; the Desk does not re-add them.
      </Muted>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Local bits
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The quiet line under a value.
 *
 * ⚠️ display:block IS LOAD-BEARING. Every call site sets a top margin to space
 * it off the thing it explains, and a margin on an inline span is silently
 * ignored — the note ends up welded to the row above it with no error.
 */
function Muted({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{ display: 'block', fontSize: 12, lineHeight: 1.5, color: 'var(--dk-ink-3)', ...style }}
    >
      {children}
    </span>
  );
}

/**
 * A Section that stays shut until asked.
 *
 * ⚠️ THE COLLAPSED STATE STILL SAYS SOMETHING. A fold whose closed form is
 * blank costs the operator a click to find out there was nothing worth one;
 * the summary line carries the fact — the result code, the dealer's status,
 * the last admin action — so opening it is a choice rather than a probe.
 */
/**
 * The three photos the dealer uploaded, which the model read to reach its
 * verdict.
 *
 * 🚨 THE OVERRIDE IS UNUSABLE WITHOUT THESE. Approving a firearm stock-in
 * releases money and tells the buyer where to collect a firearm; an operator
 * asked to overrule a machine with none of the machine's inputs on screen is
 * being asked to rubber-stamp it. The URLs have been on the wire since the
 * drawer was written — getTransactionDossier `include`s every Transaction
 * scalar — and were simply never declared in the frontend type.
 *
 * ⚠️ ONE AT A TIME, ON A PRESS. A SAPS 534 carries a serial number, a licence
 * number and a person's details. Three of them auto-loading in a fold that
 * opens on any firearm sale would put that on screen every time anyone looked
 * at a parcel — the same reason KYC documents are behind a per-document
 * reveal on the Member drawer, and the intercepted text is folded on Trust
 * and safety.
 */
function DealerEvidence({ tx }: { tx: OrderTransaction }) {
  const [shown, setShown] = React.useState<string | null>(null);

  const shots: { key: string; label: string; url: string | null }[] = [
    { key: 'saps534', label: 'SAPS 534', url: tx.saps534PhotoUrl },
    { key: 'register', label: 'Stock register', url: tx.stockRegisterPhotoUrl },
    { key: 'serial', label: 'Firearm serial', url: tx.firearmSerialPhotoUrl },
  ];
  const present = shots.filter((s) => s.url);

  if (present.length === 0) {
    return (
      <Kv
        k="Evidence"
        v="— none uploaded (the check had nothing to read)"
        tone="warn"
        last
      />
    );
  }

  return (
    <>
      <Kv
        k="Evidence"
        v={
          present.length === 3
            ? 'all three photos'
            : `${present.length} of 3 photos — ${shots
                .filter((s) => !s.url)
                .map((s) => s.label.toLowerCase())
                .join(' and ')} missing`
        }
        tone={present.length === 3 ? undefined : 'warn'}
        last
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {present.map((s) => (
          <Button
            key={s.key}
            variant="ghost"
            onClick={() => setShown((cur) => (cur === s.key ? null : s.key))}
          >
            {shown === s.key ? `Hide ${s.label}` : s.label}
          </Button>
        ))}
      </div>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={present.find((s) => s.key === shown)?.url ?? ''}
          alt={`${present.find((s) => s.key === shown)?.label} as uploaded by the dealer`}
          style={{
            marginTop: 10,
            width: '100%',
            borderRadius: 6,
            border: '1px solid var(--dk-line-2)',
            background: 'var(--dk-inset)',
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The Zoho Books commission posting, and the retry for a failed one.
 *
 * 🚨 A FAILED POST USED TO BE INVISIBLE. Every one of these columns has been
 * on the wire all along and none was rendered, so a sale whose commission
 * invoice never reached Books looked identical to a healthy one — money out
 * of the platform with no invoice behind it, and nothing on any screen saying
 * so. The backend's own comment describes "the admin dossier's ZohoSyncPanel
 * Retry button", which has never existed in any version of this frontend.
 *
 * ⚠️ NO CONFIRM, DELIBERATELY. The endpoint creates the invoice only if it is
 * absent and marks it paid only if unpaid, so pressing it on a healthy sale
 * is a no-op rather than a double-post. A confirm on an idempotent repair is
 * a confirm people learn to click through.
 */
function ZohoFold({ tx, onActed }: { tx: OrderTransaction; onActed: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  const needs = zohoNeedsAttention(tx.zohoSyncStatus);

  // Nothing has ever been posted and nothing failed: this sale has not reached
  // the point of having a commission invoice, and a fold saying so on every
  // unreleased sale would be noise.
  if (!tx.zohoSyncStatus && !tx.zohoCommissionInvoiceId) return null;

  async function retry() {
    setBusy(true);
    setFailed(null);
    try {
      await retryZohoPost(tx.id);
      onActed();
    } catch (err) {
      setFailed(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fold
      label="Books"
      summary={
        needs
          ? 'Commission invoice FAILED to post'
          : humanise(tx.zohoSyncStatus ?? 'posted')
      }
    >
      <Kv
        k="Sync status"
        v={humanise(tx.zohoSyncStatus ?? 'not attempted')}
        tone={needs ? 'bad' : tx.zohoSyncStatus ? 'ok' : undefined}
      />
      <Kv k="Invoice" v={tx.zohoCommissionInvoiceId ?? '—'} />
      <Kv k="Payment" v={tx.zohoCommissionPaymentId ?? '—'} />
      <Kv k="Last attempt" v={formatWhen(tx.zohoSyncLastAttemptAt)} />
      {tx.zohoSyncError ? (
        <Kv k="Error" v={tx.zohoSyncError} tone="bad" mono={false} last />
      ) : null}
      {needs ? (
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" onClick={() => void retry()} disabled={busy}>
            {busy ? 'Posting…' : 'Retry the Books post'}
          </Button>
          {failed ? (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dk-bad)', lineHeight: 1.5 }}>
              {`Still not posted. ${failed}`}
            </div>
          ) : null}
        </div>
      ) : null}
    </Fold>
  );
}

/**
 * A party's handle, as a door into their Member drawer.
 *
 * Renders plain text when there is no id to open — which is the deleted-account
 * case, and must not look like a link that does nothing.
 */
function PartyLink({ party }: { party: OrderParty }) {
  const label = party.username ?? '—';
  if (!party.id) return <>{label}</>;
  return (
    <a
      href={`/admin/desk/people?member=${encodeURIComponent(party.id)}`}
      style={{ color: 'var(--dk-ink)', textUnderlineOffset: 3 }}
    >
      {label}
    </a>
  );
}

function Fold({
  label,
  summary,
  children,
  last = false,
}: {
  label: string;
  summary: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Section
      label={label}
      last={last}
      action={
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {open ? children : <Muted>{summary}</Muted>}
    </Section>
  );
}
