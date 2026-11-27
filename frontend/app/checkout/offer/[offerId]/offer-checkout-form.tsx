'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../../lib/auth';
import { formatPrice } from '@/lib/utils';
import { platformFeeForCents } from '@/lib/platform-fee';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { usePaymentMethods } from '@/lib/payment-methods';
import { FeeBreakdown, ListingType, ShippingMethod, Address } from '@/lib/types';
import { DeliveryOptionsPicker, type DeliveryOption } from '@/components/delivery-options-picker';
import { DeliveryAddressSummary } from '@/components/delivery-address-summary';
import { DeliveryAddressDialog } from '@/components/delivery-address-dialog';
import { DeliveryMethodCards } from '@/components/delivery-method-cards';
import { getSavedDeliveryChoice } from '@/lib/delivery-choice';
import type { ManualAddressValue } from '@/components/manual-address-fields';

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

// Only the pieces this form needs from GET /users/me: the profile's default
// delivery address and the contact identity used to prefill the address.
// Typed locally (not imported from the marketplace checkout) so the two forms
// stay independent.
interface ProfileMe {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  addrBuilding?: string | null;
  addrStreet?: string | null;
  addrAddress2?: string | null;
  addrSuburb?: string | null;
  addrCity?: string | null;
  addrPostalCode?: string | null;
  addrProvince?: string | null;
  addrLat?: number | null;
  addrLng?: number | null;
}

// ─── What the buyer pays on an accepted offer ────────────────────────────
// Operator 2026-10: an offer on a Marketplace listing uses the marketplace
// Platform Fee (marginal 10/9/8/7 on item + delivery, buyer-paid). An offer
// accepted on an auction uses the flat 5% buyer share. The seller keeps the
// agreed price on a Marketplace listing, or pays 5% of it on an auction.
//
// Presentation only; the amount actually charged is recomputed server-side on
// POST /transactions.
//
// ⚠️ THE MATHS LIVES IN lib/platform-fee.ts. This file carried its own copy of
// the bands, the R10 floor and the auction 5%; `scripts/fee-sync.cjs` now fails
// the build if that module and backend/src/payments/fee.calculator.ts disagree.

// FLOW-F5 — the backend DeliveryAddressDto requires `province`
// (@IsNotEmpty), so an offer checkout with no province ALWAYS 400'd. The
// address drawer supplies the province now; this form keeps the full address
// object it is handed.

