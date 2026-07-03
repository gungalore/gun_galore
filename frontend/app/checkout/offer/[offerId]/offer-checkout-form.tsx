'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils';
import { ManualEftInstructions } from '@/components/manual-eft-instructions';
import { PaygateComingSoon } from '@/components/paygate-coming-soon';
import { FeeBreakdown, ShippingMethod } from '@/lib/types';
import { LockerPicker, PudoLocker } from '@/components/locker-picker';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Carries the txId across the Stitch hosted-checkout redirect round-trip
// (Stitch returns the buyer to the registered base URL without our id).
// Read back by /checkout/complete. Kept in sync with the listing
// checkout form + the complete page.
const PENDING_TX_KEY = 'gg:pendingTx';

interface CreateTxResponse {
  transactionId: string;
  // Stitch payment id; `mock-` prefix in dev (gateway unconfigured).
  paymentId?: string;
  // Hosted Stitch checkout URL to redirect to. Empty in mock mode.
  redirectUrl?: string;
  provider?: string;
  breakdown: FeeBreakdown;
  // Manual EFT mode — bank-deposit instructions + order reference.
  manual?: boolean;
  orderReference?: string;
  amountCents?: number;
  payByAt?: string;
  bankDetails?: {
    accountName: string;
    bank: string;
    accountNumber: string;
    branchCode: string;
    accountType?: string;
  };
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
}: {
  offerId: string;
  listingId: string;
  settledAmount: number;
  isFirearm: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();

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
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CreateTxResponse | null>(null);

  const allowedMethods: ShippingMethod[] = isFirearm ? ['DEALER_TRANSFER'] : ['PUDO', 'TCG'];

  function buildPayload() {
    // M33 — firearm offers must carry the attestation flag.
    const attestation = isFirearm
      ? { firearmAttestation18Plus: firearmAttestation }
      : {};
    const base = { listingId, offerId, shippingMethod: method, ...attestation };
    if (method === 'PUDO') return { ...base, pudoPickupLockerId: selectedLocker?.lockerId };
    if (method === 'TCG') return { ...base, deliveryAddress: tcgAddress };
    // No dealerId — see /checkout/[listingId]/checkout-form.tsx for
    // the full rationale. Buyer picks any SAPS-licensed dealer
    // themselves and verifies via the 3-photo upload after delivery.
    if (method === 'DEALER_TRANSFER') return base;
    return base;
  }

  function isReady() {
    // M33 — firearm offers gated on the attestation checkbox.
    if (isFirearm && !firearmAttestation) return false;
    if (method === 'PUDO') return !!selectedLocker;
    if (method === 'TCG') {
      return !!(
        tcgAddress.streetAddress &&
        tcgAddress.suburb &&
        tcgAddress.city &&
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
        throw new Error(msg);
      }
      const data: CreateTxResponse = await res.json();

      // Manual EFT mode → bank-deposit instructions + order reference.
      if (data.manual && data.orderReference && data.bankDetails && data.payByAt) {
        setCheckout(data);
        return;
      }

      // Mock mode (gateway unconfigured) → show the test card.
      if (!data.redirectUrl || data.paymentId?.startsWith('mock-')) {
        setCheckout(data);
        return;
      }

      // Live: stash the txId for the return page, then hand off to
      // Stitch's hosted checkout. Keep `submitting` true — navigating away.
      try {
        localStorage.setItem(PENDING_TX_KEY, data.transactionId);
      } catch {
        // Storage disabled — the (deferred) webhook still settles it.
      }
      window.location.href = data.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  // Manual EFT mode — bank-deposit instructions + order reference.
  if (checkout?.manual && checkout.orderReference && checkout.bankDetails && checkout.payByAt) {
    return (
      <ManualEftInstructions
        data={{
          transactionId: checkout.transactionId,
          orderReference: checkout.orderReference,
          amountCents: checkout.amountCents ?? checkout.breakdown.buyerTotal,
          payByAt: checkout.payByAt,
          bankDetails: checkout.bankDetails,
        }}
      />
    );
  }

  // Mock mode only — live checkout redirects away to Stitch above.
  if (checkout) {
    return (
      <div>
        <h2 className="text-base font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
          Complete payment
        </h2>
        <div
          className="rounded-[6px] p-4 mb-6 text-sm"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <div className="flex justify-between py-1">
            <span style={{ color: 'var(--text-secondary)' }}>Agreed price</span>
            <span style={{ color: 'var(--text-primary)' }}>{formatPrice(checkout.breakdown.listingPrice)}</span>
          </div>
          <div
            className="my-2"
            style={{ borderTop: '0.5px solid var(--border)' }}
          />
          <div className="flex justify-between py-1 font-medium">
            <span style={{ color: 'var(--text-primary)' }}>Total charged</span>
            <span style={{ color: 'var(--red)' }}>{formatPrice(checkout.breakdown.buyerTotal)}</span>
          </div>
        </div>
        <div
          className="rounded-[8px] p-6 text-center text-sm"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <p className="mb-2 font-medium" style={{ color: 'var(--text-primary)' }}>Test mode</p>
          <p>The payment gateway is not configured.</p>
          <button
            onClick={() => router.push(`/transactions/${checkout.transactionId}`)}
            className="mt-4 px-4 py-2 rounded-[6px] text-sm"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            View order (mock)
          </button>
        </div>
      </div>
    );
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
          <div className="grid grid-cols-1 gap-3">
            {(
              [
                ['streetAddress', 'Street address'],
                ['suburb', 'Suburb'],
                ['city', 'City'],
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

      {/* P6.4 — flat R15 handling per courier waybill. Shipping + handling are
          quoted at payment; the server response carries the exact total. */}
      {(method === 'PUDO' || method === 'TCG') && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          Shipping is quoted at payment, plus a R15 handling fee for the courier
          parcel.
        </p>
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

      <PaygateComingSoon />

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
        {submitting ? 'Setting up payment…' : `Pay ${formatPrice(settledAmount)}`}
      </button>
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
              held by Gun Galore
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
            on Gun Galore — the completed SAPS 534, the dealer&apos;s
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
            Gun Galore&apos;s job in the transaction ends there. You
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
          I understand Gun Galore holds my funds until the
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
