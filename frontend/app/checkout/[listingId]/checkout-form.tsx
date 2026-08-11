'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import {
  Listing,
  FeeBreakdown,
  Me,
  ShippingMethod,
  ShippingQuote,
  Address,
} from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { SavedAddressPicker } from '@/components/saved-address-picker';
import { DeliveryMethodCards } from '@/components/delivery-method-cards';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
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
import { getCollectionMode } from '@/lib/delivery-estimate';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface CreateTxResponse {
  transactionId: string;
  // Paygate payment id. Carries a `mock-` prefix when the gateway isn't
  // configured (dev).
  paymentId?: string;
  // Hosted paygate checkout URL the browser is redirected to.
  redirectUrl?: string;
  provider?: string;
  breakdown: FeeBreakdown;
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

export function CheckoutForm({ listing }: { listing: Listing }) {
  const { getToken } = useAuth();

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

  // Collection-only listing (trailers / caravans) — collected in person
  // from the seller, no courier. When true we hide all courier shipping
  // UI, skip the shipping quote, and submit shippingMethod = 'COLLECTION'.
  // There's no shipping cost (R0). Falls back to the shippingMethods array
  // for older payloads that don't carry the collectionOnly flag.
  const isCollection =
    listing.collectionOnly ??
    listing.shippingMethods?.includes('COLLECTION') ??
    false;

  // Hunting Packages / Experiences (Phase E) — a future-dated on-site
  // booking. When true we hide every courier surface (like isCollection),
  // force shippingMethod = 'ON_SITE_SERVICE', collect an eventDate (within
  // the listing window) + partySize (≤ capacity) + the five required
  // attestations, and skip the shipping quote entirely (R0 shipping).
  const isExperience = listing.isExperience ?? false;

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
    isExperience
      ? 'ON_SITE_SERVICE'
      : isCollection
      ? 'COLLECTION'
      : allowedMethods[0] ?? (listing.isFirearm ? 'DEALER_TRANSFER' : 'PUDO'),
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
  // Phase-1 payment gate — card payments aren't live yet, so a checkout POST
  // returns 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);

  // P8a — units to buy. Only inventory-tracked BUY_NOW listings honour
  // quantity server-side (create-transaction.dto quantity, resolved to 1
  // for everything else). Cap at the seller-side `sellable` count so the
  // buyer can't request more than is in stock; the backend re-checks the
  // counter atomically on POST /transactions anyway.
  const maxQty = listing.trackInventory
    ? Math.max(
        1,
        (listing.quantityAvailable ?? 1) - (listing.quantityReserved ?? 0),
      )
    : 1;
  const [quantity, setQuantity] = useState(1);

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
  // UX-3 — set true once an address-book entry is picked, so the /users/me
  // mount prefill below can't race-overwrite the picked address.
  const addrPinnedRef = useRef(false);

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

  // Collection-only papers acknowledgement — required for requiresPapers
  // listings (trailers / caravans). The backend refuses the transaction
  // without collectionPapersAccepted === true, so this gate is mirrored
  // on Pay/isReady. Ignored for listings that don't require papers.
  const [collectionPapersAck, setCollectionPapersAck] = useState(false);

  // Hunting Packages / Experiences (Phase E) — booking date + party size +
  // the five required attestations. The backend HARD-refuses an experience
  // checkout unless the eventDate is inside the listing window, partySize is
  // 1..capacitySlots, and all five booleans are true — so these gates are
  // mirrored on Pay/isReady. Ignored entirely for non-experience checkouts.
  const [eventDate, setEventDate] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [expAtt, setExpAtt] = useState({
    over18: false,
    licenceOrSupervised: false,
    intermediary: false,
    cancellationPolicy: false,
    risks: false,
  });
  const expAllAttested =
    expAtt.over18 &&
    expAtt.licenceOrSupervised &&
    expAtt.intermediary &&
    expAtt.cancellationPolicy &&
    expAtt.risks;
  // The date bounds the picker to the listing's window. eventStartDate is
  // required for an experience; eventEndDate is optional (single-day = both
  // min/max on the start date).
  const eventMin = listing.eventStartDate
    ? new Date(listing.eventStartDate).toISOString().slice(0, 10)
    : undefined;
  const eventMax = (listing.eventEndDate ?? listing.eventStartDate)
    ? new Date(listing.eventEndDate ?? listing.eventStartDate!)
        .toISOString()
        .slice(0, 10)
    : undefined;
  const maxParty = listing.capacitySlots ?? 1;

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
        // Skipped once a saved-address-book entry has been picked (UX-3) so
        // this async prefill can't clobber the picked address.
        if (!addrPinnedRef.current) {
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
        }
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

  // UX-3 — a picked address-book entry drives the SAME capture state a typed
  // address does, so the checkout payload is byte-identical to typing it. We
  // pin it (so the profile prefill can't clobber it) and flip to the capture
  // path. Only surfaces for buyers with 2+ saved addresses; everyone else sees
  // today's flow unchanged.
  function handlePickSavedAddress(a: Address) {
    addrPinnedRef.current = true;
    setCaptureAddr({
      building: a.building ?? '',
      street: a.street,
      address2: a.address2 ?? '',
      suburb: a.suburb ?? '',
      city: a.city,
      postalCode: a.postalCode,
      province: a.province,
    });
    setCaptureLat(a.lat ?? null);
    setCaptureLng(a.lng ?? null);
    setUseDifferentAddress(true);
  }

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
    // Collection papers acknowledgement — only meaningful (and only
    // accepted by the backend) for requiresPapers listings. Harmless to
    // omit otherwise.
    const papers = listing.requiresPapers
      ? { collectionPapersAccepted: collectionPapersAck }
      : {};
    // Experience booking — the eventDate / partySize / five attestations.
    // Only meaningful (and only accepted by the backend) for an experience
    // listing; harmless to omit otherwise.
    const experience = isExperience
      ? {
          eventDate: eventDate
            ? new Date(eventDate).toISOString()
            : undefined,
          partySize,
          experienceBuyerAttested18Plus: expAtt.over18,
          experienceHuntingLicenceOrSupervisionAccepted:
            expAtt.licenceOrSupervised,
          experienceIntermediaryAcknowledged: expAtt.intermediary,
          experienceCancellationPolicyAccepted: expAtt.cancellationPolicy,
          experienceRisksAccepted: expAtt.risks,
        }
      : {};
    const base = {
      listingId: listing.id,
      shippingMethod: method,
      // P8a — units to buy. Backend resolves to 1 for non-tracked listings.
      ...(listing.trackInventory ? { quantity } : {}),
      ...attestation,
      ...papers,
      ...experience,
    };
    // Experience — on-site, no locker/address/quote. Base payload with
    // shippingMethod = 'ON_SITE_SERVICE' + the experience fields above.
    if (method === 'ON_SITE_SERVICE') return base;
    // Collection — no locker, no address, no quote. Just the base payload
    // with shippingMethod = 'COLLECTION' (+ the papers ack when required).
    if (method === 'COLLECTION') return base;
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
    // Collection papers — buyers of requiresPapers listings must
    // acknowledge the in-person collection + papers handover.
    if (listing.requiresPapers && !collectionPapersAck) return false;

    // Experience — on-site booking. Needs a chosen date inside the window,
    // a party size within capacity, and all five attestations ticked.
    if (method === 'ON_SITE_SERVICE') {
      const dateOk =
        !!eventDate &&
        (!eventMin || eventDate >= eventMin) &&
        (!eventMax || eventDate <= eventMax);
      const partyOk = partySize >= 1 && partySize <= maxParty;
      return dateOk && partyOk && expAllAttested;
    }

    // Collection — no locker, no address, no quote. Once the phone +
    // papers gates above pass, the buyer can pay.
    if (method === 'COLLECTION') return true;

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
  // FLOW-F4 (M23) — the live rail is manual EFT, which charges a FLAT 1.5% of
  // (item + shipping), no fixed component, no VAT multiplier (fee.calculator
  // calculateProcessingFee, 'manual' branch). The preview used to hardcode the
  // paygate card formula regardless, so on the manual rail every summary
  // over-stated the fee — and DEALER_TRANSFER showed no summary at all, so the
  // Pay button under-stated the true total by the whole 1.5%. A buyer then
  // EFT'd the wrong amount and reconciliation (buyerTotal === amountCents
  // exactly) rejected it as AMBIGUOUS. Match the server per PAYMENT_MODE.
  const PAYMENT_MODE =
    process.env.NEXT_PUBLIC_PAYMENT_MODE === 'paygate' ? 'paygate' : 'manual';
  const MANUAL_RATE = 0.015;
  // P6.4 — flat R15 handling per courier waybill. Applies to PUDO/TCG only;
  // firearm dealer/in-person routes and collection produce no waybill.
  const SHIPPING_HANDLING_CENTS = 1500;
  function previewBreakdown(): {
    listing: number;
    shipping: number;
    handling: number;
    processing: number;
    total: number;
  } | null {
    if (!listing.price) return null;
    const item = listing.price * (listing.trackInventory ? quantity : 1);
    const isCourier = method === 'PUDO' || method === 'TCG';
    const shipping =
      quoteState.kind === 'ready' ? quoteState.quote.priceCents : 0;
    const handling = isCourier ? SHIPPING_HANDLING_CENTS : 0;
    // Processing is charged on (item + shipping) ONLY — the R15 handling margin
    // is EXCLUDED from the base, matching the backend FeeCalculator.breakdown()
    // (we don't charge the % on our own margin). Handling is added to the total
    // separately below. FLOW-F4 (M23): pick the fee formula by PAYMENT_MODE
    // (manual EFT flat 1.5% vs paygate card rate) and only add it to the total
    // when the buyer absorbs it (passFeeToBuyer) — same as the backend.
    const base = item + shipping;
    const processing = !listing.passFeeToBuyer
      ? 0
      : PAYMENT_MODE === 'manual'
        ? Math.round(base * MANUAL_RATE)
        : Math.round(
            base * PEACH_RATE * VAT_MULTIPLIER +
              PEACH_FIXED_CENTS * VAT_MULTIPLIER,
          );
    return {
      listing: item,
      shipping,
      handling,
      processing,
      total: item + shipping + handling + processing,
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
        // Phase-1 payment gate: the API returns 503 "card payments are
        // launching soon" until PAYMENTS_LIVE. Show the friendly
        // launching-soon state rather than a red error banner.
        if (res.status === 503 || /launching soon/i.test(msg)) {
          setComingSoon(true);
          setSubmitting(false);
          return;
        }
        throw new Error(msg);
      }

      const data: CreateTxResponse = await res.json();

      // Live: hand off to the paygate's hosted checkout. Stash the txId so
      // the /checkout/complete return page can verify it (the gateway
      // returns the buyer to the registered base URL without our id). Keep
      // `submitting` true — we're navigating away.
      if (data.redirectUrl && !data.paymentId?.startsWith('mock-')) {
        try {
          localStorage.setItem(PENDING_TX_KEY, data.transactionId);
        } catch {
          // Private-mode / storage-disabled: the txId also rides back via
          // the (deferred) webhook, so the order still settles server-side.
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
    return <PaymentsComingSoon backHref={`/listings/${listing.id}`} />;
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
      {/* Collection-only panel — replaces every courier shipping surface
          (method selector, locker picker, delivery address, quote line).
          The item is collected in person from the seller, so there's
          nothing to choose. Once paid, we share contact details so both
          parties can coordinate a pickup time; payment is held until the
          buyer confirms collection. */}
      {isCollection && (
        <div
          className="rounded-[6px] p-4 text-sm space-y-2"
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
            Collection only
          </p>
          {/* Bulky-goods copy interim (audit Big-4). "You'll collect this in
              person" reads as "same city only", which is what caps trailers
              and off-road caravans at whoever will drive to fetch them — and
              it isn't true: the buyer may send a transporter, and the payment
              still stays held until THEY confirm the item is with them.
              FREIGHT_OK licenses that sentence; IN_PERSON_ONLY is the
              dangerous-goods case (loose lithium) where no carrier may legally
              take it, so there the original wording is the correct one. */}
          {getCollectionMode(listing) === 'FREIGHT_OK' ? (
            <p style={{ color: 'var(--text-secondary)' }}>
              You can collect this item yourself, or send your own
              transporter — it doesn&apos;t have to be you at the gate. After
              you pay, we&apos;ll share contact details so you can arrange the
              pickup. Your payment is held until you confirm the item is with
              you. All Outdoor doesn&apos;t arrange, quote or insure that
              transport.
            </p>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>
              You&apos;ll collect this item in person from the seller. After
              you pay, we&apos;ll share contact details so you can arrange a
              pickup time. Your payment is held until you confirm you&apos;ve
              collected it.
            </p>
          )}
        </div>
      )}

      {/* Collection papers acknowledgement — required for requiresPapers
          listings (trailers / caravans). Mirrors FirearmAttestation: the
          backend refuses the transaction without collectionPapersAccepted
          === true, so Pay is gated on it via isReady(). */}
      {listing.requiresPapers && (
        <CollectionPapersAck
          accepted={collectionPapersAck}
          onChange={setCollectionPapersAck}
        />
      )}

      {/* Hunting Packages / Experiences (Phase E) — on-site booking. Replaces
          every courier surface. Buyer picks a date within the listing's
          window + a party size (≤ capacity), then ticks the five required
          attestations. The backend HARD-refuses without a valid date/party
          + all five true, so Pay is gated via isReady(). */}
      {isExperience && (
        <>
          <div
            className="rounded-[6px] p-4 space-y-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
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
              Your booking
            </p>
            <Field label="Event date">
              <input
                type="date"
                value={eventDate}
                min={eventMin}
                max={eventMax}
                onChange={(e) => setEventDate(e.target.value)}
                style={inputStyle}
              />
              {eventMin && (
                <p
                  className="text-xs mt-1.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {eventMax && eventMax !== eventMin
                    ? `Pick a date between ${new Date(
                        listing.eventStartDate!,
                      ).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                      })} and ${new Date(
                        listing.eventEndDate!,
                      ).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                      })}.`
                    : `This package runs on ${new Date(
                        listing.eventStartDate!,
                      ).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}.`}
                </p>
              )}
            </Field>
            <Field label="Party size">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPartySize((p) => Math.max(1, p - 1))}
                  disabled={partySize <= 1}
                  className="w-9 h-9 rounded-[6px] text-base"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color:
                      partySize <= 1
                        ? 'var(--text-tertiary)'
                        : 'var(--text-primary)',
                    cursor: partySize <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  −
                </button>
                <span
                  className="text-sm"
                  style={{
                    color: 'var(--text-primary)',
                    minWidth: 24,
                    textAlign: 'center',
                  }}
                >
                  {partySize}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPartySize((p) => Math.min(maxParty, p + 1))
                  }
                  disabled={partySize >= maxParty}
                  className="w-9 h-9 rounded-[6px] text-base"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color:
                      partySize >= maxParty
                        ? 'var(--text-tertiary)'
                        : 'var(--text-primary)',
                    cursor: partySize >= maxParty ? 'not-allowed' : 'pointer',
                  }}
                >
                  +
                </button>
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  up to {maxParty} guest{maxParty === 1 ? '' : 's'}
                </span>
              </div>
            </Field>
          </div>
          <ExperienceAttestations value={expAtt} onChange={setExpAtt} />
        </>
      )}

      {!isCollection && allowedMethods.length > 0 && (
        // UX-8 — option cards; onSelect is the SAME setMethod, so state +
        // payload are unchanged. Live courier quote shows on PUDO/TCG cards.
        <DeliveryMethodCards
          methods={allowedMethods}
          selected={method}
          onSelect={setMethod}
          isFirearm={listing.isFirearm}
          quotePriceCents={
            quoteState.kind === 'ready' ? quoteState.quote.priceCents : undefined
          }
        />
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
          {/* UX-3 — saved-address picker (renders only for 2+ book addresses).
              Picking one drives the same capture state a typed address does. */}
          <SavedAddressPicker onSelect={handlePickSavedAddress} />
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

      {/* P8a — quantity stepper. Only for inventory-tracked BUY_NOW
          listings; single-item listings never render this. Clamped to
          the sellable stock; the backend re-checks the counter on Pay. */}
      {listing.trackInventory && maxQty > 1 && (
        <div>
          <p
            className="text-sm mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Quantity
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="w-9 h-9 rounded-[6px] text-base"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color:
                  quantity <= 1
                    ? 'var(--text-tertiary)'
                    : 'var(--text-primary)',
                cursor: quantity <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              −
            </button>
            <span
              className="text-sm"
              style={{ color: 'var(--text-primary)', minWidth: 24, textAlign: 'center' }}
            >
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
              disabled={quantity >= maxQty}
              className="w-9 h-9 rounded-[6px] text-base"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color:
                  quantity >= maxQty
                    ? 'var(--text-tertiary)'
                    : 'var(--text-primary)',
                cursor: quantity >= maxQty ? 'not-allowed' : 'pointer',
              }}
            >
              +
            </button>
            <span
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {maxQty} available
            </span>
          </div>
        </div>
      )}

      {/* Live order breakdown — only meaningful for the courier-routed
          methods. Firearm transfers skip this block; they don't have
          a courier line item. Quote state drives the visual: loading
          spinner while we fetch, red banner on error, full line items
          when ready. The Pay button below mirrors quoteState through
          isReady() so the buyer can't submit on a stale estimate. */}
      {(() => {
          // FLOW-F4 (M23) — render the summary for EVERY method, not just
          // courier: a DEALER_TRANSFER / PRIVATE_ARRANGE / COLLECTION buyer
          // must see the processing fee before committing, or they EFT the
          // wrong total. Courier-only rows (shipping) are gated on isCourier.
          const b = previewBreakdown();
          if (!b) return null;
          const isCourier = method === 'PUDO' || method === 'TCG';
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
              <BreakdownLine label="Item" value={formatPrice(b.listing)} />
              {isCourier && quoteState.kind === 'loading' && (
                <BreakdownLine
                  label="Shipping"
                  value="Calculating…"
                  muted
                />
              )}
              {isCourier && quoteState.kind === 'error' && (
                <p
                  className="text-xs my-2"
                  style={{ color: 'var(--red)', lineHeight: 1.5 }}
                >
                  {quoteState.message}
                </p>
              )}
              {isCourier && quoteState.kind === 'idle' && (
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
              {isCourier && quoteState.kind === 'ready' && (
                <BreakdownLine
                  label={`Shipping (${quoteState.quote.serviceName})`}
                  value={formatPrice(b.shipping)}
                />
              )}
              {b.handling > 0 && (
                <BreakdownLine
                  label="Handling"
                  value={formatPrice(b.handling)}
                />
              )}
              {b.processing > 0 && (
                <BreakdownLine
                  label={`Payment processing fee${PAYMENT_MODE === 'paygate' ? ' (incl VAT)' : ''}`}
                  value={formatPrice(b.processing)}
                  muted
                />
              )}
              {(
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

      {/* UX-8 — payment-method section shell (EFT active today; card seam). */}
      <PaymentMethodSection />

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
          const isCourier = method === 'PUDO' || method === 'TCG';
          // FLOW-F4 (M23) — courier still needs a ready quote for the true
          // total (shipping unknown until then); DEALER_TRANSFER / PA /
          // COLLECTION have no shipping, so b.total (item + 1.5% fee) is
          // complete immediately. Previously those fell through to the raw
          // listing price and under-stated the total by the whole fee.
          if (b && (!isCourier || quoteState.kind === 'ready')) {
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
// All Outdoor's role in a firearm DEALER_TRANSFER ends at:
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

// Hunting Packages / Experiences (Phase E) — the FIVE required buyer
// attestations at experience checkout. The backend HARD-refuses the
// booking unless all five are true, so this is both a regulatory /
// consumer-protection consent and a server-enforced gate. Pay is blocked
// via isReady() until every box is ticked.
interface ExpAttState {
  over18: boolean;
  licenceOrSupervised: boolean;
  intermediary: boolean;
  cancellationPolicy: boolean;
  risks: boolean;
}
function ExperienceAttestations({
  value,
  onChange,
}: {
  value: ExpAttState;
  onChange: (next: ExpAttState) => void;
}) {
  const allOk =
    value.over18 &&
    value.licenceOrSupervised &&
    value.intermediary &&
    value.cancellationPolicy &&
    value.risks;
  const set = (k: keyof ExpAttState, v: boolean) =>
    onChange({ ...value, [k]: v });
  const rowStyle: React.CSSProperties = {
    marginTop: 3,
    accentColor: 'var(--red)',
  };
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
        style={{ color: 'var(--red)', letterSpacing: '0.05em', fontWeight: 600 }}
      >
        Experience booking — required confirmations
      </p>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.over18}
          onChange={(e) => set('over18', e.target.checked)}
          style={rowStyle}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I am at least 18 years old.
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.licenceOrSupervised}
          onChange={(e) => set('licenceOrSupervised', e.target.checked)}
          style={rowStyle}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I hold the relevant firearm licence / competency, or I will be
          hunting under the outfitter&apos;s direct supervision.
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.intermediary}
          onChange={(e) => set('intermediary', e.target.checked)}
          style={rowStyle}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I understand All Outdoor is a payment-protection intermediary — the
          outfitter is the supplier of this experience.
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.cancellationPolicy}
          onChange={(e) => set('cancellationPolicy', e.target.checked)}
          style={rowStyle}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I accept the{' '}
          <a
            href="/experiences-cancellation-policy"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--red)', textDecoration: 'underline' }}
          >
            experiences cancellation policy
          </a>
          .
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.risks}
          onChange={(e) => set('risks', e.target.checked)}
          style={rowStyle}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I accept the inherent risks of hunting / range activities and will
          follow the outfitter&apos;s safety instructions.
        </span>
      </label>

      <p
        className="text-xs"
        style={{ color: allOk ? '#00a03c' : 'var(--text-tertiary)' }}
      >
        {allOk
          ? '✓ Confirmations recorded. You can proceed to payment below.'
          : 'Tick all five boxes to enable payment.'}
      </p>
    </div>
  );
}

// Collection papers acknowledgement — single-checkbox gate for
// requiresPapers listings (trailers / caravans). The backend HARD-
// refuses the transaction without `collectionPapersAccepted: true`, so
// this is both a buyer acknowledgement and a server-enforced gate. No
// documents are collected or displayed (POPIA) — the seller attests to
// holding the papers at listing time; the buyer acknowledges they'll
// receive them at handover.
function CollectionPapersAck({
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
        Collection & papers — required confirmation
      </p>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--red)' }}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          I understand I must collect this item in person and will receive
          the registration and roadworthy papers from the seller at
          handover.
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
