// Fees & Charges — the public fee schedule. Every number here is sourced
// directly from the code so the page can never drift from what is actually
// charged:
//   - Platform Fee bands + R10 minimum:
//     backend/src/payments/fee.calculator.ts (BANDS, MIN_COMMISSION_CENTS)
//   - Auction split (5% buyer / 5% seller): AUCTION_SPLIT_RATE
//   - Marketplace direction: FeeCalculator.listPriceFromSellerAsk() — the
//     seller's ask IS the listed price; the fee is added at checkout.
//   - Shipping handling (10% of the carrier rate): SHIPPING_HANDLING_RATE
//   - Cancellation: 4% handling fee (CANCELLATION_HANDLING_RATE)
//
// Operator decision 2026-10: the Buyer Protection Fee is retired. There is ONE
// buyer-paid Platform Fee, calculated LAST on (item + delivery):
//   MARKETPLACE — marginal 10/9/8/7. The seller receives their full ask.
//   AUCTION     — flat 10% total, split 5% buyer / 5% seller.
//   PRIVATE ARRANGE — no delivery charge; the fee is on the item only.
//
// House rules baked in:
//   NEVER name a payment provider here until a contract is signed (TPPP).
//   NEVER use the word "escrow" — say "funds held" / "payment held".
//   The worked examples below are COMPUTED from the constants above —
//   recompute them, never guess, if a rate ever changes.

import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Fees',
  description:
    'What ALL Outdoor charges — the single Platform Fee, the banded marketplace rates, the 5% / 5% auction split, cancellation costs, payouts and delivery.',
};

const BANDS: [string, string][] = [
  ['First R25,000', '10%'],
  ['R25,001 – R50,000', '9%'],
  ['R50,001 – R75,000', '8%'],
  ['Above R75,000', '7%'],
];

