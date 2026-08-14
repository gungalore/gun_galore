// Fees & Charges — the public fee schedule. Every number here is
// sourced directly from the code so the page can never drift from
// what is actually charged:
//   - Seller commission bands + R30 minimum + Top Seller discount:
//     backend/src/payments/fee.calculator.ts (BANDS, MIN_COMMISSION_CENTS,
//     TOP_SELLER_DISCOUNT)
//   - Card transaction fee (3.5% + R1.50 net, ×1.15 VAT): same file
//     (PEACH_RATE, PEACH_FIXED_CENTS, VAT_MULTIPLIER)
//   - Buy Now markup direction: FeeCalculator.listPriceFromSellerAsk() —
//     ask → +commission → +transaction fee → listed price
//   - Shipping handling (R15/waybill) + swap leg fees: same file
//   - AO PRO membership prices: backend/src/settings/settings.service.ts
//     (launch defaults R49 / R149; operator-tunable)
//   - Featured-slot ladder: FeaturedSlotConfig defaults in schema.prisma
//
// Operator decision 2026-08-15 — the direction of our cut changed and the
// two sale modes now differ. Keep them separate on this page:
//   BUY NOW  — the seller names what they RECEIVE; commission and the
//              transaction fee are built INTO the listed price. Nothing
//              comes off the payout.
//   AUCTION / TAKE A SHOT — a bid or offer discovers the price, so there
//              is nothing to build in. Commission comes OUT of the sale
//              price; the buyer pays the transaction fee on top.
//
// House rules baked in:
//   NEVER name a payment provider here until a contract is signed (TPPP).
//   NEVER use the word "escrow" — say "funds held" / "payment held".
//   Call the gateway fee a "Transaction fee", not a "processing fee".
//   The worked examples below are COMPUTED from the constants above —
//   recompute them, never guess, if a rate ever changes.

import { PRO_NAME } from '@/lib/brand';
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Fees',
  description:
    'What All Outdoor charges — Buy Now sellers receive their full asking price, banded commission, the transaction fee, payouts, delivery and optional extras.',
};

