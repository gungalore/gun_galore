'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Listing,
  FeeBreakdown,
  Me,
  ShippingMethod,
  ShippingQuote,
} from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { ManualEftInstructions } from '@/components/manual-eft-instructions';
import { PaygateComingSoon } from '@/components/paygate-coming-soon';
import { LockerPicker, PudoLocker } from '@/components/locker-picker';
import {
  AddressAutocomplete,
  type ParsedAddressComponents,
} from '@/components/address-autocomplete';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface CreateTxResponse {
  transactionId: string;
  // Stitch payment id. Carries the `mock-` prefix when the gateway
  // isn't configured (dev) → we render the test-mode card instead of
  // redirecting.
  paymentId?: string;
  // Hosted Stitch checkout URL the browser is redirected to. Empty in
  // mock mode.
  redirectUrl?: string;
  provider?: string;
  breakdown: FeeBreakdown;
  // Manual EFT mode (PAYMENT_MODE=manual): instead of a gateway link the
  // backend returns bank-deposit instructions + an order reference.
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

// localStorage key that carries the transaction id across the Stitch
// hosted-checkout redirect round-trip (Stitch returns the buyer to the
// registered base URL without our txId, so /checkout/complete reads it
// back from here). Kept in sync with the offer checkout form + the
// complete page.
const PENDING_TX_KEY = 'gg:pendingTx';

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

function PriceRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: highlight ? 'var(--red)' : 'var(--text-primary)', fontWeight: highlight ? 500 : 400 }}>
        {formatPrice(value)}
      </span>
    </div>
  );
}