const money = (cents: number) =>
  `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function FeesPage() {
  // Marketplace example: R1,000 ask + a R79 courier rate (10% handling → R86.90).
  const ask = 100_000;
  const carrier = 7_900;
  const delivery = carrier + Math.round(carrier * 0.1);
  const marketplaceFee = Math.round((ask + delivery) * 0.1);
  const buyerPays = ask + delivery + marketplaceFee;

  // Auction example: R1,000 hammer.
  const hammer = 100_000;
  const auctionBuyerFee = Math.max(
    1_000,
    Math.round((hammer + delivery) * 0.05),
  );
  const auctionSellerFee = Math.round(hammer * 0.05);
  const auctionBuyerPays = hammer + delivery + auctionBuyerFee;
  const auctionSellerReceives = hammer - auctionSellerFee;

  // Cancellation example, from the marketplace buyer total above.
  const handlingFee = Math.round((buyerPays - marketplaceFee) * 0.04);
  const earlyRefund = buyerPays - handlingFee;
  const lateRefund = buyerPays - delivery - handlingFee;

  return (
    <>
      <LegalDocHeader title="Fees" lastUpdated="Effective 19 October 2026" />

      <h2>The short version</h2>
      <div
        style={{
          background: 'rgba(34,197,94,0.06)',
          border: '0.5px solid var(--success)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          fontSize: 14,
          color: 'var(--text-primary)',
        }}
      >
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Listing is free.</strong> Browsing, listing and offering cost nothing.</li>
          <li>
            <strong>There is one Platform Fee.</strong> It replaced the old
            Buyer Protection Fee. It is calculated last, on the item price plus
            delivery, and shown before payment.
          </li>
          <li>
            <strong>On a marketplace (Buy Now) sale you receive your full asking price.</strong>{' '}
            The buyer pays the Platform Fee on top; nothing is deducted from you.
          </li>
          <li>
            <strong>On an auction the Platform Fee is a flat 10%</strong> —
            the buyer pays 5% of the hammer plus delivery, and you pay 5% of
            the hammer, deducted from your payout.
          </li>
          <li>
            <strong>A buyer who cancels before dispatch</strong> is refunded
            less a 4% transaction handling fee; delivery is also retained once
            a waybill is booked. After dispatch there is no cancellation — only
            the dispute process.
          </li>
          <li><strong>No charge until a sale completes.</strong> Nothing is billed up front.</li>
        </ul>
      </div>

      <h2>1. The Platform Fee — marketplace</h2>
      <p>
        On a Buy Now listing the seller&apos;s <strong>asking price is the
        listed price</strong>. The buyer pays one <strong>Platform Fee</strong>,
        calculated last at checkout on the item price plus the delivery figure.
        It is charged in bands, so only the portion of the amount inside each
        band is charged at that band&apos;s rate:
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Portion of item + delivery</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Platform Fee</th>
          </tr>
        </thead>
        <tbody>
          {BANDS.map(([band, rate], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{band}</td>
              <td style={{ padding: '6px 0' }}>{rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        A <strong>minimum Platform Fee of R10</strong> applies to a sale (it is
        never more than the amount it is charged on). This keeps low-value
        sales workable.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        <strong>How the bands add up.</strong> On a R60,000 amount the fee is
        R2,500 (10% of the first R25,000) + R2,250 (9% of the next R25,000) +
        R800 (8% of the next R10,000) = <strong>R5,550</strong>.
      </p>

      <h2>2. Marketplace — you receive your asking price in full</h2>
      <p>
        When you list at a fixed price, the number you type is both{' '}
        <strong>the listed price and what you receive</strong>. The buyer pays
        the Platform Fee and delivery on top. You see the full breakdown in the
        Sell form before you publish.
      </p>
      <p>
        <strong>A worked example.</strong> A seller asks {money(ask)} for a camp
        stove, and the courier quotes {money(carrier)} to deliver it (the
        buyer-facing delivery figure is {money(delivery)} including our 10%
        handling):
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          {[
            ['Your asking price — the listed price and what you receive', money(ask)],
            ['Delivery (courier rate + 10% handling)', money(delivery)],
            ['Platform Fee (10% of item + delivery)', money(marketplaceFee)],
          ].map(([label, amount], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{label}</td>
              <td style={{ padding: '6px 0', textAlign: 'right' }}>{amount}</td>
            </tr>
          ))}
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '8px 8px 8px 0' }}>
              <strong>Buyer pays</strong>
            </td>
            <td style={{ padding: '8px 0', textAlign: 'right' }}>
              <strong>{money(buyerPays)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The buyer pays {money(buyerPays)}. The seller receives{' '}
        <strong>{money(ask)}</strong>. Nothing is deducted from that amount.
        Delivery is the courier&apos;s live rate plus our 10% handling margin,
        and the Platform Fee is charged on the two figures together.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        Because the R10 minimum applies to small sales, a low asking price
        carries a proportionally larger fee. The fee is calculated on the whole
        line, so the figure shown at checkout is the figure charged.
      </p>

      <h2>3. Auctions — a flat 10%, split 5% / 5%</h2>
      <p>
        An auction has one flat 10% Platform Fee. The <strong>buyer pays 5%</strong>{' '}
        of the hammer price plus delivery at checkout, and the{' '}
        <strong>seller pays 5%</strong> of the hammer price, deducted from the
        payout. An offer accepted on an auction follows the same split. The
        buyer&apos;s 5% has a R10 minimum.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        {/* ⚠️ KEEP THIS EXAMPLE PRODUCT NEUTRAL. /fees is public and in the
            sitemap, so whatever is named here is rendered text a crawler
            reads. Any everyday outdoor item in the same price band works. */}
        <strong>A worked example.</strong> A fishing reel sells at a winning bid
        of {money(hammer)}. The buyer pays {money(auctionBuyerFee)} (5% of the
        hammer plus {money(delivery)} delivery), and the seller pays{' '}
        {money(auctionSellerFee)} (5% of the hammer), receiving{' '}
        <strong>{money(auctionSellerReceives)}</strong>. The buyer&apos;s total
        is <strong>{money(auctionBuyerPays)}</strong>.
      </p>

      <h2>4. Private arrangement — no delivery charge</h2>
      <p>
        Where the parties arrange the hand-over themselves, there is no courier
        leg and no delivery or handling charge. The Platform Fee is calculated on
        the item price alone. The buyer still pays the fee and the seller still
        receives the agreed price (or pays the 5% auction share where the sale
        arose from an auction).
      </p>

      <h2>5. Cancellations and the 4% handling fee</h2>
      <p>
        A buyer may request cancellation only <strong>before the seller marks
        the order dispatched</strong>. The calculation is set out in full in the{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
        In summary:
      </p>
      <ul>
        <li>
          <strong>Before the seller accepts, or before a waybill is booked:</strong>{' '}
          the buyer is refunded the amount paid less a <strong>4% transaction
          handling fee</strong>. The Platform Fee and delivery are returned.
          On the example above that is {money(buyerPays)} − {money(handlingFee)}
          = <strong>{money(earlyRefund)}</strong>.
        </li>
        <li>
          <strong>After the seller accepts and a waybill is booked, but before
          dispatch:</strong> delivery is also non-refundable, because the
          carrier charge is committed. The refund is{' '}
          <strong>{money(lateRefund)}</strong>.
        </li>
        <li>
          <strong>After dispatch:</strong> the order cannot be cancelled. The
          buyer must use the dispute process instead.
        </li>
        <li>
          <strong>Seller fault:</strong> where the seller declines the sale,
          fails to dispatch, or never delivers, the buyer receives a{' '}
          <strong>100% refund</strong> with no 4% deduction.
        </li>
        <li>
          <strong>Death or hospitalisation:</strong> no cancellation fee is
          charged where the cancellation results from the death or
          hospitalisation of the buyer (CPA s17(5)).
        </li>
      </ul>

      <h2>6. When the seller is paid</h2>
      <p>
        ALL Outdoor holds the buyer&apos;s payment until the sale has safely
        completed, then releases the seller&apos;s proceeds to the seller&apos;s
        bank account — the full asking price on a marketplace sale, or the
        hammer less the 5% seller share on an auction. Payout is released:
      </p>
      <ul>
        <li>after <strong>delivery is confirmed</strong> for a couriered item; or</li>
        <li>after the <strong>transfer is verified as complete</strong> for an item that requires a licence or permit — such an item is handed over through a licensed dealer rather than couriered to the buyer, and the payout is only released once we have confirmation that the transfer went through.</li>
      </ul>
      <p>
        Additional terms apply to regulated categories. See the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>Regulated Items Annex</a>
        , available to registered members.
      </p>
      <p>
        Before a seller&apos;s <strong>first</strong> payout, our team carries
        out a manual review of the seller&apos;s bank details against their
        verified identity. This is a person-checked review, not an
        automated one. Full detail is on{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>How payments work</a>.
      </p>

      <h2>7. Delivery</h2>
      <p>
        Delivery is quoted at checkout at the courier&apos;s live rate for the
        parcel and is paid by the buyer. Delivery is either to your door or to
        a pickup point near you, whichever you choose. Our{' '}
        <strong>handling margin is 10% of the courier&apos;s rate</strong>,
        folded into the single delivery figure the buyer sees (items combined
        into one parcel produce one waybill). An item handed over through a
        licensed dealer, or a hand-over the parties arrange privately, creates
        no waybill and carries no ALL Outdoor delivery or handling charge. Any
        charge a dealer levies for receiving, storing or processing an item is
        that dealer&apos;s own charge, is payable directly to them, and is not
        collected or refunded by ALL Outdoor.
      </p>

      <h2>8. Currency and VAT</h2>
      <p>
        All prices are quoted and charged in South African Rand (ZAR).
        ALLOUTDOOR (PTY) LTD is not currently registered for VAT and therefore
        does not charge VAT on its Platform Fee.
      </p>

      <h2>9. Changes to our fees</h2>
      <p>
        If we change our fees we will update this page and the &quot;Effective&quot;
        date at the top. The fees that apply to any sale are the fees shown
        to you at the time you list and at checkout.
      </p>

      <h2>10. Questions</h2>
      <p>
        For anything about fees, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        {' '}or call {SUPPORT_PHONE_DISPLAY}. See also{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>How payments work</a>
        {' '}and our{' '}
        <a href="/terms" style={{ color: 'var(--red)' }}>Terms of Service</a>.
      </p>
    </>
  );
}
