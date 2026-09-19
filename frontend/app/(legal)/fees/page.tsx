// Fees & Charges — the public fee schedule. Every number here is sourced
// directly from the code so the page can never drift from what is actually
// charged:
//   - Seller commission bands + R10 minimum + Top Seller discount:
//     backend/src/payments/fee.calculator.ts (BANDS, MIN_COMMISSION_CENTS,
//     TOP_SELLER_DISCOUNT)
//   - Buyer Protection Fee (Ozow card, 3.28% + R1.15 inclusive): same file
//     (OZOW_RATE, OZOW_FIXED_CENTS)
//   - Buy Now markup direction: FeeCalculator.listPriceFromSellerAsk() —
//     ask → +commission → listed price (the Protection Fee is NOT in it)
//   - Shipping handling (10% of the carrier rate): same file
//
// Operator decision 2026-09 — the Buyer Protection Fee is charged to the
// buyer on every sale, at checkout, on (item + shipping):
//   BUY NOW  — the seller names what they RECEIVE; commission is built into
//              the listed price. The buyer pays listed price + Protection
//              Fee + delivery.
//   AUCTION / TAKE A SHOT — a bid or offer discovers the price. Commission
//              comes out of it; the buyer pays the Protection Fee + delivery.
//
// House rules baked in:
//   NEVER name a payment provider here until a contract is signed (TPPP).
//   NEVER use the word "escrow" — say "funds held" / "payment held".
//   Call the buyer fee the "Buyer Protection Fee".
//   The worked examples below are COMPUTED from the constants above —
//   recompute them, never guess, if a rate ever changes.

import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Fees',
  description:
    'What All Outdoor charges — Buy Now sellers receive their full asking price, banded commission, the Buyer Protection Fee, payouts and delivery.',
};

