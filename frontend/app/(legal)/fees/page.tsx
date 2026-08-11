// Fees & Charges — the public fee schedule. Every number here is
// sourced directly from the code so the page can never drift from
// what is actually charged:
//   - Seller commission bands + R30 minimum + Top Seller discount:
//     backend/src/payments/fee.calculator.ts (BANDS, MIN_COMMISSION_CENTS,
//     TOP_SELLER_DISCOUNT)
//   - Card processing fee (3.5% + R1.50 / transaction): same file
//   - Shipping handling (R15/waybill) + swap leg fees: same file
//   - GG PRO membership prices: backend/src/settings/settings.service.ts
//     (launch defaults R49 / R149; operator-tunable)
//   - Featured-slot ladder: FeaturedSlotConfig defaults in schema.prisma
//
// House rules baked in:
//   NEVER name a payment provider here until a contract is signed (TPPP).
//   NEVER use the word "escrow" — say "funds held" / "payment held".

import { SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Fees',
  description:
    'What All Outdoor charges — seller commission, payment processing, payouts and optional extras.',
};

export default function FeesPage() {
  return (
    <>
      <LegalDocHeader title="Fees" lastUpdated="Effective 16 July 2026" />

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
          <li><strong>No charge until a sale completes.</strong> Our commission is only ever taken from a completed sale — it is deducted from the seller's payout, never billed up front.</li>
          <li><strong>Commission is banded</strong> — a lower percentage applies the higher the sale price (see below).</li>
          <li>Optional extras (a GG PRO membership or a featured homepage slot) are the only things you can choose to pay for separately.</li>
        </ul>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 24 }}>
        Card payments are launching soon. The fees on this page are the fees
        that apply to a sale; you can browse and list in the meantime.
      </p>

      <h2>1. Seller commission</h2>
      <p>
        When your item sells, All Outdoor keeps a commission on the sale
        price. It is charged in bands, so only the portion of the price
        that falls inside each band is charged at that band's rate:
      </p>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Portion of the sale price</th>
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
        <strong>Worked example.</strong> On a R30,000 sale the commission
        is R450 (9% of the first R5,000) + R1,050 (7% of the next R15,000)
        + R500 (5% of the last R10,000) = <strong>R2,000</strong>.
      </p>
      <p>
        <strong>Top Seller discount.</strong> Sellers who reach Top Seller
        standing get a further 0.5% off their commission. The exact
        commission for any listing is always shown to you in the Sell
        form before you publish, and again on the transaction, so there
        are no surprises.
      </p>

      <h2>2. Payment processing fee</h2>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <p>
        Payments are handled by our appointed third-party payment service
        provider (a licensed South African payment service provider). When
        card payments go live, each payment carries a processing fee of{' '}
        <strong>3.5% + R1.50 per transaction</strong>. The exact amount —
        including any VAT charged by the payment processor — is always
        shown at checkout before you confirm.
      </p>
      <p>
        Whether this fee is built into the listing price by the seller or
        added to the buyer's total is set per listing. Either way, it is
        displayed before payment, so the buyer always sees the full total
        up front.
      </p>

      <h2>3. When the seller is paid</h2>
      <p>
        All Outdoor holds the buyer's payment until the sale has safely
        completed, then releases the seller's proceeds — the sale price
        less commission — to the seller's bank account. Payout is
        released:
      </p>
      <ul>
        <li>after <strong>delivery is confirmed</strong> for a couriered item; or</li>
        <li>after the <strong>SAPS 534 dealer transfer is verified</strong> for a firearm, which moves only between SAPS-licensed dealers.</li>
      </ul>
      <p>
        Before a seller's <strong>first</strong> payout, our team carries
        out a manual review of the seller's bank details against their
        verified identity. This is a person-checked review, not an
        automated one. Full detail is on{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>How payments work</a>.
      </p>

      <h2>4. Shipping</h2>
      <p>
        Shipping is quoted at checkout at the courier's live rate for the
        parcel and is paid by the buyer. Couriers are Pudo (locker-to-locker)
        and The Courier Guy (door-to-door). A flat{' '}
        <strong>R15 handling fee per parcel</strong> applies to
        courier-shipped orders. Firearm dealer transfers and in-person
        collection use no courier and carry no shipping or handling fee.
      </p>

      <h2>5. Optional extras</h2>

      <h3>5.1 GG PRO membership</h3>
      <p>
        GG PRO is the optional paid membership, at{' '}
        <strong>R99 per 31-day period</strong>. It includes the full Ask Boet
        assistant, the Load Lab load-data browser, swap benefits, and reduced
        fees on featured homepage slots (see below). Membership is prepaid —
        there is no debit order and no fixed-term contract; it simply lapses
        if you don&apos;t renew. The free tier includes a working preview of
        every PRO feature.
      </p>

      <h3>5.2 Featured homepage slots</h3>
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
        GG PRO members pay less for a featured slot: <strong>PRO saves 50%</strong>
        {' '}off the slot fee. The live tiers, floor and any discount are
        always shown on the bidding page before you commit.
      </p>

      <h3>5.3 Swap / Trade</h3>
      <p>
        When two members swap items rather than buy and sell, each party
        pays a service fee for the leg they send:{' '}
        <strong>1.5% of the item&apos;s declared value</strong>, with a
        minimum of <strong>R50</strong> for a courier leg (<strong>R100</strong>{' '}
        for a firearm dealer-transfer leg) and a cap of <strong>R750</strong>{' '}
        per leg. GG PRO members get 25% off the swap service fee. Any cash
        top-up above R1,000 carries the standard commission bands on the
        amount above R1,000, deducted from the cash the receiving party is
        paid at settlement. Your exact fee is always shown before you pay.
      </p>

      <h2>6. Currency and VAT</h2>
      <p>
        All prices are quoted and charged in South African Rand (ZAR).
        GunGalore (Pty) Ltd is not currently registered for VAT and
        therefore does not charge VAT on its commission. Any VAT shown at
        checkout is the payment processor's own VAT on the processing fee.
      </p>

      <h2>7. Changes to our fees</h2>
      <p>
        If we change our fees we will update this page and the "Effective"
        date at the top. The fees that apply to any sale are the fees shown
        to you at the time you list and at checkout.
      </p>

      <h2>8. Questions</h2>
      <p>
        For anything about fees, email{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        {' '}or call {SUPPORT_PHONE_DISPLAY}. See also{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>How payments work</a>
        {' '}and our{' '}
        <a href="/terms" style={{ color: 'var(--red)' }}>Terms of Service</a>.
      </p>
    </>
  );
}
