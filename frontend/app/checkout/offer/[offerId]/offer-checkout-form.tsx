'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { BuyerTermsAck } from '@/components/buyer-terms-ack';
import { formatPrice } from '@/lib/utils';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { FeeBreakdown, ShippingMethod, Address } from '@/lib/types';
import { LockerPicker, PudoLocker } from '@/components/locker-picker';
import { SavedAddressPicker } from '@/components/saved-address-picker';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Carries the txId across the Stitch hosted-checkout redirect round-trip
// (Stitch returns the buyer to the registered base URL without our id).
// Read back by /checkout/complete. Kept in sync with the listing
// checkout form + the complete page.
const PENDING_TX_KEY = 'gg:pendingTx';

interface CreateTxResponse {
  transactionId: string;
  // Paygate payment id; `mock-` prefix in dev (gateway unconfigured).
  paymentId?: string;
  // Hosted paygate checkout URL to redirect to.
  redirectUrl?: string;
  provider?: string;
  breakdown: FeeBreakdown;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
};

// ─── What the buyer pays on an accepted offer ────────────────────────────
// An offer DISCOVERS the price the same way a bid does, so there is nothing
// to mark up: the seller still pays the platform commission out of the agreed
// price, and the BUYER carries the gateway cost — shown as its own
// "Transaction fee" row (operator wording 2026-08-15; never "processing fee"
// or "service fee"). This is not conditional on the listing's legacy
// passFeeToBuyer flag: the server forces it on for every offer-backed
// transaction.
//
// Contrast with a straight Buy Now, where the seller names what they want to
// RECEIVE and the listed price already carries our commission plus the gateway
// fee — nothing is added there, so that checkout shows no fee row at all.
//
// Formulas mirror the backend FeeCalculator exactly:
//   paygate — (base × 3.5% + R1.50) × 1.15 VAT, i.e. the VAT-inclusive figure
//             billed against the card
//   manual  — flat 1.5% EFT handling, no fixed component
// Presentation only; the amount actually charged is recomputed server-side on
// POST /transactions.
const PEACH_RATE = 0.035;
const PEACH_FIXED_CENTS = 150; // R1.50
const VAT_MULTIPLIER = 1.15;
const MANUAL_RATE = 0.015;
const PAYMENT_MODE =
  process.env.NEXT_PUBLIC_PAYMENT_MODE === 'paygate' ? 'paygate' : 'manual';
function transactionFee(baseZarCents: number): number {
  return PAYMENT_MODE === 'manual'
    ? Math.round(baseZarCents * MANUAL_RATE)
    : Math.round(
        baseZarCents * PEACH_RATE * VAT_MULTIPLIER +
          PEACH_FIXED_CENTS * VAT_MULTIPLIER,
      );
}