export default function FeesPage() {
  return (
    <>
      <LegalDocHeader title="Fees" lastUpdated="Effective 19 September 2026" />

      <h2>The short version</h2>
      <div
        style={{
          background: 'rgba(34,197,94,0.06)',
          border: '0.5px solid #22c55e',
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
            <strong>On a Buy Now sale you receive your full asking price.</strong>{' '}
            You type what you want to receive; our commission is included in the
            price buyers see. Nothing is deducted from you.
          </li>
          <li>
            <strong>On auctions and accepted offers the price is whatever the bid or offer settled at.</strong>{' '}
            There is nothing to build in, so our commission comes out of that
            price.
          </li>
          <li>
            <strong>The buyer pays a Buyer Protection Fee</strong> on every
            sale, added at checkout on the item plus delivery, together with
            the delivery charge itself.
          </li>
          <li><strong>Commission is banded</strong> — a lower percentage applies the higher the price (see below), with a R10 minimum.</li>
          <li><strong>No charge until a sale completes.</strong> Nothing is billed up front, in either mode.</li>
        </ul>
      </div>

      <h2>1. Our commission</h2>
      <p>
        All Outdoor earns a commission on every completed sale. It is
        charged in bands, so only the portion of the price that falls
        inside each band is charged at that band&apos;s rate:
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Portion of the amount</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Commission</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['First R5,000', '10%'],
            ['R5,001 – R15,000', '8%'],
            ['R15,001 – R25,000', '6%'],
            ['Above R25,000', '4%'],
          ].map(([band, rate], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{band}</td>
              <td style={{ padding: '6px 0' }}>{rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The amount the bands are applied to is the seller&apos;s{' '}
        <strong>asking price</strong> on a Buy Now listing, and the{' '}
        <strong>settled sale price</strong> on an auction or an accepted
        offer. A <strong>minimum commission of R10</strong> applies to a
        sale (it is never more than the sale price itself). This keeps
        low-value sales workable.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        <strong>How the bands add up.</strong> On a R30,000 amount the
        commission is R500 (10% of the first R5,000) + R800 (8% of the
        next R10,000) + R600 (6% of the next R10,000) + R200 (4% of the last
        R5,000) = <strong>R2,100</strong>.
      </p>
      <p>
        <strong>Top Seller discount.</strong> Sellers who reach Top Seller
        standing get a further 0.5% off their commission. The exact
        commission for any listing is always shown to you in the Sell
        form before you publish, and again on the transaction, so there
        are no surprises.
      </p>

      <h2>2. Buy Now — you receive your asking price in full</h2>
      <p>
        When you list at a fixed price, the number you type is{' '}
        <strong>what you receive</strong>, not what the buyer pays. Our
        commission is added to it, and the result is the listed price shown on
        the listing. You see both numbers in the Sell form before you publish.
      </p>
      <p>
        <strong>A worked example.</strong> A seller wants R1,000.00 for a
        camp stove:
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          {[
            ['Your asking price — what you receive', 'R1,000.00'],
            ['Our commission (10% of the first R5,000)', 'R100.00'],
            ['Listed price — what the buyer sees', 'R1,100.00'],
            ['Buyer Protection Fee (3.28% + R1.15 on the item)', 'R37.23'],
          ].map(([label, amount], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{label}</td>
              <td style={{ padding: '6px 0', textAlign: 'right' }}>{amount}</td>
            </tr>
          ))}
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '8px 8px 8px 0' }}>
              <strong>Buyer pays (plus delivery)</strong>
            </td>
            <td style={{ padding: '8px 0', textAlign: 'right' }}>
              <strong>R1,137.23</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The buyer pays R1,137.23 plus delivery. The seller receives{' '}
        <strong>R1,000.00</strong>. Nothing is deducted from that R1,000.00.
        Delivery is the courier&apos;s live rate for the parcel plus our 10%
        handling margin, and the Buyer Protection Fee is charged on the item
        and the carrier&apos;s rate together (see section&nbsp;4).
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        Because the R10 minimum commission applies to small sales, a low
        asking price carries a proportionally larger markup. And because each
        unit is priced on its own, listing a quantity of two costs the buyer
        exactly twice the listed price for the goods.
      </p>

      <h2>3. Auctions and Take-a-Shot offers</h2>
      <p>
        A bid or an offer <em>discovers</em> the price, so there is
        nothing to build a markup into. These two modes work the way they
        always have: the sale price is whatever the bidding or the
        accepted offer settled at, <strong>our commission comes out of
        that price</strong>, and the balance is paid to the seller. The
        buyer pays the <strong>Buyer Protection Fee</strong> and delivery on
        top, shown before they confirm payment.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        {/* ⚠️ KEEP THIS EXAMPLE PRODUCT NEUTRAL. /fees is public and in the
            sitemap, so whatever is named here is rendered text a crawler
            reads. Any everyday outdoor item in the same price band works. */}
        <strong>A worked example.</strong> A fishing reel sells at a
        winning bid of R1,000.00. Commission is R100.00, so the seller
        receives <strong>R900.00</strong>. The buyer pays the R1,000.00
        bid, delivery, and the Buyer Protection Fee on the two together —
        R33.95 on the R1,000.00 on its own, a little more once a delivery
        charge is added.
      </p>

      <h2>4. Buyer Protection Fee</h2>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <p>
        Payments are handled by our appointed third-party payment service
        provider (a licensed South African payment service provider). Every
        order carries a <strong>Buyer Protection Fee</strong> of{' '}
        <strong>3.28% + R1.15</strong> (VAT included), charged on the item
        price and the carrier&apos;s rate together, shown as its own line at
        checkout before the buyer confirms payment.
      </p>
      <p>
        The fee funds the protections every buyer gets on this platform: we
        hold the seller&apos;s payment until the order is safely completed, we
        verify sellers before they can be paid out, and we step in on disputes
        — including a refund where a claim is valid. See{' '}
        <a href="/buyer-protection" style={{ color: 'var(--red)' }}>Buyer Protection</a>{' '}
        for what is covered.
      </p>

      <h2>5. When the seller is paid</h2>
      <p>
        All Outdoor holds the buyer&apos;s payment until the sale has safely
        completed, then releases the seller&apos;s proceeds to the seller&apos;s
        bank account — the full asking price on a Buy Now sale, or the
        sale price less commission on an auction or accepted offer.
        Payout is released:
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

      <h2>6. Delivery</h2>
      <p>
        Delivery is quoted at checkout at the courier&apos;s live rate for the
        parcel and is paid by the buyer — it is the one thing that cannot
        be built into a listed price, because it depends on an address
        that does not exist until checkout. Delivery is either to your door
        or to a pickup point near you, whichever you choose. Our{' '}
        <strong>handling margin is 10% of the courier&apos;s rate</strong>,
        folded into the single delivery figure the buyer sees (items combined
        into one parcel produce one waybill). An item handed over through a
        licensed dealer, or a hand-over the parties arrange privately,
        creates no waybill and carries no All Outdoor delivery or handling
        charge. Any charge a dealer levies for receiving, storing or
        processing an item is that dealer&apos;s own charge, is payable
        directly to them, and is not collected or refunded by All Outdoor.
      </p>

      <h2>7. Currency and VAT</h2>
      <p>
        All prices are quoted and charged in South African Rand (ZAR).
        ALLOUTDOOR (PTY) LTD is not currently registered for VAT and
        therefore does not charge VAT on its commission. The VAT included
        in the Buyer Protection Fee is the payment service provider&apos;s own
        VAT on that fee.
      </p>

      <h2>8. Changes to our fees</h2>
      <p>
        If we change our fees we will update this page and the &quot;Effective&quot;
        date at the top. The fees that apply to any sale are the fees shown
        to you at the time you list and at checkout.
      </p>

      <h2>9. Questions</h2>
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
