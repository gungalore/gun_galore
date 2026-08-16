// Shared firearm checkout consents — copied from checkout-form.tsx so the cart reuses the exact SA-firearms-law wording. Keep the two in sync.
'use client';

import { useEffect, useState } from 'react';

// Self-contained input style — equivalent to the `inputStyle` const in
// checkout-form.tsx, inlined here so this module doesn't import from the
// single-item checkout form.
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

// After payout, both parties arrange the rest themselves —
// inter-dealer transfer to the buyer's preferred dealer,
// collection logistics, whatever. We don't route the firearm
// or pick the destination dealer.
//
// Single checkbox gate — the buyer keeps payment protection
// (funds held) until verification approves, so this is lower
// friction than PRIVATE_ARRANGE where they're waiving protection.
export function DealerTransferConsent({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="rounded-[6px] p-4 text-sm space-y-3"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        color: 'var(--text-primary)',
        lineHeight: 1.55,
      }}
    >
      <p
        className="text-xs uppercase"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        Dealer transfer
      </p>

      <p style={{ color: 'var(--text-secondary)' }}>
        The seller will drop the firearm with their nearest
        SAPS-licensed dealer to be booked into the dealer&apos;s
        stock register. Once we&apos;ve verified the transfer
        paperwork, we&apos;ll send you that dealer&apos;s contact
        details so you know exactly where your firearm is sitting.
        You and the seller then arrange the rest between yourselves.
      </p>

      <div
        className="rounded-[6px] p-3 text-xs"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="uppercase mb-2"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            fontWeight: 500,
          }}
        >
          How this works
        </p>
        <ol
          className="space-y-1.5 pl-5"
          style={{ listStyle: 'decimal', color: 'var(--text-secondary)' }}
        >
          <li>
            You pay now — your funds are{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              held by All Outdoor
            </strong>
            .
          </li>
          <li>
            We notify the seller that the firearm has been sold. The
            seller takes it to their nearest SAPS-licensed dealer to
            sign it over and have it booked into the dealer&apos;s
            stock register.
          </li>
          <li>
            The seller uploads{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              3 photos
            </strong>{' '}
            on All Outdoor — the completed SAPS 534, the dealer&apos;s
            stock-register last line, and the firearm with its serial
            visible. Our AI checks the documents; if anything&apos;s
            unclear a human reviewer steps in.
          </li>
          <li>
            Once verified, we send you the{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              dealer&apos;s name, address, and contact details
            </strong>{' '}
            so you know where the firearm is — and we release the
            held funds to the seller.
          </li>
          <li>
            All Outdoor&apos;s job in the transaction ends there. You
            and the seller arrange the inter-dealer transfer to your
            own dealer (or your preferred collection method) between
            yourselves.
          </li>
        </ol>
      </div>

      <p
        className="text-xs"
        style={{
          color: 'var(--text-tertiary)',
          background: 'rgba(245,158,11,0.08)',
          border: '0.5px solid rgba(245,158,11,0.45)',
          borderRadius: 4,
          padding: '8px 10px',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: '#f59e0b' }}>Important:</strong>{' '}
        The SAPS 534 must be filled in using{' '}
        <strong style={{ color: 'var(--text-primary)' }}>
          BLOCK LETTERS
        </strong>{' '}
        so our AI can read it. Unclear handwriting gets flagged for
        manual review and delays the seller&apos;s payout — which
        delays everything that follows.
      </p>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--red)' }}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I understand All Outdoor holds my funds until the
          seller&apos;s dealer stock-in is verified, after which Gun
          Galore notifies me which dealer has the firearm and
          releases the funds — the inter-dealer transfer onwards is
          arranged between me and the seller directly.
        </span>
      </label>

      <p
        className="text-xs"
        style={{
          color: accepted ? '#00a03c' : 'var(--text-tertiary)',
        }}
      >
        {accepted
          ? '✓ Acknowledged. You can proceed to payment below.'
          : 'Tick the box to enable payment.'}
      </p>
    </div>
  );
}