// FLOW-F5 — the 9 SA provinces, values matching the Prisma Province enum.
// The backend DeliveryAddressDto requires `province` (@IsNotEmpty) and the
// TCG rate engine keys on PROVINCE_LONG[province], so a TCG offer checkout
// with no province ALWAYS 400'd. TCG uses province-zone flat rates (no
// lat/lng needed — same as the cart), so the select alone unblocks it.
const SA_PROVINCES: { value: string; label: string }[] = [
  { value: 'EASTERN_CAPE', label: 'Eastern Cape' },
  { value: 'FREE_STATE', label: 'Free State' },
  { value: 'GAUTENG', label: 'Gauteng' },
  { value: 'KWAZULU_NATAL', label: 'KwaZulu-Natal' },
  { value: 'LIMPOPO', label: 'Limpopo' },
  { value: 'MPUMALANGA', label: 'Mpumalanga' },
  { value: 'NORTH_WEST', label: 'North West' },
  { value: 'NORTHERN_CAPE', label: 'Northern Cape' },
  { value: 'WESTERN_CAPE', label: 'Western Cape' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function OfferCheckoutForm({
  offerId,
  listingId,
  settledAmount,
  isFirearm,
  vicinity,
}: {
  offerId: string;
  listingId: string;
  settledAmount: number;
  isFirearm: boolean;
  /** Town + province (or the planned dealer for a firearm) — the exact string
   *  the server snapshots onto the transaction as evidence of what this buyer
   *  was shown before paying. */
  vicinity: string;
}) {
  const { getToken } = useAuth();

  const [method, setMethod] = useState<ShippingMethod>(isFirearm ? 'DEALER_TRANSFER' : 'PUDO');
  const [selectedLocker, setSelectedLocker] = useState<PudoLocker | null>(null);
  // M33 — 18+/competency attestation. Backend hard-refuses firearm
  // transactions without this flag === true.
  const [firearmAttestation, setFirearmAttestation] = useState(false);
  // Dealer-transfer self-arrange consent — see comment in
  // /checkout/[listingId]/checkout-form.tsx. Same pattern: a single
  // checkbox the buyer ticks to acknowledge they'll choose their
  // own SAPS dealer and upload the verification photos afterwards.
  const [dtConsentAccepted, setDtConsentAccepted] = useState(false);
  useEffect(() => {
    if (method !== 'DEALER_TRANSFER') setDtConsentAccepted(false);
  }, [method]);
  const [tcgAddress, setTcgAddress] = useState({
    streetAddress: '',
    suburb: '',
    city: '',
    province: '',
    postalCode: '',
    contactName: '',
    contactPhone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  // Unconditional pre-payment acknowledgement — same component and same
  // server gate as the single-item checkout. An offer is still a purchase.
  const [buyerTermsAck, setBuyerTermsAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase-1 payment gate — card payments aren't live yet, so a checkout POST
  // returns 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);

  const allowedMethods: ShippingMethod[] = isFirearm ? ['DEALER_TRANSFER'] : ['PUDO', 'TCG'];

  // Courier routes carry a shipping leg the server only prices at payment
  // time, and the transaction fee is charged on (item + shipping) — so on
  // those neither the fee nor the final total can be stated honestly here.
  // A dealer transfer has no courier leg and no waybill, so its total is
  // knowable in full: agreed price + transaction fee, nothing else.
  const isCourier = method === 'PUDO' || method === 'TCG';
  const feeOnAgreedPrice = transactionFee(settledAmount);
  const knownTotal = isCourier ? null : settledAmount + feeOnAgreedPrice;

  function buildPayload() {
    // M33 — firearm offers must carry the attestation flag.
    const attestation = isFirearm
      ? { firearmAttestation18Plus: firearmAttestation }
      : {};
    const base = {
      listingId,
      offerId,
      shippingMethod: method,
      // Unconditional — every branch returns `base`, so no path to Pay omits it.
      buyerTermsAccepted: buyerTermsAck,
      ...attestation,
    };
    if (method === 'PUDO') return { ...base, pudoPickupLockerId: selectedLocker?.lockerId };
    if (method === 'TCG') return { ...base, deliveryAddress: tcgAddress };
    // No dealerId — see /checkout/[listingId]/checkout-form.tsx for
    // the full rationale. Buyer picks any SAPS-licensed dealer
    // themselves and verifies via the 3-photo upload after delivery.
    if (method === 'DEALER_TRANSFER') return base;
    return base;
  }

  function isReady() {
    // Unconditional, and first — see the single-item checkout for why this
    // must sit ahead of every method-specific early return.
    if (!buyerTermsAck) return false;
    // M33 — firearm offers gated on the attestation checkbox.
    if (isFirearm && !firearmAttestation) return false;
    if (method === 'PUDO') return !!selectedLocker;
    if (method === 'TCG') {
      return !!(
        tcgAddress.streetAddress &&
        tcgAddress.suburb &&
        tcgAddress.city &&
        tcgAddress.province && // FLOW-F5 — required by the backend DTO + rate engine
        tcgAddress.postalCode &&
        tcgAddress.contactName &&
        tcgAddress.contactPhone
      );
    }
    if (method === 'DEALER_TRANSFER') return dtConsentAccepted;
    return false;
  }

  async function handleProceed() {
    if (!isReady()) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = Array.isArray(err.message) ? err.message.join(', ') : (err.message ?? `Error ${res.status}`);
        // Phase-1 payment gate: the API returns 503 "card payments are
        // launching soon" until PAYMENTS_LIVE. Show the launching-soon state.
        if (res.status === 503 || /launching soon/i.test(msg)) {
          setComingSoon(true);
          setSubmitting(false);
          return;
        }
        throw new Error(msg);
      }
      const data: CreateTxResponse = await res.json();

      // Live: stash the txId for the return page, then hand off to the
      // paygate's hosted checkout. Keep `submitting` true — navigating away.
      if (data.redirectUrl && !data.paymentId?.startsWith('mock-')) {
        try {
          localStorage.setItem(PENDING_TX_KEY, data.transactionId);
        } catch {
          // Storage disabled — the (deferred) webhook still settles it.
        }
        window.location.href = data.redirectUrl;
        return;
      }

      // No live gateway to hand off to (not configured yet) → card payments
      // aren't live. Show the launching-soon state.
      setComingSoon(true);
      setSubmitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  // Phase-1 payment gate — card payments aren't live yet.
  if (comingSoon) {
    return <PaymentsComingSoon backHref={`/listings/${listingId}`} />;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="px-4 py-3 rounded-[6px] text-sm"
          style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {!isFirearm && (
        <div>
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Delivery method</p>
          <div className="flex gap-2">
            {allowedMethods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className="px-4 py-2 rounded-[6px] text-sm"
                style={{
                  background: method === m ? 'var(--red)' : 'var(--bg-inset)',
                  color: method === m ? '#fff' : 'var(--text-secondary)',
                  border: `0.5px solid ${method === m ? 'var(--red)' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                {m === 'PUDO' ? 'Pudo Locker' : 'Door Delivery (TCG)'}
              </button>
            ))}
          </div>
        </div>
      )}

      {method === 'PUDO' && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Choose your collection locker</p>
          <LockerPicker onSelect={setSelectedLocker} selectedId={selectedLocker?.lockerId} />
        </div>
      )}

      {method === 'TCG' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Delivery address</p>
          {/* UX-3 — saved-address picker (2+ book addresses only). Fills the
              address fields; contact name/phone stay for the buyer. */}
          <SavedAddressPicker
            onSelect={(a: Address) =>
              setTcgAddress((prev) => ({
                ...prev,
                streetAddress: a.street,
                suburb: a.suburb ?? '',
                city: a.city,
                province: a.province,
                postalCode: a.postalCode,
              }))
            }
          />
          <div className="grid grid-cols-1 gap-3">
            {(
              [
                ['streetAddress', 'Street address'],
                ['suburb', 'Suburb'],
                ['city', 'City'],
              ] as [keyof typeof tcgAddress, string][]
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="text"
                  required
                  value={tcgAddress[key]}
                  onChange={(e) => setTcgAddress((a) => ({ ...a, [key]: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
            ))}
            {/* FLOW-F5 — province is required by the backend DTO + TCG rate
                engine; it was missing entirely, so every TCG offer 400'd. */}
            <Field label="Province">
              <select
                value={tcgAddress.province}
                onChange={(e) => setTcgAddress((a) => ({ ...a, province: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Select a province…</option>
                {SA_PROVINCES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            {(
              [
                ['postalCode', 'Postal code'],
                ['contactName', 'Full name'],
                ['contactPhone', 'Phone number'],
              ] as [keyof typeof tcgAddress, string][]
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="text"
                  required
                  value={tcgAddress[key]}
                  onChange={(e) => setTcgAddress((a) => ({ ...a, [key]: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      {method === 'DEALER_TRANSFER' && (
        <DealerTransferConsent
          accepted={dtConsentAccepted}
          onChange={setDtConsentAccepted}
        />
      )}

      {isFirearm && (
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
            South African firearms law requires every buyer to be at
            least 18 and to hold the relevant SAPS competency for the
            firearm being bought (where competency applies). You will
            be unable to collect the firearm at the dealer without the
            correct paperwork and competency on the day.
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={firearmAttestation}
              onChange={(e) => setFirearmAttestation(e.target.checked)}
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
              color: firearmAttestation ? '#00a03c' : 'var(--text-tertiary)',
            }}
          >
            {firearmAttestation
              ? '✓ Confirmation recorded. You can proceed to payment below.'
              : 'Tick the box to enable payment.'}
          </p>
        </div>
      )}

      {/* What the buyer actually pays. The agreed price is the price — an
          offer discovers it, so nothing is marked up on top of it — and the
          gateway cost sits on the buyer as its own "Transaction fee" row.
          P6.4: a courier parcel also carries the flat R15 handling. Shipping
          (and therefore the exact fee, which is charged on item + shipping) is
          only priced server-side at payment, so those rows say so rather than
          show a number we'd have to guess at. */}
      <div
        className="rounded-[8px] p-4"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-xs uppercase mb-3"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 500,
          }}
        >
          What you&apos;ll pay
        </p>
        <SummaryLine label="Agreed price" value={formatPrice(settledAmount)} />
        {isCourier ? (
          <>
            <SummaryLine label="Delivery" value="Quoted at payment" muted />
            <SummaryLine
              label="Transaction fee"
              value="Calculated at payment"
              muted
            />
          </>
        ) : (
          <SummaryLine
            label="Transaction fee"
            value={formatPrice(feeOnAgreedPrice)}
            muted
          />
        )}
        {knownTotal != null ? (
          <div
            className="flex justify-between items-baseline pt-2 mt-2"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            <span
              className="text-sm"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Total
            </span>
            <span
              className="text-base"
              style={{ color: 'var(--red)', fontWeight: 500 }}
            >
              {formatPrice(knownTotal)}
            </span>
          </div>
        ) : (
          <p
            className="text-xs mt-2 pt-2"
            style={{
              color: 'var(--text-tertiary)',
              lineHeight: 1.5,
              borderTop: '0.5px solid var(--border)',
            }}
          >
            We can only price the courier leg once we have your delivery
            details, so your final total is shown on the payment page before
            you pay anything.
          </p>
        )}
      </div>

      {/* UX-8 — payment-method section shell (EFT active today; card seam). */}
      <PaymentMethodSection />

      {/* Same shared component as the single-item checkout — an accepted offer
          is still a purchase, and the server gate does not care how the buyer
          arrived at the price. */}
      <BuyerTermsAck
        variant={isFirearm ? 'firearm' : 'courier'}
        location={vicinity}
        checked={buyerTermsAck}
        onChange={setBuyerTermsAck}
      />

      <button
        type="button"
        onClick={handleProceed}
        disabled={submitting || !isReady()}
        className="w-full py-3 rounded-[6px] text-sm"
        style={{
          background: submitting || !isReady() ? 'var(--bg-inset)' : 'var(--red)',
          color: submitting || !isReady() ? 'var(--text-tertiary)' : '#fff',
          fontWeight: 500,
          cursor: submitting || !isReady() ? 'not-allowed' : 'pointer',
          border: 'none',
        }}
      >
        {/* Only claim a figure we can stand behind. On a courier route the
            shipping leg (and the fee charged on it) isn't priced until the
            server quotes it, so the old `Pay {agreed price}` label named a
            number the buyer was never going to be charged. */}
        {submitting
          ? 'Setting up payment…'
          : knownTotal != null
            ? `Pay ${formatPrice(knownTotal)}`
            : 'Continue to payment'}
      </button>
    </div>
  );
}

// Reusable row inside the "What you'll pay" card. Mirrors BreakdownLine in
// /checkout/[listingId]/checkout-form.tsx — same reason as DealerTransferConsent
// below: the two checkout forms have diverged too far to share a component.
function SummaryLine({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          color: muted ? 'var(--text-secondary)' : 'var(--text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Dealer-transfer self-arrange explainer + soft consent. Mirrors the
// component in /checkout/[listingId]/checkout-form.tsx — we duplicate
// it here rather than extract a shared component because the two
// checkout forms have diverged in enough other ways (offer flow
// doesn't fetch /users/me, doesn't quote shipping live, etc.) that
// a shared abstraction would just couple unrelated code paths.
function DealerTransferConsent({
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
