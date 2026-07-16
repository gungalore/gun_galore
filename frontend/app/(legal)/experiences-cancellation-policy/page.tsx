// Experiences Cancellation Policy — the CPA s17 "reasonable charge"
// cancellation schedule for hunting packages / on-site experiences.
//
// Mapped to the actual implementation:
//   - cancellation-policy.ts (computeCpaCancellation) + the buyer/outfitter
//     cancel endpoints in transactions.service.ts (EXP-E3)
//   - Statutory zero-charge full refunds: death/hospitalisation (CPA s17(5))
//     + supplier-side failure
//   - Funds are HELD (never "escrow") until the experience is completed
//
// NOTE FOR THE OPERATOR: the percentage bands below are a CPA-s17-reasonable
// STARTING DEFAULT and are held in a Setting override — have your attorney
// ratify the final numbers against industry practice before go-live.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Experiences Cancellation Policy',
  description:
    'How cancellations, refunds and your statutory rights work for hunting packages and on-site experiences under the Consumer Protection Act.',
};

export default function ExperiencesCancellationPolicyPage() {
  return (
    <>
      <LegalDocHeader
        title="Experiences Cancellation Policy"
        lastUpdated="Effective 5 July 2026"
      />

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
        <p style={{ margin: 0 }}>
          <strong>In short:</strong> a hunting package or experience is a
          service run by the outfitter, not by Gun Galore. You may cancel a
          booking at any time, but the closer you cancel to the event date the
          more of the price is retained — the outfitter has held that date for
          you. Cancel earlier and you keep more of your money.
        </p>
      </div>

      <h2>1. Who does what</h2>
      <p>
        The <strong>outfitter</strong> is the supplier of the experience — they
        run the hunt or range day, provide the venue, guide and facilities, and
        carry the Consumer Protection Act supplier obligations for it. Gun
        Galore is a <strong>payment-protection intermediary</strong>: we hold
        your payment until the experience has taken place and you confirm it
        happened, then release it to the outfitter less our commission. We are
        not the supplier of the experience.
      </p>

      <h2>2. How your payment is held</h2>
      <p>
        When you book, your payment is <strong>held</strong> — it is not paid to
        the outfitter yet. It stays held until, after the event date, you
        confirm the experience took place. Only then is it released to the
        outfitter. If the outfitter never confirms your booking, cancels, or
        fails to deliver, you are refunded (see section 4). This is a
        buyer-protection hold, not a deposit or investment product.
      </p>

      <h2>3. Cancellation by you (the hunter)</h2>
      <p>
        Under <strong>section 17 of the Consumer Protection Act</strong> you may
        cancel an advance booking subject to a <em>reasonable</em> cancellation
        charge. What is reasonable depends on how much notice you give and the
        outfitter's ability to re-book the date. Our default schedule (measured
        from the event date) is:
      </p>

      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={cellHead}>You cancel</th>
              <th style={cellHead}>Charge retained</th>
              <th style={cellHead}>You get back</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={cell}>60 days or more before</td><td style={cell}>R250 admin fee only</td><td style={cell}>Everything except the R250</td></tr>
            <tr><td style={cell}>30–59 days before</td><td style={cell}>20%</td><td style={cell}>80%</td></tr>
            <tr><td style={cell}>21–29 days before</td><td style={cell}>40%</td><td style={cell}>60%</td></tr>
            <tr><td style={cell}>14–20 days before</td><td style={cell}>50%</td><td style={cell}>50%</td></tr>
            <tr><td style={cell}>7–13 days before</td><td style={cell}>75%</td><td style={cell}>25%</td></tr>
            <tr><td style={cell}>Less than 7 days / no-show</td><td style={cell}>100%</td><td style={cell}>Nothing</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The retained amount (apart from the R250 admin fee, which covers our
        processing) compensates the outfitter for holding the date and is paid
        to them, less our commission. You can always see the exact refund and
        retained amounts for your booking on the booking page before you
        confirm a cancellation.
      </p>

      <h2>4. When you are fully refunded — no charge at all</h2>
      <p>You are refunded in full, with no cancellation charge, if:</p>
      <ul>
        <li>
          <strong>The outfitter cancels, does not show up, or materially fails
          to deliver</strong> the experience — this is a supplier failure, not
          your cancellation, so you are never charged for it.
        </li>
        <li>
          <strong>Death or hospitalisation</strong> of the person the booking
          was made for (Consumer Protection Act s17(5)). Contact support with
          proof and no cancellation charge applies.
        </li>
      </ul>

      <h2>5. Weather and force majeure</h2>
      <p>
        If the experience cannot go ahead because of weather or other
        circumstances beyond anyone's control, the outfitter will first offer
        you an alternative date. If no reasonable alternative can be arranged,
        contact support — a refund (less any unavoidable costs already incurred)
        will be considered.
      </p>

      <h2>6. Disputes</h2>
      <p>
        If something goes wrong with a booking, you can raise a dispute on the
        booking page up to 7 days after the event date. Your payment stays held
        while our team reviews it, and we resolve it by releasing to the
        outfitter or refunding you as the facts require. Do not confirm the
        experience as completed if you are unhappy — confirming releases payment
        to the outfitter and is final.
      </p>

      <h2>7. Your statutory rights</h2>
      <p>
        Nothing in this policy limits your rights under the Consumer Protection
        Act. A cancellation charge may never exceed a reasonable amount, and the
        statutory no-charge cases in section 4 always apply.
      </p>
    </>
  );
}

const cellHead: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '0.5px solid var(--border)',
  fontWeight: 500,
  color: 'var(--text-primary)',
};
const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '0.5px solid var(--border)',
  color: 'var(--text-secondary)',
};