export default function FeesPage() {
  return (
    <>
      <LegalDocHeader title="Fees" lastUpdated="Effective 15 August 2026" />

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
            You type what you want to receive; our commission and the card
            transaction fee are included in the price buyers see. Nothing is
            deducted from you, and nothing is added at the buyer&apos;s checkout
            except delivery.
          </li>
          <li>
            <strong>On auctions and accepted offers the price is whatever the bid or offer settled at.</strong>{' '}
            There is nothing to build in, so our commission comes out of that
            price and the buyer pays a transaction fee on top.
          </li>
          <li><strong>Commission is banded</strong> — a lower percentage applies the higher the price (see below), with a R30 minimum.</li>
          <li><strong>No charge until a sale completes.</strong> Nothing is billed up front, in either mode.</li>
          <li>Optional extras (an {PRO_NAME} membership or a featured homepage slot) are the only things you can choose to pay for separately.</li>
        </ul>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 24 }}>
        Card payments are launching soon. The fees on this page are the fees
        that apply to a sale; you can browse and list in the meantime.
      </p>

      <h2>1. Our commission</h2>
      <p>
        All Outdoor earns a commission on every completed sale. It is
        charged in bands, so only the portion of the price that falls
        inside each band is charged at that band's rate:
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
            ['First R5,000', '9%'],
            ['R5,001 – R20,000', '7%'],
            ['R20,001 – R100,000', '5%'],
            ['Above R100,000', '3%'],
          ].map(([band, rate], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{band}</td>
              <td style={{ padding: '6px 0' }}>{rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        A <strong>minimum commission of R30</strong> applies to a sale
        (it is never more than the sale price itself). This keeps
        low-value sales workable.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        <strong>How the bands add up.</strong> On a R30,000 amount the
        commission is R450 (9% of the first R5,000) + R1,050 (7% of the
        next R15,000) + R500 (5% of the last R10,000) ={' '}
        <strong>R2,000</strong>.
      </p>
      <p>
        <strong>Top Seller discount.</strong> Sellers who reach Top Seller
        standing get a further 0.5% off their commission. The exact
        commission for any listing is always shown to you in the Sell
        form before you publish, and again on the transaction, so there
        are no surprises.
      </p>
      <p>
        Which side of the sale the commission is collected from depends on
        how you listed. On a <strong>Buy Now</strong> listing it is added
        on top of what you asked for, so your payout is untouched
        (section&nbsp;2). On an <strong>auction</strong> or an accepted{' '}
        <strong>Take-a-Shot offer</strong> it comes out of the price the
        bidding or the offer settled at (section&nbsp;3).
      </p>

      <h2>2. Buy Now — you receive your asking price in full</h2>
      <p>
        When you list at a fixed price, the number you type is{' '}
        <strong>what you receive</strong>, not what the buyer pays. Our
        commission and the card transaction fee are added to it, and the
        result is the listed price shown on the listing. You see both
        numbers in the Sell form before you publish.
      </p>
      <p>
        <strong>A worked example.</strong> A seller wants R450.00 for a
        pair of binoculars:
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          {[
            ['Your asking price — what you receive', 'R450.00'],
            ['Our commission (9% of the first R5,000)', 'R40.50'],
            ['Subtotal', 'R490.50'],
            ['Transaction fee (4.025% + R1.73 on the subtotal)', 'R21.47'],
          ].map(([label, amount], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{label}</td>
              <td style={{ padding: '6px 0', textAlign: 'right' }}>{amount}</td>
            </tr>
          ))}
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '8px 8px 8px 0' }}>
              <strong>Listed price — what the buyer sees and pays</strong>
            </td>
            <td style={{ padding: '8px 0', textAlign: 'right' }}>
              <strong>R511.97</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The buyer pays R511.97, plus delivery. The seller receives{' '}
        <strong>R450.00</strong>. Nothing is deducted from that R450.00,
        and nothing is added to the buyer&apos;s total at checkout except
        delivery (see section&nbsp;6).
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        Two things follow from the bands. Because the R30 minimum
        commission applies to small sales, a low asking price carries a
        proportionally larger markup — ask R100.00 and the listing shows
        R136.96 (R100.00 + R30.00 commission + R6.96 transaction fee).
        And because each unit is priced on its own, listing a quantity of
        two costs the buyer exactly twice the listed price.
      </p>

      <h2>3. Auctions and Take-a-Shot offers</h2>
      <p>
        A bid or an offer <em>discovers</em> the price, so there is
        nothing to build a markup into. These two modes work the way they
        always have: the sale price is whatever the bidding or the
        accepted offer settled at, <strong>our commission comes out of
        that price</strong>, and the balance is paid to the seller. The
        buyer pays a <strong>transaction fee</strong> on top, shown
        before they confirm payment.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        <strong>A worked example.</strong> A rifle scope sells at a
        winning bid of R450.00. Commission is R40.50, so the seller
        receives <strong>R409.50</strong>. The buyer pays the R450.00 bid,
        plus a transaction fee (R19.84 on R450.00 before delivery — the
        fee is calculated on the item price and delivery together), plus
        delivery.
      </p>
      <p>
        The same applies to a Swop / Trade cash top-up above the
        threshold in section&nbsp;7.3: commission is deducted from the
        cash the receiving party is paid.
      </p>

      <h2>4. Transaction fee</h2>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      {/* House rule (operator, 2026-08-15): call this a "Transaction fee" — never a "processing fee". */}
      <p>
        Payments are handled by our appointed third-party payment service
        provider (a licensed South African payment service provider). When
        card payments go live, every payment carries a transaction fee of{' '}
        <strong>3.5% + R1.50</strong> charged by that provider, plus VAT at
        15% — <strong>4.025% + R1.73 per transaction</strong> once VAT is
        included. It is charged on the item price and delivery together.
      </p>
      <p>
        On a <strong>Buy Now</strong> listing this fee is already inside
        the listed price on the item, as in the example above — it is not
        added again at checkout. On an <strong>auction</strong> or an
        accepted <strong>offer</strong>, it appears as a separate{' '}
        <strong>Transaction fee</strong> line at checkout. Either way the
        buyer sees the exact amount, to the cent, before confirming
        payment.
      </p>

      <h2>5. When the seller is paid</h2>
      <p>
        All Outdoor holds the buyer's payment until the sale has safely
        completed, then releases the seller's proceeds to the seller's
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
        Before a seller's <strong>first</strong> payout, our team carries
        out a manual review of the seller's bank details against their
        verified identity. This is a person-checked review, not an
        automated one. Full detail is on{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>How payments work</a>.
      </p>

      <h2>6. Delivery</h2>
      <p>
        Delivery is quoted at checkout at the courier's live rate for the
        parcel and is paid by the buyer — it is the one thing that cannot
        be built into a listed price, because it depends on an address
        that does not exist until checkout. Couriers are Pudo
        (locker-to-locker) and The Courier Guy (door-to-door). A flat{' '}
        <strong>R15 handling charge applies per courier waybill</strong>{' '}
        (items combined into one parcel produce one waybill and are
        charged once). An item handed over through a licensed dealer, or a
        hand-over the parties arrange privately, creates no waybill and
        carries no All Outdoor delivery or handling charge. Any charge a
        dealer levies for receiving, storing or processing an item is that
        dealer&apos;s own charge, is payable directly to them, and is not
        collected or refunded by All Outdoor.
      </p>

      <h2>7. Optional extras</h2>

      <h3>7.1 {PRO_NAME} membership</h3>
      <p>
        {PRO_NAME} is the optional paid membership, at{' '}
        <strong>R99 per 31-day period</strong>. It includes the full Ask Boet
        assistant, the Load Lab load-data browser, swap benefits, and reduced
        fees on featured homepage slots (see below). Membership is prepaid —
        there is no debit order and no fixed-term contract; it simply lapses
        if you don&apos;t renew. The free tier includes a working preview of
        every PRO feature.
      </p>

      <h3>7.2 Featured homepage slots</h3>
      <p>
        There are ten featured slots on the homepage, allocated by
        auction. You bid the amount you're willing to pay, and the amount
        determines how long your listing stays featured. Bidding starts at
        a floor of <strong>R100</strong>. The current ladder is:
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Slot fee</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Featured for</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['R100', '1 day'],
            ['R200', '2 days'],
            ['R300', '5 days'],
            ['R400', '7 days'],
            ['R500', '14 days'],
          ].map(([fee, dur], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{fee}</td>
              <td style={{ padding: '6px 0' }}>{dur}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {PRO_NAME} members pay less for a featured slot: <strong>PRO saves 50%</strong>
        {' '}off the slot fee. The live tiers, floor and any discount are
        always shown on the bidding page before you commit.
      </p>

      <h3>7.3 Swap / Trade</h3>
      <p>
        When two members swap items rather than buy and sell, each party
        pays a service fee for the leg they send:{' '}
        <strong>1.5% of the item&apos;s declared value</strong>, with a
        minimum of <strong>R50</strong> for a courier leg (<strong>R100</strong>{' '}
        for a leg that has to complete through a licensed dealer) and a cap of{' '}
        <strong>R750</strong>{' '}
        per leg. {PRO_NAME} members get 25% off the swap service fee. Any cash
        top-up above R1,000 carries the standard commission bands on the
        amount above R1,000, deducted from the cash the receiving party is
        paid at settlement. Your exact fee is always shown before you pay.
      </p>

      <h2>8. Currency and VAT</h2>
      <p>
        All prices are quoted and charged in South African Rand (ZAR).
        ALLOUTDOOR (PTY) LTD is not currently registered for VAT and
        therefore does not charge VAT on its commission. The VAT included
        in the transaction fee is the payment service provider's own VAT
        on that fee.
      </p>

      <h2>9. Changes to our fees</h2>
      <p>
        If we change our fees we will update this page and the "Effective"
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