export function OfferCheckoutForm({
  offerId,
  listingId,
  settledAmount,
  isFirearm,
  listingType,
  dealerName,
  dealerLocation,
  actionToken = null,
}: {
  offerId: string;
  listingId: string;
  settledAmount: number;
  isFirearm: boolean;
  listingType: ListingType;
  dealerName?: string | null;
  dealerLocation?: string | null;
  /**
   * The CHECKOUT action token from `?t=`, for a buyer who is NOT signed in.
   * Same contract as /checkout/[listingId]/checkout-form.tsx: appending it to
   * an API call is the credential, and a Bearer header is then not sent. The
   * server's AuthOrTokenGuard accepts `?t=` on GET/PATCH /users/me and
   * POST /transactions — the three calls this form makes that need identity.
   */
  actionToken?: string | null;
}) {
  const { getToken } = useAuth();

  /**
   * Build the URL + headers for an identity-requiring API call.
   *
   * ⚠️ MIRRORS authedRequest IN /checkout/[listingId]/checkout-form.tsx, and it
   * is deliberately a copy rather than a shared hook: the two checkout forms
   * have diverged too far to merge (see also SummaryLine below), and a shared
   * helper changing shape would silently move the other form's credentials.
   * Keep the two behaviours the same: token => `?t=`; session => Bearer.
   */
  async function authedRequest(
    path: string,
  ): Promise<{ url: string; headers: HeadersInit }> {
    if (actionToken) {
      const sep = path.includes('?') ? '&' : '?';
      return {
        url: `${API_URL}${path}${sep}t=${encodeURIComponent(actionToken)}`,
        headers: { 'Content-Type': 'application/json' },
      };
    }
    const token = await getToken();
    return {
      url: `${API_URL}${path}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    };
  }

  const {
    methods: paymentMethods,
    provider: paymentProvider,
    setProvider: setPaymentProvider,
    loading: paymentLoading,
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
  /**
   * ⚠️ THE PDP PICK WINS ON FIRST LOAD. The listing's two-option toggle is where
   * most buyers choose the route; re-validated against the legal pair so a stale
   * session pick cannot select a rail this listing does not offer.
   */
  useEffect(() => {
    const saved = getSavedDeliveryChoice(listingId);
    if (
      saved &&
      (allowedMethods as string[]).includes(saved) &&
      saved !== method
    ) {
      setMethod(saved as ShippingMethod);
    }
    // First load only; the buyer's later clicks are authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);
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
  // The address-book row the effective address came from (the drawer opens
  // with it selected, and we can tell when it was edited or deleted).
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [addressBookLoaded, setAddressBookLoaded] = useState(false);
  // Set once the buyer picks/keeps an address themselves; a late async read
  // must never clobber that choice.
  const addressChosenRef = useRef(false);
  // Profile default address + identity (GET /users/me). This is the PRE-FETCH
  // fallback for the address (the book is the source of truth) and the source
  // of the contact prefill.
  const [profile, setProfile] = useState<ProfileMe | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // The address DRAWER opens from the one summary row.
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  // Focus returns here on close (Safari does not focus a button on click).
  const addressTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Read the address book once and seed the effective address from its default
  // row (the backend prepends the synthetic `profile` row, default while no
  // book row is default). ⚠️ TOKEN BUYERS GET A 401 HERE, AND THAT IS FINE:
  // the book is session-managed, and the /users/me fallback below still
  // supplies their profile address. A failure is non-fatal by design.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url, headers } = await authedRequest('/users/me/addresses');
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as Address[];
        if (cancelled || !Array.isArray(rows) || addressChosenRef.current) return;
        const preferred =
          rows.find((a) => a.isDefault) ??
          rows.find((a) => a.id === 'profile') ??
          rows[0];
        if (preferred) {
          setDeliveryAddress((prev) => ({
            ...prev,
            streetAddress: preferred.street,
            suburb: preferred.suburb ?? '',
            city: preferred.city,
            province: preferred.province,
            postalCode: preferred.postalCode,
          }));
          setSelectedAddressId(preferred.id);
        }
      } catch {
        // Non-fatal — the /users/me fallback below seeds the profile address.
      } finally {
        if (!cancelled) setAddressBookLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, actionToken]);

  // Profile default address — the resting address this checkout uses unless
  // the buyer changes it. Fetched separately from the address book because it
  // is the profile's own default, not an address-book row. Non-fatal: if the
  // read fails the editor still starts empty and checkout works as before.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // GET /users/me is AuthOrTokenGuard-backed, so this is the signed-out
        // token buyer's identity read: it is what supplies the default delivery
        // address and contact prefill, and it must carry `?t=` rather than a
        // Bearer header when there is no session.
        const { url, headers } = await authedRequest('/users/me');
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProfileMe;
        if (cancelled) return;
        setProfile(data);
        // Prefill only an untouched form — a field the buyer already typed, or
        // an address-book pick, must never be overwritten by this late read.
        setDeliveryAddress((prev) => {
          const hasAddress =
            prev.streetAddress.trim() ||
            prev.suburb.trim() ||
            prev.city.trim() ||
            prev.province ||
            prev.postalCode.trim();
          if (hasAddress) return prev;
          const contactName = [data.firstName, data.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          return {
            ...prev,
            streetAddress: data.addrStreet ?? '',
            suburb: data.addrSuburb ?? '',
            city: data.addrCity ?? '',
            province: data.addrProvince ?? '',
            postalCode: data.addrPostalCode ?? '',
            contactName: prev.contactName || contactName,
            contactPhone: prev.contactPhone || (data.phone ?? ''),
          };
        });
      } catch {
        // Non-fatal — the buyer can still type a delivery address by hand.
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, actionToken]);

  // Apply a saved address (or a typed one from the drawer) to this order. The
  // identity fields (name / phone) are this form's own and are never taken
  // from the address book row.
  function applyAddressToOrder(a: {
    street: string;
    suburb?: string | null;
    city: string;
    province: string;
    postalCode: string;
  }) {
    setDeliveryAddress((prev) => ({
      ...prev,
      streetAddress: a.street,
      suburb: a.suburb ?? '',
      city: a.city,
      province: a.province,
      postalCode: a.postalCode,
    }));
  }

  /** Apply a full address-book row; remembers which row is in effect. */
  function applySavedAddress(a: Address) {
    addressChosenRef.current = true;
    applyAddressToOrder(a);
    setSelectedAddressId(a.id);
  }

  /** The drawer's secondary action: typed address for this order only. */
  function applyTypedAddressToOrder(v: ManualAddressValue) {
    addressChosenRef.current = true;
    applyAddressToOrder({
      street: v.street,
      suburb: v.suburb,
      city: v.city,
      province: v.province || '',
      postalCode: v.postalCode,
    });
    setSelectedAddressId(null);
  }

  /**
   * The drawer saved/edited/deleted a book row. Keep the effective address in
   * step: an edit refreshes it, deleting it falls back default → next → none.
   */
  function handleAddressesChanged(rows: Address[]) {
    if (!selectedAddressId) return;
    const current = rows.find((a) => a.id === selectedAddressId);
    const next = current ?? rows.find((a) => a.isDefault) ?? rows[0] ?? null;
    if (next) {
      addressChosenRef.current = true;
      applyAddressToOrder(next);
      setSelectedAddressId(next.id);
    } else {
      addressChosenRef.current = true;
      setSelectedAddressId(null);
      setDeliveryOption(null);
      setDeliveryAddress((prev) => ({
        ...prev,
        streetAddress: '',
        suburb: '',
        city: '',
        province: '',
        postalCode: '',
      }));
    }
  }

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase-1 payment gate — card payments aren't live yet, so a checkout POST
  // returns 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);
  // The buyer's own interrupted gateway attempt for this offer. The server
  // returns 409 UNPAID_CHECKOUT_EXISTS (with the transaction id) instead of a
  // second payable session; without this the buyer sees only a red error and
  // has no way back to the payment they already started. Mirrors
  // /checkout/[listingId]/checkout-form.tsx.
  const [unpaidAttempt, setUnpaidAttempt] = useState<string | null>(null);

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

  // One-line summary for the collapsed address row. A half-filled address is
  // still shown, flagged `incomplete`, so the amber warning is reachable
  // before Pay; the drawer is how it gets fixed.
  const hasDeliveryAddress = Boolean(
    deliveryAddress.streetAddress.trim() || deliveryAddress.city.trim(),
  );
  const summaryAddress = [
    deliveryAddress.streetAddress,
    deliveryAddress.suburb,
    deliveryAddress.city,
    deliveryAddress.postalCode,
  ]
    .filter((v) => v.trim())
    .join(', ');
  const summaryIncomplete =
    addressComplete === false &&
    (deliveryAddress.streetAddress.trim().length > 0 ||
      deliveryAddress.suburb.trim().length > 0 ||
      deliveryAddress.city.trim().length > 0);

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
      // Locks the refund + payout to the rail that received the money. Only
      // sent when the server actually returned one.
      ...(paymentProvider ? { paymentProvider } : {}),
    };
    if (isCourier) {
      // The address rides on the courier line. The server re-quotes this leg
      // at Pay, so the address the rate was priced against must go with it.
      // Saved-address writes happen in the drawer; checkout does not re-save.
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
    // No enabled rail (Peach-only launch state, or the read failed) means Pay
    // stays disabled — never a fabricated default rail.
    if (paymentLoading || paymentProvider == null || paymentMethods.length === 0) {
      return false;
    }
    if (method === 'COURIER') {
      // Not "an address exists" - a CHOSEN, PRICED option. Otherwise the
      // buyer can reach Pay without us knowing what delivery costs.
      return !!(addressComplete &&
        deliveryOption);
    }
    if (method === 'DEALER_TRANSFER') return true;
    if (method === 'PRIVATE_ARRANGE') return true;
    return false;
  }

  async function handleProceed() {
    if (!isReady()) return;
    setSubmitting(true);
    setError(null);
    setUnpaidAttempt(null);
    try {
      // ⚠️ POST /transactions IS AuthOrTokenGuard-BACKED, which is what makes
      // Pay work for a signed-out CHECKOUT-token buyer: the token rides in the
      // query string, never in a Bearer header the browser does not have.
      const { url, headers } = await authedRequest('/transactions');
      const res = await fetch(url, {
        method: 'POST',
        headers,
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
        // The server refuses a second payable session while an unfinished one
        // exists. Surface the resume panel instead of a wall of error text —
        // the exact failure mode a buyer hit by backing out of the card page.
        const conflict = err as {
          code?: string;
          transactionId?: string;
        };
        if (
          conflict.code === 'UNPAID_CHECKOUT_EXISTS' &&
          typeof conflict.transactionId === 'string'
        ) {
          setUnpaidAttempt(conflict.transactionId);
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
          style={{ background: 'var(--red-wash)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Interrupted payment recovery. Same 409 the Buy Now checkout returns:
          this offer already has an unpaid gateway attempt, and paying again
          would either double-charge or be refused. Resume goes to the existing
          attempt rather than starting a second one.
          ⚠️ NO "Start again" here, unlike the Buy Now form: abandoning the
          attempt is POST /transactions/:id/abandon, which is AuthGuard-only,
          so a signed-out token buyer cannot call it. Resume is the only
          truthful action available to both credentials. */}
      {unpaidAttempt && (
        <div
          className="rounded-[8px] p-4"
          style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--action-option-edge)',
          }}
        >
          <p
            className="text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 600 }}
          >
            You have an unfinished payment for this offer
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            It wasn&apos;t completed. Resume it to avoid paying twice — the
            existing payment window still applies.
          </p>
          <a
            href={`/checkout/resume/${unpaidAttempt}`}
            className="inline-block mt-3 px-4 py-2 rounded-[6px] text-sm font-medium"
            style={{
              background: 'var(--action-primary-bg)',
              color: '#fff',
              textDecoration: 'none',
            }}
          >
            Resume payment
          </a>
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
          {(actionToken ? !profileLoaded : !addressBookLoaded) &&
          !hasDeliveryAddress ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Loading your address…
            </p>
          ) : (
            <DeliveryAddressSummary
              label={
                hasDeliveryAddress ? 'Delivery to' : 'Select Delivery Address'
              }
              address={hasDeliveryAddress ? summaryAddress : ''}
              incomplete={hasDeliveryAddress && summaryIncomplete}
              changeLabel={hasDeliveryAddress ? 'Change' : 'Select'}
              buttonRef={addressTriggerRef}
              onChange={() => setAddressDialogOpen(true)}
            />
          )}

          {/* Door rate for this parcel + address, presented as the same
              delivery-date cards the single-item checkout uses. The buyer is
              never asked to choose a carrier, and the same component serves
              both checkouts, so the two cannot drift. */}
          <div className="pt-1">
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
              Delivery date &amp; time
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

      {/* The address DRAWER. A pick/edit/delete here writes the same
          `deliveryAddress` state above, so the quote is invalidated and
          re-priced by the existing effect. */}
      {method === 'COURIER' && addressDialogOpen && (
        <DeliveryAddressDialog
          returnFocusTo={addressTriggerRef.current}
          initialAddress={{
            building: '',
            street: deliveryAddress.streetAddress,
            address2: '',
            suburb: deliveryAddress.suburb,
            city: deliveryAddress.city,
            postalCode: deliveryAddress.postalCode,
            province: deliveryAddress.province as ManualAddressValue['province'],
          }}
          selectedAddressId={selectedAddressId}
          recipient={{
            name:
              [profile?.firstName, profile?.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || null,
            phone: profile?.phone ?? null,
          }}
          // This form has never priced off coordinates — the quote and payload
          // use the five address fields only, so coords are optional here.
          requireCoords={false}
          canSaveToBook={!actionToken}
          getToken={getToken}
          onClose={() => setAddressDialogOpen(false)}
          onSelect={applySavedAddress}
          onUseOnce={applyTypedAddressToOrder}
          onAddressesChanged={handleAddressesChanged}
        />
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

      {/* UX-8 — payment-method section shell. The server decides the enabled
          rails; with none (or a failed read) Pay stays disabled and we say so. */}
      <PaymentMethodSection
        methods={paymentMethods}
        value={paymentProvider}
        onChange={setPaymentProvider}
      />
      {!paymentLoading &&
        (paymentProvider == null || paymentMethods.length === 0) && (
          <p
            className="text-xs"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
          >
            Card payments are temporarily unavailable — please try again
            shortly.
          </p>
        )}

      <button
        type="button"
        onClick={handleProceed}
        disabled={submitting || !isReady()}
        className="w-full py-3 rounded-[6px] text-sm"
        style={{
          background: submitting || !isReady() ? 'var(--bg-inset)' : 'var(--action-primary-bg)',
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