export function CheckoutForm({ listing }: { listing: Listing }) {
  const { getToken } = useAuth();
  const router = useRouter();

  // SMS-link checkout: when the URL has ?t=<token>, this checkout
  // page can be reached and acted on WITHOUT a Clerk session. The
  // backend's ClerkOrTokenGuard accepts the token via query param
  // on GET /users/me, PATCH /users/me, and POST /transactions.
  // We just need to append it to URL paths instead of sending a
  // Bearer header.
  const searchParams = useSearchParams();
  const actionToken = searchParams.get('t');

  /**
   * Build headers + URL for any API call that normally requires
   * Clerk auth. When actionToken is present, we send the token via
   * query param; otherwise we fetch a Clerk JWT and send Bearer.
   *
   * Returns the headers + the modified URL (with ?t= appended when
   * applicable). The caller does fetch(url, { headers, ... }) as
   * usual.
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

  // Allowed methods = intersection of (legal for this listing class) and
  // (what the seller offered in the Sell form). Legacy listings with an
  // empty shippingMethods array fall back to the full legal set so old
  // rows don't break.
  const legalForClass: ShippingMethod[] = listing.isFirearm
    ? ['DEALER_TRANSFER', 'PRIVATE_ARRANGE']
    : ['PUDO', 'TCG'];
  const allowedMethods: ShippingMethod[] =
    listing.shippingMethods && listing.shippingMethods.length > 0
      ? legalForClass.filter((m) => listing.shippingMethods.includes(m))
      : legalForClass;

  const [method, setMethod] = useState<ShippingMethod>(
    allowedMethods[0] ?? (listing.isFirearm ? 'DEALER_TRANSFER' : 'PUDO'),
  );
  const [selectedLocker, setSelectedLocker] = useState<PudoLocker | null>(null);
  // Dealer-transfer self-arrange consent — the buyer must tick a box
  // acknowledging they'll organise the SAPS dealer transfer themselves
  // and upload SAPS 534 + stock register + firearm-serial photos after
  // delivery. We removed the dealer dropdown because our dealer DB
  // isn't comprehensive enough yet — let the buyer use any
  // SAPS-licensed dealer of their choice.
  const [dtConsentAccepted, setDtConsentAccepted] = useState(false);
  useEffect(() => {
    if (method !== 'DEALER_TRANSFER') setDtConsentAccepted(false);
  }, [method]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CreateTxResponse | null>(null);

  // Live shipping quote, refreshed whenever the buyer changes method or
  // their destination (PUDO locker / TCG address). Null while we're
  // waiting on the API; { error: string } when the quote endpoint
  // refused (firearm, oversize, etc); { quote: ShippingQuote } when
  // we have a usable price to show in the breakdown.
  const [quoteState, setQuoteState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; quote: ShippingQuote }
  >({ kind: 'idle' });

  // Buyer's saved address (from /users/me). For PUDO, the lat/lng feeds
  // the LockerPicker so it can suggest the nearest 5 lockers. If the
  // buyer has no saved address yet, the "address capture" block below
  // appears in place of the picker — once they save, the picker reveals.
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  // Inline address-capture state — only used when the buyer has no
  // saved address. On save we PATCH /users/me, then re-fetch.
  const [captureAddr, setCaptureAddr] = useState<ManualAddressValue>(
    emptyManualAddress,
  );
  const [captureLat, setCaptureLat] = useState<number | null>(null);
  const [captureLng, setCaptureLng] = useState<number | null>(null);
  const [savingAddr, setSavingAddr] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);

  // PRIVATE_ARRANGE consent — gated state for the hard-consent screen
  // (two checkboxes + literal "I UNDERSTAND" typed). Reset when the
  // buyer changes shipping method, so they can't tick → switch to PUDO
  // → switch back to PRIVATE_ARRANGE without re-consenting.
  const [paConsentAccepted, setPaConsentAccepted] = useState(false);
  useEffect(() => {
    if (method !== 'PRIVATE_ARRANGE') setPaConsentAccepted(false);
  }, [method]);

  // AUDIT M33 — 18+/competency attestation for firearm checkouts. The
  // backend HARD-refuses any firearm transaction without the explicit
  // `true` flag, so this gate is mirrored on Pay/isReady. Non-firearm
  // checkouts ignore this state.
  const [firearmAttestation, setFirearmAttestation] = useState(false);

  // "Ship to a different address" toggle. Off by default — the
  // delivering-to chip / saved-address LockerPicker uses the profile
  // values. When ON, we render the inline address-capture form and
  // the locker/TCG flows read from captureAddr instead of `me`.
  // Reset on shipping-method change so the override doesn't silently
  // leak between methods.
  const [useDifferentAddress, setUseDifferentAddress] = useState(false);
  useEffect(() => {
    setUseDifferentAddress(false);
  }, [method]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url, headers } = await authedRequest('/users/me');
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Me;
        if (cancelled) return;
        setMe(data);
        // Pre-fill the capture form with whatever pieces they have, so
        // the UX is "tweak and save" rather than "type from scratch".
        setCaptureAddr({
          building: data.addrBuilding ?? '',
          street: data.addrStreet ?? '',
          address2: data.addrAddress2 ?? '',
          suburb: data.addrSuburb ?? '',
          city: data.addrCity ?? '',
          postalCode: data.addrPostalCode ?? '',
          province: data.addrProvince ?? '',
        });
        setCaptureLat(data.addrLat ?? null);
        setCaptureLng(data.addrLng ?? null);
      } catch {
        // Non-fatal — the user can still pick a locker via search even
        // if /users/me fails to load.
      } finally {
        if (!cancelled) setMeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // True if the buyer has a coords-bearing address saved on their User.
  // Coords are what the LockerPicker's nearest-3 needs; without them we
  // either capture inline or fall through to the search-only path.
  const hasSavedAddress = !!(me && me.addrLat != null && me.addrLng != null);

  // Single source of truth for "which address should this checkout
  // use?" — captureAddr / captureLat / captureLng if the buyer
  // doesn't have one saved OR has flipped "Use a different address"
  // for this order; otherwise the profile values. Drives the
  // LockerPicker props and TCG buildPayload uniformly.
  const usingCaptureAddr = !hasSavedAddress || useDifferentAddress;

  // ─── Live shipping quote ──────────────────────────────────────────
  // Re-fetch whenever the buyer changes shipping method or destination.
  // Three triggers:
  //   • method = PUDO and a locker has been picked → quote L2L
  //   • method = TCG and saved address has coords → quote D2D
  //   • method = DEALER_TRANSFER / PRIVATE_ARRANGE → no rate, mark idle
  // Race-guarded — a stale fetch never overwrites a newer one.
  useEffect(() => {
    if (method !== 'PUDO' && method !== 'TCG') {
      setQuoteState({ kind: 'idle' });
      return;
    }
    if (method === 'PUDO' && !selectedLocker) {
      setQuoteState({ kind: 'idle' });
      return;
    }
    // TCG needs a street + coords. Pull from override values when
    // the toggle is on; else the saved profile values.
    if (method === 'TCG') {
      const street = usingCaptureAddr ? captureAddr.street.trim() : me?.addrStreet;
      const lat = usingCaptureAddr ? captureLat : me?.addrLat;
      const lng = usingCaptureAddr ? captureLng : me?.addrLng;
      if (!street || lat == null || lng == null) {
        setQuoteState({ kind: 'idle' });
        return;
      }
    }

    let cancelled = false;
    setQuoteState({ kind: 'loading' });
    (async () => {
      try {
        const body: Record<string, unknown> = {
          listingId: listing.id,
          shippingMethod: method,
        };
        if (method === 'PUDO') {
          body.toLockerId = selectedLocker?.lockerId;
        } else if (method === 'TCG') {
          body.deliveryAddress = usingCaptureAddr
            ? {
                streetAddress: captureAddr.street.trim(),
                suburb: captureAddr.suburb.trim(),
                city: captureAddr.city.trim(),
                postalCode: captureAddr.postalCode.trim(),
                province: captureAddr.province,
                lat: captureLat,
                lng: captureLng,
              }
            : {
                streetAddress: me?.addrStreet ?? '',
                suburb: me?.addrSuburb ?? '',
                city: me?.addrCity ?? '',
                postalCode: me?.addrPostalCode ?? '',
                province: me?.addrProvince,
                lat: me?.addrLat,
                lng: me?.addrLng,
              };
        }
        const res = await fetch(`${API_URL}/shipping/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as
          | ShippingQuote
          | { message?: string };
        if (cancelled) return;
        if (!res.ok) {
          setQuoteState({
            kind: 'error',
            message:
              ('message' in data && data.message) ||
              `Couldn't fetch shipping rate (HTTP ${res.status}).`,
          });
          return;
        }
        setQuoteState({ kind: 'ready', quote: data as ShippingQuote });
      } catch (err) {
        if (cancelled) return;
        setQuoteState({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Could not fetch a shipping rate.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetch the quote when EITHER the saved address OR the
    // override-capture values change. usingCaptureAddr flips between
    // them; capture* fields drive the override path; me is the
    // saved-profile fallback. All present here so a single edit in
    // the inline form re-prices live.
  }, [
    method,
    selectedLocker,
    me,
    listing.id,
    usingCaptureAddr,
    captureAddr.street,
    captureAddr.suburb,
    captureAddr.city,
    captureAddr.postalCode,
    captureAddr.province,
    captureLat,
    captureLng,
  ]);

  function handleAddressComponents(c: ParsedAddressComponents) {
    setCaptureAddr((prev) => ({
      ...prev,
      street: c.street ?? prev.street,
      suburb: c.suburb ?? prev.suburb,
      city: c.city ?? prev.city,
      postalCode: c.postalCode ?? prev.postalCode,
      province: c.province
        ? (c.province
            .toUpperCase()
            .replace(/[\s-]+/g, '_') as ManualAddressValue['province'])
        : prev.province,
    }));
    setCaptureLat(c.lat ?? null);
    setCaptureLng(c.lng ?? null);
  }

  async function saveCapturedAddress() {
    setSavingAddr(true);
    setAddrError(null);
    try {
      const { url, headers } = await authedRequest('/users/me');
      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          addrBuilding: captureAddr.building.trim() || null,
          addrStreet: captureAddr.street.trim() || null,
          addrAddress2: captureAddr.address2.trim() || null,
          addrSuburb: captureAddr.suburb.trim() || null,
          addrCity: captureAddr.city.trim() || null,
          addrPostalCode: captureAddr.postalCode.trim() || null,
          addrProvince: captureAddr.province || null,
          addrLat: captureLat,
          addrLng: captureLng,
        }),
      });
      const data = (await res.json()) as Me | { message?: string };
      if (!res.ok) {
        throw new Error(
          ('message' in data && data.message) || `Save failed (${res.status})`,
        );
      }
      setMe(data as Me);
    } catch (err) {
      setAddrError(
        err instanceof Error ? err.message : 'Could not save address',
      );
    } finally {
      setSavingAddr(false);
    }
  }

  function buildPayload() {
    // M33 — for firearm listings the backend HARD-refuses any
    // transaction without firearmAttestation18Plus === true. We
    // include it on every payload (harmless for non-firearm) so we
    // never accidentally regress this gate.
    const attestation = listing.isFirearm
      ? { firearmAttestation18Plus: firearmAttestation }
      : {};
    const base = { listingId: listing.id, shippingMethod: method, ...attestation };
    if (method === 'PUDO') return { ...base, pudoPickupLockerId: selectedLocker?.lockerId };
    if (method === 'TCG') {
      // Effective address: captureAddr when toggle is on OR there's
      // no saved address, else the profile values. Same flag drives
      // the LockerPicker (PUDO path), so a one-off override stays
      // consistent across both shipping methods. Contact name +
      // phone are still pulled from User on the backend — even when
      // shipping somewhere else this run we don't override identity.
      if (!me && !usingCaptureAddr) return base;
      const addr = usingCaptureAddr
        ? {
            building: captureAddr.building.trim() || undefined,
            streetAddress: captureAddr.street.trim(),
            address2: captureAddr.address2.trim() || undefined,
            suburb: captureAddr.suburb.trim(),
            city: captureAddr.city.trim(),
            province: captureAddr.province || '',
            postalCode: captureAddr.postalCode.trim(),
            lat: captureLat ?? undefined,
            lng: captureLng ?? undefined,
          }
        : {
            building: me?.addrBuilding ?? undefined,
            streetAddress: me?.addrStreet ?? '',
            address2: me?.addrAddress2 ?? undefined,
            suburb: me?.addrSuburb ?? '',
            city: me?.addrCity ?? '',
            province: me?.addrProvince ?? '',
            postalCode: me?.addrPostalCode ?? '',
            lat: me?.addrLat ?? undefined,
            lng: me?.addrLng ?? undefined,
          };
      return { ...base, deliveryAddress: addr };
    }
    // Dealer-transfer: no dealerId — buyer picks their own SAPS
    // dealer and uploads the SAPS 534 + stock register + firearm-
    // serial photos after delivery. Backend accepts the txn without
    // a dealerId (DealerVerificationService gates payout instead).
    if (method === 'DEALER_TRANSFER') return base;
    if (method === 'PRIVATE_ARRANGE') {
      // The consent flag tells the backend to set
      // Transaction.privateArrangeAcceptedAt and unlocks the
      // immediate-payout branch in markPaid(). The backend rejects
      // PRIVATE_ARRANGE submissions without this flag — defence in
      // depth against a buyer hitting the API directly.
      return { ...base, privateArrangeConsent: true };
    }
    return base;
  }

  function isReady() {
    // Hard gate — every buyer needs a phone on file before Pay enables
    // (the inline BuyerPhoneCapture block surfaces above when missing).
    // No phone = no dispatch SMS = lost parcel risk.
    if (meLoaded && me && !me.phone) return false;
    // M33 — firearm buyers must affirm 18+/competency.
    if (listing.isFirearm && !firearmAttestation) return false;

    // PUDO + TCG also need a successful quote — the buyer can't pay
    // until we know what the shipping line costs. DEALER_TRANSFER and
    // PRIVATE_ARRANGE skip the quote step entirely.
    if (method === 'PUDO') {
      return !!selectedLocker && quoteState.kind === 'ready';
    }
    if (method === 'TCG') {
      // TCG quote needs coords for the destination. Source depends
      // on whether the buyer's overriding (capture values) or using
      // their saved profile address — usingCaptureAddr decides.
      const hasCoords = usingCaptureAddr
        ? captureLat != null && captureLng != null
        : me?.addrLat != null && me?.addrLng != null;
      return hasCoords && quoteState.kind === 'ready';
    }
    if (method === 'DEALER_TRANSFER') return dtConsentAccepted;
    if (method === 'PRIVATE_ARRANGE') return paConsentAccepted;
    return false;
  }

  // Live preview of what the buyer will pay. Mirrors the backend
  // FeeCalculator math (bands locked in lib/types-derived constants
  // wouldn't help here — we just inline the formulas). The actual
  // numbers the buyer is charged are re-computed server-side on Pay so
  // this is presentation-only and safe to trust as a "shown to user"
  // value.
  const PEACH_RATE = 0.035;
  const PEACH_FIXED_CENTS = 150;
  const VAT_MULTIPLIER = 1.15;
  function previewBreakdown(): {
    listing: number;
    shipping: number;
    processing: number;
    total: number;
  } | null {
    if (!listing.price) return null;
    const item = listing.price;
    const shipping =
      quoteState.kind === 'ready' ? quoteState.quote.priceCents : 0;
    // Peach charges on the gross (item + shipping), VAT-inclusive.
    const processing = Math.round(
      (item + shipping) * PEACH_RATE * VAT_MULTIPLIER +
        PEACH_FIXED_CENTS * VAT_MULTIPLIER,
    );
    return {
      listing: item,
      shipping,
      processing,
      total: item + shipping + processing,
    };
  }

  async function handleProceed() {
    if (!isReady()) return;
    setSubmitting(true);
    setError(null);

    try {
      const { url, headers } = await authedRequest('/transactions');
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildPayload()),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = Array.isArray(err.message) ? err.message.join(', ') : (err.message ?? `Error ${res.status}`);
        throw new Error(msg);
      }

      const data: CreateTxResponse = await res.json();

      // Manual EFT mode → show bank-deposit instructions + the order
      // reference instead of a gateway redirect.
      if (data.manual && data.orderReference && data.bankDetails && data.payByAt) {
        setCheckout(data);
        return;
      }

      // Mock mode (gateway not configured) → no hosted link to send the
      // buyer to. Render the test-mode card via the `checkout` state.
      if (!data.redirectUrl || data.paymentId?.startsWith('mock-')) {
        setCheckout(data);
        return;
      }

      // Live: hand off to Stitch's hosted checkout. Stash the txId so the
      // /checkout/complete return page can verify it (Stitch returns the
      // buyer to the registered base URL without our id). Keep
      // `submitting` true — we're navigating away.
      try {
        localStorage.setItem(PENDING_TX_KEY, data.transactionId);
      } catch {
        // Private-mode / storage-disabled: the txId also rides back via
        // the (deferred) webhook, so the order still settles server-side.
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
        listingTitle={listing.title}
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

        {/* Price summary */}
        <div
          className="rounded-[6px] p-4 mb-6 text-sm"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <PriceRow label="Item price" value={checkout.breakdown.listingPrice} />
          {listing.passFeeToBuyer && (
            <PriceRow label="Processing fee" value={checkout.breakdown.processingFee} />
          )}
          <div
            className="my-2"
            style={{ borderTop: '0.5px solid var(--border-divider)' }}
          />
          <PriceRow label="Total charged" value={checkout.breakdown.buyerTotal} highlight />
        </div>

        <div
          className="rounded-[8px] p-6 text-center text-sm"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <p className="mb-2" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            Test mode
          </p>
          <p>The payment gateway is not configured. Add Stitch credentials to your .env to enable live checkout.</p>
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

      {/* Buyer phone capture — only shown if /users/me has no phone
          on file. We don't OTP buyers (Clerk doesn't do phones and
          we'd be paying extra SMS to verify), we just store the
          number so dispatch/out-for-delivery SMS reaches them. The
          block disappears once me.phone is set on the next fetch. */}
      {meLoaded && me && !me.phone && !actionToken && (
        <BuyerPhoneCapture
          onSaved={(phone) => {
            // Optimistic local update so the block hides immediately
            // and the Pay button enables without a round-trip.
            setMe({ ...me, phone });
          }}
        />
      )}
      {/* Token-flow buyers without a phone are an edge case (they
          must have had a phone to receive the offer-accepted SMS in
          the first place). If somehow it's missing, nudge them to
          sign in instead of trying to capture via the public
          token endpoint — phone capture stays Clerk-only for
          security. */}
      {meLoaded && me && !me.phone && actionToken && (
        <div
          className="rounded-[6px] p-4"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-secondary)',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          We need a phone number on file before checkout. Please{' '}
          <a
            href={`/sign-in?redirect_url=/checkout/${listing.id}`}
            style={{ color: 'var(--red)', textDecoration: 'underline' }}
          >
            sign in
          </a>{' '}
          to add one, then return to this checkout.
        </div>
      )}

      {/* Shipping method — show the seller's chosen options as radio
          pills. Firearm listings now allow PRIVATE_ARRANGE (the buyer
          and seller meet at a dealer themselves) alongside the
          previous DEALER_TRANSFER (we pre-pick the dealer). When the
          seller only offered one option there's nothing to choose and
          we still render the pill so the buyer can see what they're
          getting. */}
      {allowedMethods.length > 0 && (
        <div>
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
            {listing.isFirearm ? 'Transfer method' : 'Delivery method'}
          </p>
          <div className="flex gap-2 flex-wrap">
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
                {m === 'PUDO'
                  ? 'Pudo locker'
                  : m === 'TCG'
                    ? 'Door delivery (TCG)'
                    : m === 'DEALER_TRANSFER'
                      ? 'Dealer transfer'
                      : 'Private arrangement'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pudo collection locker — gated on a saved address with
          coords. If the buyer has one, we feed lat/lng into LockerPicker
          so it suggests the nearest 5. If not, we render an inline
          address capture (same components as /profile/edit) that saves
          to /users/me on submit, then reveals the picker. */}
      {method === 'PUDO' && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Choose your collection locker
          </p>
          {!meLoaded ? (
            <p
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Loading your address…
            </p>
          ) : (
            <>
              {/* Saved-address chip + "use a different address"
                  toggle — only shown when the buyer DOES have a
                  saved address AND hasn't flipped the override.
                  Mirrors the chip used on the TCG branch below. */}
              {hasSavedAddress && !useDifferentAddress && (
                <DeliveringToChip
                  me={me}
                  onUseDifferent={() => setUseDifferentAddress(true)}
                />
              )}

              {/* Address-capture block — shown when the buyer
                  doesn't have a saved address OR has chosen to
                  override it for this order. The LockerPicker below
                  reads LIVE from these inputs (Google autocomplete
                  or manual postal code typing), so suggestions
                  populate the moment a 4-digit code or coords land —
                  no "Save" step required to see lockers. The save
                  button persists to /users/me so future checkouts
                  skip this; when the override is on, the save button
                  is hidden because we explicitly DON'T want a
                  one-off address to leak into the profile. */}
              {(!hasSavedAddress || useDifferentAddress) && (
                <div
                  className="rounded-[6px] p-4 space-y-3 mb-3"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p
                        className="text-xs uppercase mb-2"
                        style={{
                          color: 'var(--text-tertiary)',
                          letterSpacing: '0.08em',
                          fontWeight: 500,
                        }}
                      >
                        {useDifferentAddress
                          ? 'Different address for this order'
                          : 'Your delivery address'}
                      </p>
                      <p
                        className="text-xs"
                        style={{
                          color: 'var(--text-secondary)',
                          lineHeight: 1.55,
                        }}
                      >
                        {useDifferentAddress
                          ? "We won't save this to your profile — it only applies to this purchase."
                          : 'Type or pick an address — locker suggestions update live below as you fill it in. Save it to your profile to skip this on the next purchase.'}
                      </p>
                    </div>
                    {useDifferentAddress && (
                      <button
                        type="button"
                        onClick={() => setUseDifferentAddress(false)}
                        className="text-xs whitespace-nowrap"
                        style={{
                          color: 'var(--text-tertiary)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        ← Use saved address
                      </button>
                    )}
                  </div>
                  <AddressAutocomplete
                    value={
                      captureAddr.street
                        ? `${captureAddr.street}${captureAddr.suburb ? `, ${captureAddr.suburb}` : ''}`
                        : ''
                    }
                    onChange={(v) => {
                      if (!captureAddr.street) {
                        setCaptureAddr((p) => ({ ...p, street: v }));
                      }
                    }}
                    onComponents={handleAddressComponents}
                  />
                  <ManualAddressFields
                    value={captureAddr}
                    onChange={setCaptureAddr}
                    idPrefix="checkout"
                  />
                  {addrError && (
                    <p className="text-xs" style={{ color: 'var(--red)' }}>
                      {addrError}
                    </p>
                  )}
                  {/* Save-to-profile button — only shown for the
                      "no saved address yet" path. When the buyer is
                      using a one-off override we hide it; the whole
                      point of the override is to NOT touch the
                      profile. */}
                  {!useDifferentAddress && (
                    <button
                      type="button"
                      onClick={saveCapturedAddress}
                      disabled={
                        savingAddr ||
                        !captureAddr.street.trim() ||
                        !captureAddr.city.trim() ||
                        captureLat == null ||
                        captureLng == null
                      }
                      className="px-4 py-2 rounded-[6px] text-sm"
                      style={{
                        background:
                          savingAddr ||
                          !captureAddr.street.trim() ||
                          !captureAddr.city.trim() ||
                          captureLat == null ||
                          captureLng == null
                            ? 'var(--bg-card)'
                            : 'var(--red)',
                        color:
                          savingAddr ||
                          !captureAddr.street.trim() ||
                          !captureAddr.city.trim() ||
                          captureLat == null ||
                          captureLng == null
                            ? 'var(--text-tertiary)'
                            : '#fff',
                        border: 'none',
                        cursor: savingAddr ? 'not-allowed' : 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {savingAddr ? 'Saving…' : 'Save address to profile'}
                    </button>
                  )}
                </div>
              )}

              {/* LIVE locker picker — fed by capture values first
                  (Google autocomplete or manual typing in the form
                  above) then falling back to the saved profile.
                  Either a 4-digit postal code OR lat/lng triggers a
                  fetch on the backend (tiered: exact match →
                  Delaunay neighbours → distance). */}
              <LockerPicker
                lat={captureLat ?? me?.addrLat ?? null}
                lng={captureLng ?? me?.addrLng ?? null}
                postalCode={
                  (captureAddr.postalCode || '').trim() ||
                  me?.addrPostalCode ||
                  null
                }
                onSelect={setSelectedLocker}
                selectedId={selectedLocker?.lockerId}
              />
            </>
          )}

          {/* Confirmation chip — once a locker is picked, restate it
              clearly so the buyer can see what they chose without
              scrolling back up through the picker. */}
          {selectedLocker && (
            <div
              className="rounded-[6px] p-3 mt-3 text-sm"
              style={{
                background: 'rgba(34,197,94,0.08)',
                border: '0.5px solid rgba(34,197,94,0.45)',
                color: 'var(--text-primary)',
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span style={{ fontWeight: 500 }}>
                  Collecting from {selectedLocker.name}
                </span>
                <span
                  className="text-xs"
                  style={{
                    color: '#22c55e',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  {selectedLocker.lockerId}
                </span>
              </div>
              <div
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {selectedLocker.address}
                {selectedLocker.suburb ? `, ${selectedLocker.suburb}` : ''}
                {selectedLocker.city ? `, ${selectedLocker.city}` : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TCG door-to-door delivery — same address-capture gate as
          PUDO. If the buyer has a saved address with coords on
          /users/me we show a "Delivering to" confirmation chip; if
          not, the inline capture form (AddressAutocomplete +
          ManualAddressFields) appears and saves to their profile on
          submit. Name + phone come from User, not from this form. */}
      {method === 'TCG' && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Delivery address
          </p>
          {!meLoaded ? (
            <p
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Loading your address…
            </p>
          ) : hasSavedAddress && !useDifferentAddress ? (
            // Saved-address confirmation chip with a "Ship to a
            // different address" toggle right under it. Clicking
            // the toggle flips useDifferentAddress and replaces
            // this chip with the inline capture form below.
            <DeliveringToChip
              me={me}
              onUseDifferent={() => setUseDifferentAddress(true)}
            />
          ) : (
            <div
              className="rounded-[6px] p-4 space-y-3"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className="text-xs uppercase mb-2"
                    style={{
                      color: 'var(--text-tertiary)',
                      letterSpacing: '0.08em',
                      fontWeight: 500,
                    }}
                  >
                    {useDifferentAddress
                      ? 'Different delivery address for this order'
                      : 'Your delivery address'}
                  </p>
                  <p
                    className="text-xs"
                    style={{
                      color: 'var(--text-secondary)',
                      lineHeight: 1.55,
                    }}
                  >
                    {useDifferentAddress
                      ? "We won't save this to your profile — it only applies to this purchase. Contact name + phone still come from your account."
                      : "We'll save this to your profile so you don't have to enter it again. Your contact name and phone are pulled from your account."}
                  </p>
                </div>
                {useDifferentAddress && (
                  <button
                    type="button"
                    onClick={() => setUseDifferentAddress(false)}
                    className="text-xs whitespace-nowrap"
                    style={{
                      color: 'var(--text-tertiary)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    ← Use saved address
                  </button>
                )}
              </div>
              <AddressAutocomplete
                value={
                  captureAddr.street
                    ? `${captureAddr.street}${captureAddr.suburb ? `, ${captureAddr.suburb}` : ''}`
                    : ''
                }
                onChange={(v) => {
                  if (!captureAddr.street) {
                    setCaptureAddr((p) => ({ ...p, street: v }));
                  }
                }}
                onComponents={handleAddressComponents}
              />
              <ManualAddressFields
                value={captureAddr}
                onChange={setCaptureAddr}
                idPrefix="checkout-tcg"
              />
              {addrError && (
                <p className="text-xs" style={{ color: 'var(--red)' }}>
                  {addrError}
                </p>
              )}
              {/* Save-to-profile only when this is the buyer's first
                  address. One-off overrides MUST NOT touch the
                  saved profile. */}
              {!useDifferentAddress && (
                <button
                  type="button"
                  onClick={saveCapturedAddress}
                  disabled={
                    savingAddr ||
                    !captureAddr.street.trim() ||
                    !captureAddr.city.trim() ||
                    captureLat == null ||
                    captureLng == null
                  }
                  className="px-4 py-2 rounded-[6px] text-sm"
                  style={{
                    background:
                      savingAddr ||
                      !captureAddr.street.trim() ||
                      !captureAddr.city.trim() ||
                      captureLat == null ||
                      captureLng == null
                        ? 'var(--bg-card)'
                        : 'var(--red)',
                    color:
                      savingAddr ||
                      !captureAddr.street.trim() ||
                      !captureAddr.city.trim() ||
                      captureLat == null ||
                      captureLng == null
                        ? 'var(--text-tertiary)'
                        : '#fff',
                    border: 'none',
                    cursor: savingAddr ? 'not-allowed' : 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {savingAddr ? 'Saving…' : 'Save address & get rate'}
                </button>
              )}
              {captureLat == null && (
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Tip: pick a result from the address suggestions so we
                  can capture coordinates — TCG uses them to quote the
                  delivery rate.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dealer transfer — self-arrange. We don't yet have a
          comprehensive SAPS dealer directory, so instead of forcing
          the buyer to pick from an incomplete dropdown we let them
          use any SAPS-licensed dealer of their choice. After the
          item lands at their dealer they upload 3 photos (SAPS 534
          + stock register last line + firearm with serial visible)
          and Claude vision verifies before funds release to the
          seller. The verification flow lives at
          /transactions/[id]/dealer-verification (built in D1–D6). */}
      {method === 'DEALER_TRANSFER' && (
        <DealerTransferConsent
          accepted={dtConsentAccepted}
          onChange={setDtConsentAccepted}
        />
      )}

      {/* Private arrangement — HARD consent. The buyer is opting out of
          payment protection: on payment capture the seller is paid
          immediately and both parties get each other's contact details
          so they can coordinate the dealer meet themselves. Two
          checkboxes + the literal phrase "I UNDERSTAND" are required
          before Pay enables. Without this consent the backend refuses
          the PRIVATE_ARRANGE method. */}
      {method === 'PRIVATE_ARRANGE' && (
        <PrivateArrangeConsent
          accepted={paConsentAccepted}
          onChange={setPaConsentAccepted}
        />
      )}

      {/* M33 — 18+/competency attestation. Required by the backend
          for every firearm transaction. Rendered last in the consent
          stack so it's the buyer's final affirmation before Pay. */}
      {listing.isFirearm && (
        <FirearmAttestation
          accepted={firearmAttestation}
          onChange={setFirearmAttestation}
        />
      )}

      {/* Live order breakdown — only meaningful for the courier-routed
          methods. Firearm transfers skip this block; they don't have
          a courier line item. Quote state drives the visual: loading
          spinner while we fetch, red banner on error, full line items
          when ready. The Pay button below mirrors quoteState through
          isReady() so the buyer can't submit on a stale estimate. */}
      {(method === 'PUDO' || method === 'TCG') &&
        (() => {
          const b = previewBreakdown();
          return (
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
                Order summary
              </p>
              {b && (
                <BreakdownLine
                  label="Item"
                  value={formatPrice(b.listing)}
                />
              )}
              {quoteState.kind === 'loading' && (
                <BreakdownLine
                  label="Shipping"
                  value="Calculating…"
                  muted
                />
              )}
              {quoteState.kind === 'error' && (
                <p
                  className="text-xs my-2"
                  style={{ color: 'var(--red)', lineHeight: 1.5 }}
                >
                  {quoteState.message}
                </p>
              )}
              {quoteState.kind === 'idle' && (
                <BreakdownLine
                  label="Shipping"
                  value={
                    method === 'PUDO'
                      ? 'Pick a locker above'
                      : 'Add your address to /profile/edit'
                  }
                  muted
                />
              )}
              {quoteState.kind === 'ready' && b && (
                <BreakdownLine
                  label={`Shipping (${quoteState.quote.serviceName})`}
                  value={formatPrice(b.shipping)}
                />
              )}
              {b && (
                <BreakdownLine
                  label="Payment processing fee (incl VAT)"
                  value={formatPrice(b.processing)}
                  muted
                />
              )}
              {b && (
                <div
                  className="flex justify-between items-baseline pt-2 mt-2"
                  style={{ borderTop: '0.5px solid var(--border)' }}
                >
                  <span
                    className="text-sm"
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                    }}
                  >
                    Total
                  </span>
                  <span
                    className="text-base"
                    style={{
                      color: 'var(--red)',
                      fontWeight: 500,
                    }}
                  >
                    {formatPrice(b.total)}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

      {/* Payment method — paygate placeholder above the live EFT flow */}
      <PaygateComingSoon />

      {/* Proceed button */}
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
        {(() => {
          if (submitting) return 'Setting up payment…';
          const b = previewBreakdown();
          if (
            b &&
            (method === 'PUDO' || method === 'TCG') &&
            quoteState.kind === 'ready'
          ) {
            return `Pay ${formatPrice(b.total)}`;
          }
          return `Pay ${listing.price ? formatPrice(listing.price) : 'now'}`;
        })()}
      </button>
    </div>
  );
}

// Inline phone-capture block for buyers with no number on file.
// We DON'T OTP — per operator decision Clerk doesn't manage phones
// for us, and verifying every buyer's phone via SMSPortal would
// burn credits on people we already trust enough to take payment
// from. Save and move on. The number's used for dispatch SMS only.
function BuyerPhoneCapture({
  onSaved,
}: {
  onSaved: (phone: string) => void;
}) {
  const { getToken } = useAuth();
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^\+?\d{9,15}$/.test(phone.trim());

  async function save() {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/buyer-phone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setErr(body.message ?? `Save failed (${res.status})`);
        return;
      }
      onSaved(phone.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-[6px] p-4"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-1"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
          fontWeight: 500,
        }}
      >
        Your phone number
      </p>
      <p
        className="text-xs mb-3"
        style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
      >
        We&apos;ll SMS you when the parcel ships and when it&apos;s out for
        delivery. Required to complete checkout.
      </p>
      <div className="flex gap-2">
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) =>
            setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 16))
          }
          placeholder="0821234567 or +27821234567"
          style={{
            flex: 1,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={!valid || saving}
          className="px-4 py-2 rounded-[6px] text-sm"
          style={{
            background: !valid || saving ? 'var(--bg-card)' : 'var(--red)',
            color: !valid || saving ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: !valid || saving ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && (
        <p
          className="text-xs mt-2"
          style={{ color: 'var(--red)' }}
        >
          {err}
        </p>
      )}
    </div>
  );
}

// Reusable row inside the order-summary card.
function BreakdownLine({
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

// Shared "Delivering to <name> · address …" chip used by both the
// PUDO and TCG branches when the buyer has a saved address on file.
// Below the address line we surface:
//   - "Wrong address? Edit in your profile" — sends the buyer to
//     /profile/edit to update their persistent address (affects
//     future orders too).
//   - "Ship to a different address" — flips the parent's
//     useDifferentAddress toggle so they can override JUST this
//     order without touching their profile.
function DeliveringToChip({
  me,
  onUseDifferent,
}: {
  me: Me | null;
  onUseDifferent: () => void;
}) {
  const name =
    [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'you';
  const addr = [
    me?.addrBuilding,
    me?.addrStreet,
    me?.addrSuburb,
    me?.addrCity,
    me?.addrPostalCode,
  ]
    .filter(Boolean)
    .join(', ');
  // Confidence check — the saved-profile path is the most common
  // source of mis-delivery (people move and forget to update). If
  // the obvious "completeness" markers (street, suburb, city, postal
  // code) aren't all set, the address is suspect even if some parts
  // are filled in. Surface an amber callout asking the buyer to
  // confirm before they hand R5k+ to the courier.
  const incomplete =
    !me?.addrStreet || !me?.addrSuburb || !me?.addrCity || !me?.addrPostalCode;
  return (
    <div
      className="rounded-[6px] p-3 text-sm"
      style={{
        background: incomplete
          ? 'rgba(245,158,11,0.08)'
          : 'rgba(34,197,94,0.08)',
        border: `0.5px solid ${incomplete ? '#f59e0b' : 'rgba(34,197,94,0.45)'}`,
        color: 'var(--text-primary)',
      }}
    >
      <p style={{ fontWeight: 500, marginBottom: 4 }}>Delivering to {name}</p>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{addr || '(no address on file)'}</p>
      {incomplete && (
        <p
          style={{
            color: '#f59e0b',
            fontSize: 12,
            marginTop: 6,
            fontWeight: 500,
          }}
        >
          ⚠ Your saved address looks incomplete. Confirm it's correct or use a different address — wrong delivery details mean wrong delivery.
        </p>
      )}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1"
        style={{ marginTop: 6 }}
      >
        <a
          href="/profile/edit"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            textDecoration: 'underline',
          }}
        >
          Wrong address? Edit in your profile →
        </a>
        <button
          type="button"
          onClick={onUseDifferent}
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            textDecoration: 'underline',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          Ship to a different address →
        </button>
      </div>
    </div>
  );
}

// Dealer-transfer explainer + soft consent.
//
// Gun Galore's role in a firearm DEALER_TRANSFER ends at:
//   1. holding the buyer's funds
//   2. verifying the seller's SAPS 534 + stock-register + firearm
//      photos via Claude vision (instant for clear photos, human
//      review for unclear)
//   3. notifying the buyer which dealer has booked the firearm in
//   4. releasing the held funds to the seller
//
// After payout, both parties arrange the rest themselves —
// inter-dealer transfer to the buyer's preferred dealer,
// collection logistics, whatever. We don't route the firearm
// or pick the destination dealer.
//
// Single checkbox gate — the buyer keeps payment protection
// (funds held) until verification approves, so this is lower
// friction than PRIVATE_ARRANGE where they're waiving protection.
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

// Hard-consent gate for PRIVATE_ARRANGE. Two checkboxes + the literal
// phrase "I UNDERSTAND" typed into a text field. Until all three pass,
// `accepted` stays false and the parent's isReady() returns false.
//
// Why this level of friction: PRIVATE_ARRANGE waives payment protection
// — the seller is paid the moment Peach confirms the card. We need an
// unmistakable opt-in so a buyer can't later claim they didn't know
// what they were giving up. The screen also doubles as documentation
// for support if a dispute lands.
function PrivateArrangeConsent({
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
        Private arrangement — you waive Gun Galore&apos;s payment protection
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
          The seller will be paid <strong style={{ color: 'var(--text-primary)' }}>immediately</strong> when
          your card is captured — funds are not held.
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
          I understand that the seller will be paid immediately and I
          waive my right to refund or dispute this purchase.
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
function FirearmAttestation({
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