// Hard-consent gate for PRIVATE_ARRANGE. Two checkboxes + the literal
// phrase "I UNDERSTAND" typed into a text field. Until all three pass,
// `accepted` stays false and the parent's isReady() returns false.
//
// Why this level of friction: PRIVATE_ARRANGE waives payment protection
// — the seller is paid the moment Peach confirms the card. We need an
// unmistakable opt-in so a buyer can't later claim they didn't know
// what they were giving up. The screen also doubles as documentation
// for support if a dispute lands.
export function PrivateArrangeConsent({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
}) {
  const [box1, setBox1] = useState(false);
  const [box2, setBox2] = useState(false);
  const [phrase, setPhrase] = useState('');

  const phraseOk = phrase.trim().toUpperCase() === 'I UNDERSTAND';
  const allOk = box1 && box2 && phraseOk;

  // Push the derived `allOk` upward so the parent's isReady() sees it.
  useEffect(() => {
    if (allOk !== accepted) onChange(allOk);
  }, [allOk, accepted, onChange]);

  return (
    <div
      className="rounded-[6px] p-4 text-sm space-y-3"
      style={{
        background: 'rgba(200,16,46,0.06)',
        border: '0.5px solid var(--red)',
        color: 'var(--text-primary)',
        lineHeight: 1.55,
      }}
    >
      <p
        className="text-xs uppercase"
        style={{
          color: 'var(--red)',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        Private arrangement — you waive All Outdoor&apos;s payment protection
      </p>

      <p style={{ color: 'var(--text-secondary)' }}>
        Choosing Private Arrangement means:
      </p>
      <ul
        className="space-y-1.5 pl-5"
        style={{
          listStyle: 'disc',
          color: 'var(--text-secondary)',
        }}
      >
        <li>
          The seller will be paid <strong style={{ color: 'var(--text-primary)' }}>immediately</strong> once
          your payment is confirmed — funds are not held.
        </li>
        <li>
          You will <strong style={{ color: 'var(--text-primary)' }}>not</strong> be able to
          refund or dispute this transaction.
        </li>
        <li>
          We will share both parties&apos; name, phone, and email so you
          can coordinate the SAPS dealer meet between yourselves.
        </li>
        <li>
          If you want full payment protection, cancel and pick{' '}
          <strong style={{ color: 'var(--text-primary)' }}>Dealer Transfer</strong> instead.
        </li>
      </ul>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={box1}
          onChange={(e) => setBox1(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--red)' }}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I understand that the seller is paid immediately, so All
          Outdoor is not holding the payment and cannot reverse it if
          something goes wrong at the hand-over.
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={box2}
          onChange={(e) => setBox2(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--red)' }}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I agree to my name, phone, and email being shared with the
          seller so we can complete the legal transfer at a SAPS dealer.
        </span>
      </label>

      <div>
        <label
          className="block text-xs mb-1.5"
          style={{ color: 'var(--text-secondary)' }}
        >
          Type <strong style={{ color: 'var(--text-primary)' }}>I UNDERSTAND</strong> to confirm:
        </label>
        <input
          type="text"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="I UNDERSTAND"
          style={{
            ...inputStyle,
            border: phraseOk
              ? '0.5px solid #00a03c'
              : '0.5px solid var(--border)',
          }}
        />
      </div>

      <p
        className="text-xs"
        style={{
          color: allOk ? '#00a03c' : 'var(--text-tertiary)',
        }}
      >
        {allOk
          ? '✓ Consent recorded. You can proceed to payment below.'
          : 'Tick both boxes and type the phrase to enable payment.'}
      </p>
    </div>
  );
}

// AUDIT M33 — single-checkbox firearm attestation. The backend HARD-
// refuses any firearm transaction without `firearmAttestation18Plus:
// true`, so this is both a regulatory consent and a server-enforced
// gate. The wording captures the two things SA firearms law cares
// about at the point of sale: minimum age and (where applicable)
// competency for the calibre/type being bought.
export function FirearmAttestation({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="rounded-[6px] p-4 text-sm space-y-3"
      style={{
        background: 'rgba(200,16,46,0.06)',
        border: '0.5px solid var(--red)',
        color: 'var(--text-primary)',
        lineHeight: 1.55,
      }}
    >
      <p
        className="text-xs uppercase"
        style={{
          color: 'var(--red)',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        Firearm purchase — required confirmation
      </p>

      <p style={{ color: 'var(--text-secondary)' }}>
        South African firearms law requires every buyer to be at least
        18 and to hold the relevant SAPS competency for the firearm
        being bought (where competency applies). You will be unable to
        collect the firearm at the dealer without the correct paperwork
        and competency on the day.
      </p>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--red)' }}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I confirm I am over 18 and I am legally entitled to own /
          collect this firearm under South African law, including
          holding any required SAPS competency for the calibre and
          type. I understand that submitting this confirmation
          dishonestly may be a criminal offence.
        </span>
      </label>

      <p
        className="text-xs"
        style={{
          color: accepted ? '#00a03c' : 'var(--text-tertiary)',
        }}
      >
        {accepted
          ? '✓ Confirmation recorded. You can proceed to payment below.'
          : 'Tick the box to enable payment.'}
      </p>
    </div>
  );
}
