'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../../../lib/auth';
import { formatPrice } from '@/lib/utils';
import { platformFeeForCents } from '@/lib/platform-fee';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { usePaymentMethods } from '@/lib/payment-methods';
import { FeeBreakdown, ListingType, ShippingMethod, Address } from '@/lib/types';
import {
  DeliveryOptionsPicker,
  type DeliveryOption,
} from '@/components/delivery-options-picker';
import { SavedAddressPicker } from '@/components/saved-address-picker';
import { DeliveryMethodCards } from '@/components/delivery-method-cards';

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
// Operator 2026-10: an offer on a Buy Now listing uses the marketplace
// Platform Fee (marginal 10/9/8/7 on item + delivery, buyer-paid). An offer
// accepted on an auction uses the flat 5% buyer share. The seller keeps the
// agreed price on a Buy Now listing, or pays 5% of it on an auction.
//
// Presentation only; the amount actually charged is recomputed server-side on
// POST /transactions.
//
// ⚠️ THE MATHS LIVES IN lib/platform-fee.ts. This file carried its own copy of
// the bands, the R10 floor and the auction 5%; `scripts/fee-sync.cjs` now fails
// the build if that module and backend/src/payments/fee.calculator.ts disagree.

// FLOW-F5 — the 9 SA provinces, values matching the Prisma Province enum.
// The backend DeliveryAddressDto requires `province` (@IsNotEmpty), so an
// offer checkout with no province ALWAYS 400'd. Bob Go quotes off the full
// address, so the select alone unblocks it.
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
  listingType,
  dealerName,
  dealerLocation,
}: {
  offerId: string;
  listingId: string;
  settledAmount: number;
  isFirearm: boolean;
  listingType: ListingType;
  dealerName?: string | null;
  dealerLocation?: string | null;
}) {
  const { getToken } = useAuth();
  const {
    methods: paymentMethods,
    provider: paymentProvider,
    setProvider: setPaymentProvider,
  } = usePaymentMethods();

  // Every listing class offers the courier/dealer rail plus an in-person
  // handover. The offer checkout is a purchase like any other, so the buyer
  // gets the same choice here as on the single-item checkout.
  const [method, setMethod] = useState<ShippingMethod>(
    isFirearm ? 'DEALER_TRANSFER' : 'COURIER',
  );
  const allowedMethods: ShippingMethod[] = isFirearm
    ? ['DEALER_TRANSFER', 'PRIVATE_ARRANGE']
    : ['COURIER', 'PRIVATE_ARRANGE'];
  // The door rate priced for this parcel + address.
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState({
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
  // Phase-1 payment gate — card payments aren't live yet, so a checkout POST
  // returns 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);

  // Bob Go door-to-door is the only courier rail. A firearm never rides a
  // courier at all and keeps its own route. An in-person handover skips both.
  const effectiveMethod: ShippingMethod = method;

  // The address the menu is priced against, in the picker's shape.
  const addressComplete =
    !!deliveryAddress.streetAddress.trim() &&
    !!deliveryAddress.suburb.trim() &&
    !!deliveryAddress.city.trim() &&
    !!deliveryAddress.province &&
    deliveryAddress.postalCode.trim().length >= 4;
  const pickerAddress = addressComplete
    ? {
        streetAddress: deliveryAddress.streetAddress.trim(),
        suburb: deliveryAddress.suburb.trim(),
        city: deliveryAddress.city.trim(),
        postalCode: deliveryAddress.postalCode.trim(),
        province: deliveryAddress.province,
      }
    : null;

  // A price quoted against the old address must never survive an edit.
  useEffect(() => {
    setDeliveryOption(null);
  }, [
    deliveryAddress.streetAddress,
    deliveryAddress.suburb,
    deliveryAddress.city,
    deliveryAddress.province,
    deliveryAddress.postalCode,
  ]);

  // Courier routes carry a shipping leg the server only prices at payment
  // time, and the Platform Fee is charged last on (item + delivery) — so on
  // those neither the fee nor the final total can be stated honestly here.
  // A dealer transfer has no courier leg and no waybill, so its total is
  // knowable in full: agreed price + Platform Fee, nothing else.
  const isCourier = effectiveMethod === 'COURIER';
  const feeOnAgreedPrice = platformFeeForCents(
    settledAmount,
    listingType === 'AUCTION',
  );
  const knownTotal = isCourier ? null : settledAmount + feeOnAgreedPrice;

  function buildPayload() {
    const base = {
      listingId,
      offerId,
      shippingMethod: effectiveMethod,
      // Locks the refund + payout to the rail that received the money.
      paymentProvider,
    };
    if (isCourier) {
      // The address rides on the courier line. The server re-quotes this leg
      // at Pay, so the address the rate was priced against must go with it.
      return {
        ...base,
        deliveryAddress: deliveryAddress,
        deliveryOption: deliveryOption?.kind,
        ...(deliveryOption?.kind === 'STORE_PICKUP'
          ? { pickupPointLocationId: deliveryOption.pickupPointLocationId }
          : {}),
      };
    }
    // No dealerId — see /checkout/[listingId]/checkout-form.tsx for
    // the full rationale. Buyer picks any SAPS-licensed dealer
    // themselves and verifies via the 3-photo upload after delivery.
    if (method === 'PRIVATE_ARRANGE') {
      // In-person handover terms are accepted with the Terms at sign-up.
      return { ...base, privateArrangeConsent: true };
    }
    if (method === 'DEALER_TRANSFER') return base;
    return base;
  }

  function isReady() {
    if (method === 'COURIER') {
      // Not "an address exists" - a CHOSEN, PRICED option. Otherwise the
      // buyer can reach Pay without us knowing what delivery costs.
      return !!(
        addressComplete &&
        deliveryAddress.contactName &&
        deliveryAddress.contactPhone &&
        deliveryOption
      );
    }
    if (method === 'DEALER_TRANSFER') return true;
    if (method === 'PRIVATE_ARRANGE') return true;
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
        if (/launching soon/i.test(msg)) {
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
          style={{ background: 'rgba(227,6,19,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      <DeliveryMethodCards
        methods={allowedMethods}
        selected={method}
        onSelect={setMethod}
        isFirearm={isFirearm}
        dealerName={dealerName}
        dealerLocation={dealerLocation}
      />

      {method === 'COURIER' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Delivery address</p>
          {/* UX-3 — saved-address picker (2+ book addresses only). Fills the
              address fields; contact name/phone stay for the buyer. */}
          <SavedAddressPicker
            minToShow={1}
            onSelect={(a: Address) =>
              setDeliveryAddress((prev) => ({
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
              ] as [keyof typeof deliveryAddress, string][]
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="text"
                  required
                  value={deliveryAddress[key]}
                  onChange={(e) => setDeliveryAddress((a) => ({ ...a, [key]: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
            ))}
            {/* FLOW-F5 — province is required by the backend DTO; it was
                missing entirely, so every courier offer 400'd. */}
            <Field label="Province">
              <select
                value={deliveryAddress.province}
                onChange={(e) => setDeliveryAddress((a) => ({ ...a, province: e.target.value }))}
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
              ] as [keyof typeof deliveryAddress, string][]
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="text"
                  required
                  value={deliveryAddress[key]}
                  onChange={(e) => setDeliveryAddress((a) => ({ ...a, [key]: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
            ))}
          </div>

          {/* Door rate for this parcel + address. The buyer is never asked to
              choose a carrier, and the same component serves the Buy Now
              checkout, so the two cannot drift. */}
          <div className="pt-1">
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
              Shipping
            </p>
            <DeliveryOptionsPicker
              listingId={listingId}
              deliveryAddress={pickerAddress}
              onSelect={setDeliveryOption}
              getToken={getToken}
            />
          </div>
        </div>
      )}

      {/* What the buyer actually pays. The agreed price is the price — an
          offer discovers it, so nothing is marked up on top of it — and the
          buyer-paid Platform Fee is calculated last on item + delivery.
          Delivery is the courier's live rate (no handling margin), never
          itemised as a row of its own. Shipping (and therefore
          the exact fee) is only priced server-side at payment, so those rows
          say so rather than show a number we'd have to guess at. */}
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
            <SummaryLine
              label="Delivery"
              value={
                deliveryOption
                  ? formatPrice(deliveryOption.priceCents)
                  : 'Enter your delivery address above'
              }
              muted={!deliveryOption}
            />
            <SummaryLine
              label="Platform Fee"
              value="Calculated at payment"
              muted
            />
          </>
        ) : (
          <SummaryLine
            label="Platform Fee"
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
      <PaymentMethodSection
        methods={paymentMethods}
        value={paymentProvider}
        onChange={setPaymentProvider}
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

