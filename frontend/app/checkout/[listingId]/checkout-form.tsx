'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { useSearchParams } from 'next/navigation';
import {
  Listing,
  FeeBreakdown,
  Me,
  ShippingMethod,
  ShippingQuote,
  Address,
  CheckoutHold,
} from '@/lib/types';
import { formatPrice, CONDITION_LABELS } from '@/lib/utils';
import { platformFeeForCents } from '@/lib/platform-fee';
import { useCountdown } from '@/lib/use-countdown';
import { DeliveryAddressSummary } from '@/components/delivery-address-summary';
import { DeliveryAddressDialog } from '@/components/delivery-address-dialog';
import { DeliveryMethodCards } from '@/components/delivery-method-cards';
import { CheckoutSummary, CheckoutCta } from '@/components/checkout-summary';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { usePaymentMethods } from '@/lib/payment-methods';
import { vicinityLabel } from '@/lib/vicinity';
import { pargoOptionLabel } from '@/lib/pargo-pickup';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import {
  DeliveryOptionsPicker,
  type DeliveryAddressInput,
  type DeliveryOption,
} from '@/components/delivery-options-picker';
import {
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

// mm:ss for the 15-minute reservation clock.
function formatHold(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// The deadline is the server's. Correct it by the client/server clock skew so
// a wrong device clock cannot show more (or less) time than the server allows.
function normalizeHold(hold: CheckoutHold): CheckoutHold {
  const skew = new Date(hold.serverNow).getTime() - Date.now();
  return {
    ...hold,
    expiresAt: new Date(
      new Date(hold.expiresAt).getTime() - skew,
    ).toISOString(),
  };
}

export function CheckoutForm({
  listing,
  initialHold = null,
  holdIncludedInListing = false,
  unpaidTransactionId = null,
}: {
  listing: Listing;
  initialHold?: CheckoutHold | null;
  holdIncludedInListing?: boolean;
  /**
   * 2026-11-24 buyer report: a buyer backed out of the Peach card page and
   * the checkout came back with a disabled Pay button and no way to finish
   * or restart. The server passes the buyer's own unfinished checkout here so
   * this form can offer Resume payment / Start again up front.
   */
  unpaidTransactionId?: string | null;
}) {
  const { getToken } = useAuth();
  const {
    methods: paymentMethods,
    provider: paymentProvider,
    setProvider: setPaymentProvider,
    loading: paymentLoading,
  } = usePaymentMethods();

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

  // ─── 15-minute reservation ────────────────────────────────────────
  // Opening the checkout page reserves ONE unit of a plain Marketplace listing.
  // The clock below is the same 15-minute window the server enforces; Pay
  // claims the hold, and an unpaid one returns the unit to the marketplace.
  // Auction wins and offer checkouts keep their existing windows.
  const holdEligible = listing.listingType === 'BUY_NOW';
  const [hold, setHold] = useState<CheckoutHold | null>(
    initialHold ? normalizeHold(initialHold) : null,
  );
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  // The buyer's own interrupted gateway attempt for this listing (see prop).
  const [unpaidAttempt, setUnpaidAttempt] = useState<string | null>(
    unpaidTransactionId,
  );
  const [abandoningAttempt, setAbandoningAttempt] = useState(false);
  const [attemptActionError, setAttemptActionError] = useState<string | null>(
    null,
  );
  const holdRequestedRef = useRef(false);
  const holdMs = useCountdown(hold?.expiresAt ?? null);
  const holdExpired = hold != null && holdMs <= 0;

  async function ensureHold() {
    if (!holdEligible) return;
    if (holdRequestedRef.current && holding) return;
    setHolding(true);
    setHoldError(null);
    try {
      const { url, headers } = await authedRequest('/transactions/hold');
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ listingId: listing.id }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | CheckoutHold
        | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray(
          (data as { message?: string | string[] }).message,
        )
          ? (data as { message: string[] }).message.join(', ')
          : ((data as { message?: string }).message ??
            `Could not reserve this item (${res.status})`);
        throw new Error(msg);
      }
      setHold(normalizeHold(data as CheckoutHold));
    } catch (err) {
      setHold(null);
      setHoldError(
        err instanceof Error ? err.message : 'Could not reserve this item',
      );
    } finally {
      setHolding(false);
    }
  }

  /**
   * Release a LAPSED interrupted payment so the buyer can start a clean run.
   * The server refuses while the payment window is still live (resume instead)
   * and never releases anything the gateway might still capture.
   */
  async function abandonUnpaidAttempt() {
    if (!unpaidAttempt) return;
    setAbandoningAttempt(true);
    setAttemptActionError(null);
    try {
      const { url, headers } = await authedRequest(
        `/transactions/${encodeURIComponent(unpaidAttempt)}/abandon`,
      );
      const res = await fetch(url, { method: 'POST', headers });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string | string[];
        released?: boolean;
      };
      if (!res.ok) {
        const msg = Array.isArray(data.message)
          ? data.message.join(', ')
          : (data.message ?? `Could not restart checkout (${res.status}).`);
        throw new Error(msg);
      }
      // Clean slate: a fresh hold + empty form, with the old invoice behind us.
      window.location.reload();
    } catch (e) {
      setAttemptActionError(
        e instanceof Error ? e.message : 'Could not restart this checkout.',
      );
      setAbandoningAttempt(false);
    }
  }

  useEffect(() => {
    if (!holdEligible) return;
    // The server already found a live hold for this buyer — never extend or
    // duplicate it on mount.
    if (initialHold) return;
    if (holdRequestedRef.current) return;
    holdRequestedRef.current = true;
    void ensureHold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdEligible, initialHold]);

  // Coming back from Ozow/Peach via the browser Back button can restore the
  // page from bfcache with `submitting` still true and a dead hold. Re-render
  // from the server so the buyer sees the real state instead of a frozen
  // "Setting up payment…" button.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Collection-only listing (trailers / caravans) — collected in person
  // from the seller, no courier. When true we hide all courier shipping
  // UI, skip the shipping quote, and submit shippingMethod = 'COLLECTION'.
  // There's no shipping cost (R0). Falls back to the shippingMethods array
  // for older payloads that don't carry the collectionOnly flag.
  const isCollection =
    listing.collectionOnly ??
    listing.shippingMethods?.includes('COLLECTION') ??
    false;

  // Allowed methods = intersection of (legal for this listing class) and
  // (what the seller offered in the Sell form). Legacy listings with an
  // empty shippingMethods array fall back to the full legal set so old
  // rows don't break. Phase 4 W2 — PRIVATE_ARRANGE (a peer handover) is now
  // legal for non-firearms too.
  //
  // MEET IN PERSON IS ALWAYS OFFERED. A handover books no courier and costs
  // the seller nothing, so the buyer may choose it on any listing class. Its
  // held-funds, contact-sharing and non-refundable Platform Fee terms are in
  // the Terms of Service and accepted at sign-up.
  const legalForClass: ShippingMethod[] = listing.isFirearm
    ? ['DEALER_TRANSFER', 'PRIVATE_ARRANGE']
    : ['COURIER', 'PRIVATE_ARRANGE'];
  const offeredMethods = listing.shippingMethods ?? [];
  const sellerAllows = (m: ShippingMethod) =>
    offeredMethods.length === 0 || offeredMethods.includes(m);
  const allowedMethods: ShippingMethod[] = isCollection
    ? []
    : listing.isFirearm
      ? legalForClass
      : [
          ...(sellerAllows('COURIER') ? (['COURIER'] as const) : []),
          'PRIVATE_ARRANGE' as const,
        ];

  // Non-firearm goods default to the courier rail (Bob Go door-to-door); when
  // the seller also offers PRIVATE_ARRANGE the buyer can pick it and skip the
  // courier picker. Collection-only items have no courier leg at all.
  const [method, setMethod] = useState<ShippingMethod>(
    isCollection
      ? 'COLLECTION'
      : allowedMethods[0] ?? (listing.isFirearm ? 'DEALER_TRANSFER' : 'COURIER'),
  );
  // The delivery picker only applies to the COURIER rail; a PRIVATE_ARRANGE
  // choice skips it entirely.
  const usesDeliveryPicker = !isCollection && method === 'COURIER';
  // The single door option the picker priced for this parcel + address.
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption | null>(
    null,
  );
  // Dealer-transfer self-arrange consent — the buyer must tick a box
  // acknowledging they'll organise the SAPS dealer transfer themselves
  // and upload SAPS 534 + stock register + firearm-serial photos after
  // delivery. We removed the dealer dropdown because our dealer DB
  // isn't comprehensive enough yet — let the buyer use any
  // SAPS-licensed dealer of their choice.


  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase-1 payment gate — card payments aren't live yet, so a checkout POST
  // returns 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);

  // P8a — units to buy. Only inventory-tracked BUY_NOW listings honour
  // quantity server-side (create-transaction.dto quantity, resolved to 1
  // for everything else). Cap at the sellable count so the buyer can't request
  // more than is in stock; the backend re-checks the counter atomically on
  // POST /transactions anyway. Model A: quantityAvailable already nets out
  // in-flight reservations, so it IS sellable — do not subtract
  // quantityReserved again (that double-counts and under-sells).
  // On a server-rendered reload the listing snapshot was fetched AFTER our
  // hold existed, so its own held unit is missing from quantityAvailable —
  // add it back. On a fresh page the client takes the hold after this
  // snapshot, so it is already counted.
  const holdUnitInSnapshot = holdIncludedInListing
    ? (initialHold?.quantity ?? 0)
    : 0;
  const maxQty = listing.trackInventory
    ? Math.max(1, (listing.quantityAvailable ?? 1) + holdUnitInSnapshot)
    : 1;
  const [quantity, setQuantity] = useState(1);

  // ─── Delivery instructions (Phase D) ────────────────────────────────
  // Courier-only free text printed on the delivery label: "leave at
  // reception", "ring the bell twice". The buyer opts in with a checkbox, and
  // an explicit Save turns the draft into the value `buildPayload()` sends —
  // so a half-typed note can never ride along with a payment. The backend
  // re-sanitises + caps at 120 chars and stores null on every non-courier
  // rail; this cap is the same number, not a second rule.
  const INSTRUCTIONS_MAX = 120;
  const [wantInstructions, setWantInstructions] = useState(false);
  const [instructionDraft, setInstructionDraft] = useState('');
  const [savedInstructions, setSavedInstructions] = useState<string | null>(null);
  const [instructionError, setInstructionError] = useState<string | null>(null);

  function toggleInstructions(checked: boolean) {
    setWantInstructions(checked);
    setInstructionError(null);
    if (!checked) {
      // Unchecking clears the note everywhere: draft, saved value and payload.
      setInstructionDraft('');
      setSavedInstructions(null);
    }
  }

  function saveInstructions() {
    const cleaned = instructionDraft
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, INSTRUCTIONS_MAX);
    if (!cleaned) {
      setInstructionError(
        'Add a short note first — for example "Leave at reception".',
      );
      return;
    }
    setInstructionDraft(cleaned);
    setSavedInstructions(cleaned);
    setInstructionError(null);
  }

  // Live shipping quote, refreshed whenever the buyer changes method or
  // their destination (the delivery address). Null while we're
  // waiting on the API; { error: string } when the quote endpoint
  // refused (firearm, oversize, etc); { quote: ShippingQuote } when
  // we have a usable price to show in the breakdown.
  const [quoteState, setQuoteState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; quote: ShippingQuote }
  >({ kind: 'idle' });

  // ── Effective delivery address ─────────────────────────────────────
  // ONE address state, like every other delivery surface: the address the
  // summary shows, the delivery picker prices and buildPayload ships. It is
  // seeded from the address book's default row (which includes the synthetic
  // `profile` row the backend prepends) and only falls back to the User.addr*
  // fields when that read fails. The address drawer edits this SAME state.
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<ManualAddressValue>(
    emptyManualAddress,
  );
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  // The address-book row this effective address came from, so the drawer can
  // open with it pre-selected and can tell when it has been edited/deleted.
  const [deliveryAddressId, setDeliveryAddressId] = useState<string | null>(null);
  // True once the book (or, on its failure, the /users/me fallback) has had its
  // say — the summary shows a loading line until then.
  const [addressBookLoaded, setAddressBookLoaded] = useState(false);
  // Set once the buyer picks/keeps an address themselves; a late async read
  // must never clobber that choice.
  const addressChosenRef = useRef(false);
  // Focus returns here when the drawer closes. Held explicitly because Safari
  // does not focus a <button> on click, so the trap's fallback would be <body>.
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const addressTriggerRef = useRef<HTMLButtonElement | null>(null);

  // AUDIT M33 — 18+/competency attestation for firearm checkouts. The
  // backend HARD-refuses any firearm transaction without the explicit
  // `true` flag, so this gate is mirrored on Pay/isReady. Non-firearm
  // checkouts ignore this state.


  // Collection-only papers acknowledgement — required for requiresPapers
  // listings (trailers / caravans). The backend refuses the transaction
  // without collectionPapersAccepted === true, so this gate is mirrored
  // on Pay/isReady. Ignored for listings that don't require papers.
  const [collectionPapersAck, setCollectionPapersAck] = useState(false);
  // Unconditional pre-payment acknowledgement — the buyer has seen where the
  // item is, and location/distance is not a refund ground. Applies to every
  // listing class, so unlike the two above it is not gated on a listing flag.



  // Read the address book once and seed the effective address from its
  // default row (the backend prepends the synthetic `profile` row, marked
  // default while no book row is default). A failure is non-fatal: the
  // /users/me fallback below still fills the old profile address.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url, headers } = await authedRequest('/users/me/addresses');
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as Address[];
        if (cancelled || !Array.isArray(rows)) return;
        if (addressChosenRef.current) return;
        const preferred =
          rows.find((a) => a.isDefault) ??
          rows.find((a) => a.id === 'profile') ??
          rows[0];
        if (preferred) {
          setDeliveryAddress({
            building: preferred.building ?? '',
            street: preferred.street,
            address2: preferred.address2 ?? '',
            suburb: preferred.suburb ?? '',
            city: preferred.city,
            postalCode: preferred.postalCode,
            province: preferred.province,
          });
          setDeliveryLat(preferred.lat ?? null);
          setDeliveryLng(preferred.lng ?? null);
          setDeliveryAddressId(preferred.id);
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
        // PRE-FETCH FALLBACK ONLY: the address book is the source of truth.
        // This fills the old profile values when the book read produced
        // nothing (failure, or a member with no usable address), and never
        // overwrites a choice the buyer has made.
        if (!addressChosenRef.current) {
          setDeliveryAddress((current) =>
            current.street.trim() || current.city.trim()
              ? current
              : {
                  building: data.addrBuilding ?? '',
                  street: data.addrStreet ?? '',
                  address2: data.addrAddress2 ?? '',
                  suburb: data.addrSuburb ?? '',
                  city: data.addrCity ?? '',
                  postalCode: data.addrPostalCode ?? '',
                  province: data.addrProvince ?? '',
                },
          );
          setDeliveryLat((current) =>
            current == null ? (data.addrLat ?? null) : current,
          );
          setDeliveryLng((current) =>
            current == null ? (data.addrLng ?? null) : current,
          );
        }
      } catch {
        // Non-fatal — the buyer can still select an address in the drawer.
      } finally {
        if (!cancelled) setMeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, actionToken]);

  // ── Effective-address helpers ──────────────────────────────────────
  // The one address state every downstream path reads. It is always enough to
  // show a summary row; a half-filled address is flagged incomplete rather
  // than hidden (the drawer is how the buyer fixes or replaces it).
  const hasDeliveryAddress = Boolean(
    deliveryAddress.street.trim() || deliveryAddress.city.trim(),
  );
  const deliverSummaryLine = [
    deliveryAddress.building,
    deliveryAddress.street,
    deliveryAddress.address2,
    deliveryAddress.suburb,
    deliveryAddress.city,
    deliveryAddress.postalCode,
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const deliverSummaryIncomplete =
    !deliveryAddress.street.trim() ||
    !deliveryAddress.suburb.trim() ||
    !deliveryAddress.city.trim() ||
    !deliveryAddress.postalCode.trim();

  /** Apply an address-book row to this order. */
  function applyDeliveryAddress(a: Address) {
    addressChosenRef.current = true;
    setDeliveryAddress({
      building: a.building ?? '',
      street: a.street,
      address2: a.address2 ?? '',
      suburb: a.suburb ?? '',
      city: a.city,
      postalCode: a.postalCode,
      province: a.province,
    });
    setDeliveryLat(a.lat ?? null);
    setDeliveryLng(a.lng ?? null);
    setDeliveryAddressId(a.id);
  }

  /**
   * The drawer's secondary action: use a typed address for THIS order only,
   * without writing the book (the token-checkout path).
   */
  function applyTypedDeliveryAddress(
    value: ManualAddressValue,
    lat: number | null,
    lng: number | null,
  ) {
    addressChosenRef.current = true;
    setDeliveryAddress(value);
    setDeliveryLat(lat);
    setDeliveryLng(lng);
    setDeliveryAddressId(null);
  }

  /**
   * The drawer saved/edited/deleted an address-book row. Keep the effective
   * address in step: an edit of the selected row refreshes it, and deleting
   * the selected row falls back default → next → none (exactly the rule the
   * server applies to the book itself).
   */
  function handleAddressesChanged(rows: Address[]) {
    // A typed one-off address has no book row to sync; leave it alone.
    if (!deliveryAddressId) return;
    const current = rows.find((a) => a.id === deliveryAddressId);
    if (current) {
      addressChosenRef.current = true;
      setDeliveryAddress({
        building: current.building ?? '',
        street: current.street,
        address2: current.address2 ?? '',
        suburb: current.suburb ?? '',
        city: current.city,
        postalCode: current.postalCode,
        province: current.province,
      });
      setDeliveryLat(current.lat ?? null);
      setDeliveryLng(current.lng ?? null);
      return;
    }
    const fallback = rows.find((a) => a.isDefault) ?? rows[0] ?? null;
    if (fallback) {
      applyDeliveryAddress(fallback);
    } else {
      addressChosenRef.current = true;
      setDeliveryAddress(emptyManualAddress);
      setDeliveryLat(null);
      setDeliveryLng(null);
      setDeliveryAddressId(null);
    }
  }

  // The address DeliveryOptionsPicker prices against — the SAME effective
  // address buildPayload ships to, so what the buyer was quoted is what we
  // book. Memoised on the individual fields because the picker re-fetches
  // whenever this prop changes identity; a fresh object every render would
  // loop it.
  const pickerAddress: DeliveryAddressInput = useMemo(
    () => ({
      streetAddress: deliveryAddress.street.trim(),
      suburb: deliveryAddress.suburb.trim(),
      city: deliveryAddress.city.trim(),
      postalCode: deliveryAddress.postalCode.trim(),
      province: deliveryAddress.province || '',
      lat: deliveryLat ?? undefined,
      lng: deliveryLng ?? undefined,
    }),
    [
      deliveryAddress.street,
      deliveryAddress.suburb,
      deliveryAddress.city,
      deliveryAddress.postalCode,
      deliveryAddress.province,
      deliveryLat,
      deliveryLng,
    ],
  );

  // A changed address invalidates whatever was chosen — the collection points
  // near the new address are DIFFERENT points at different prices. Drop the
  // choice and the quote it drove, so Pay can never submit against a price
  // that no longer exists.
  useEffect(() => {
    if (!usesDeliveryPicker) return;
    setDeliveryOption(null);
    setQuoteState({ kind: 'idle' });
  }, [usesDeliveryPicker, pickerAddress]);

  // The chosen option already carries its price for THIS parcel to THIS
  // address, so it feeds the existing quote state directly instead of firing a
  // second round-trip at /shipping/quote — same state, same order summary,
  // same Pay total as before.
  function handleSelectDeliveryOption(option: DeliveryOption) {
    setDeliveryOption(option);
    setMethod('COURIER');
    setQuoteState({
      kind: 'ready',
      quote: {
        serviceCode: option.serviceCode,
        providerSlug: option.providerSlug,
        serviceLevelCode: option.serviceLevelCode,
        // What the "Shipping (…)" line in the order summary names. Door rates
        // keep Bob Go's own service name; a Pargo counter is named by store,
        // never by Bob Go's "Click & Collect" product wording.
        serviceName:
          option.kind === 'STORE_PICKUP'
            ? pargoOptionLabel(option.detail)
            : (option.detail ?? 'Door delivery'),
        priceCents: option.priceCents,
      },
    });
  }

  // ─── Live shipping quote ──────────────────────────────────────────
  // The courier rate now arrives WITH the buyer's chosen option —
  // /shipping/delivery-options prices every option for this exact parcel and
  // this exact address, so handleSelectDeliveryOption above puts the clicked
  // price straight into quoteState. Re-asking /shipping/quote for the option
  // they just clicked would only add a round-trip and a second chance to
  // disagree with itself.
  //
  // What's left here is the other half of the old effect: everything that has
  // no courier rate at all (DEALER_TRANSFER / PRIVATE_ARRANGE / COLLECTION /
  // ON_SITE_SERVICE) goes back to idle, so a stale price can't survive a
  // method change.
  useEffect(() => {
    if (method !== 'COURIER') {
      setQuoteState({ kind: 'idle' });
    }
  }, [method]);

  function buildPayload() {
    // Collection papers acknowledgement - only meaningful (and only
    // accepted by the backend) for requiresPapers listings. Harmless to
    // omit otherwise.
    const papers = listing.requiresPapers
      ? { collectionPapersAccepted: collectionPapersAck }
      : {};
    const base = {
      listingId: listing.id,
      shippingMethod: method,
      // The rail the buyer chose. The backend locks it to the transaction and
      // routes the refund + seller payout through the same provider. Only sent
      // when the server actually returned one — never as a nil placeholder.
      ...(paymentProvider ? { paymentProvider } : {}),
      // P8a - units to buy. Backend resolves to 1 for non-tracked listings.
      ...(listing.trackInventory ? { quantity } : {}),
      // Claim the 15-minute reservation instead of reserving again. Omitted
      // when the hold could not be taken (e.g. an unsupported auth state), so
      // the backend's normal atomic reserve still protects the sale.
      ...(holdEligible && hold && !holdExpired ? { holdId: hold.holdId } : {}),
      ...papers,
    };
    // ON_SITE_SERVICE is retained on the union for historic rows; nothing in
    // this form can select it.
    if (method === 'ON_SITE_SERVICE') return base;
    // Collection — no courier, no address, no quote. Just the base payload
    // with shippingMethod = 'COLLECTION' (+ the papers ack when required).
    if (method === 'COLLECTION') return base;
    if (method === 'COURIER') {
      // Effective address: the ONE address state the summary showed, the
      // delivery picker priced and the address drawer edited. Contact name +
      // phone are still pulled from User on the backend — even when shipping
      // somewhere else we don't override identity.
      return {
        ...base,
        deliveryAddress: {
          building: deliveryAddress.building.trim() || undefined,
          streetAddress: deliveryAddress.street.trim(),
          address2: deliveryAddress.address2.trim() || undefined,
          suburb: deliveryAddress.suburb.trim(),
          city: deliveryAddress.city.trim(),
          province: deliveryAddress.province || '',
          postalCode: deliveryAddress.postalCode.trim(),
          lat: deliveryLat ?? undefined,
          lng: deliveryLng ?? undefined,
        },
        deliveryOption: deliveryOption?.kind,
        ...(deliveryOption?.kind === 'STORE_PICKUP'
          ? { pickupPointLocationId: deliveryOption.pickupPointLocationId }
          : {}),
        // Courier only, opt-in only, and only once the buyer pressed Save.
        // Never sent empty/whitespace — the backend persists null for that.
        ...(wantInstructions && savedInstructions
          ? { deliveryInstructions: savedInstructions }
          : {}),
      };
    }
    // Dealer-transfer: no dealerId — buyer picks their own SAPS
    // dealer and uploads the SAPS 534 + stock register + firearm-
    // serial photos after delivery. Backend accepts the txn without
    // a dealerId (DealerVerificationService gates payout instead).
    if (method === 'DEALER_TRANSFER') return base;
    if (method === 'PRIVATE_ARRANGE') {
      // The in-person handover terms (payment held until confirmation,
      // contact sharing and the non-refundable Platform Fee) are accepted
      // with the Terms at sign-up. This flag tells the backend to set
      // Transaction.privateArrangeAcceptedAt and unlocks the payout branch
      // in markPaid(); the server refuses PRIVATE_ARRANGE without it.
      return { ...base, privateArrangeConsent: true };
    }
    return base;
  }

  function isReady() {
    // The reservation is the permission to buy this unit. Without it (or once
    // it lapses) Pay must wait — the server would reject the stale hold anyway.
    if (holdEligible && (!hold || holdExpired || holding)) return false;
    // A rail the backend actually offered is required before Pay: neither the
    // loading state nor an empty/failed payment-methods read may fall through
    // to a fake default rail.
    if (paymentLoading || paymentProvider == null || paymentMethods.length === 0) {
      return false;
    }
    // Unconditional, and FIRST — ahead of the `method === 'COLLECTION'` early
    // return below, which would otherwise let a collection buyer pay without
    // ever ticking it. Mirrors the server gate in reserveAndCreateLine.
    // Hard gate — every buyer needs a phone on file before Pay enables
    // (the inline BuyerPhoneCapture block surfaces above when missing).
    // No phone = no dispatch SMS = lost parcel risk.
    // Hard gate — every buyer needs a VERIFIED phone and email before Pay
    // enables. A phone on file is not enough: an unverified number is a number
    // nobody proved they own, and the server refuses the checkout anyway
    // (CONTACT_UNVERIFIED). The inline block above links to /verify-phone.
    if (meLoaded && me && (!me.phone || !me.phoneVerified)) return false;
    if (meLoaded && me && me.emailVerifiedAt === null) return false;
    // M33 — firearm buyers must affirm 18+/competency.
    // Collection papers — buyers of requiresPapers listings must
    // acknowledge the in-person collection + papers handover.
    if (listing.requiresPapers && !collectionPapersAck) return false;


    // Collection — no courier, no address, no quote. Once the phone +
    // papers gates above pass, the buyer can pay.
    if (method === 'COLLECTION') return true;

    // COURIER needs the priced door rate — the buyer can't pay until we know
    // what the shipping line costs. DEALER_TRANSFER and PRIVATE_ARRANGE skip
    // the rate step entirely.
    if (method === 'COURIER') {
      // Door delivery needs coords for the destination — they're handed to the
      // courier to price and route the drop, and the backend re-quotes with
      // them on Pay. They belong to the ONE effective address above.
      const hasCoords = deliveryLat != null && deliveryLng != null;
      return !!deliveryOption && hasCoords && quoteState.kind === 'ready';
    }
    // The hand-over terms (dealer transfer and in-person) live in the Terms
    // at sign-up. There is no separate checkout acknowledgement.
    if (method === 'DEALER_TRANSFER') return true;
    if (method === 'PRIVATE_ARRANGE') return true;
    return false;
  }

  /**
   * Plain-language reason the Pay button is not ready. A silent grey button is
   * what the 2026-11-24 buyer report hit: after returning from the payment
   * page the delivery selection was gone and nothing on screen said why Pay
   * had stopped working.
   */
  function payBlockedReason(): string | null {
    if (submitting) return null;
    // No rail available (Peach-only launch state, or the read failed): say so
    // plainly instead of a silent disabled Pay button.
    if (!paymentLoading && (paymentProvider == null || paymentMethods.length === 0)) {
      return 'Card payments are temporarily unavailable — please try again shortly.';
    }
    if (meLoaded && me && (!me.phone || !me.phoneVerified)) {
      return 'Verify your phone number to continue.';
    }
    if (meLoaded && me && me.emailVerifiedAt === null) {
      return 'Verify your email address to continue.';
    }
    if (listing.requiresPapers && !collectionPapersAck) {
      return 'Acknowledge the collection papers above to continue.';
    }
    if (holdEligible && holding) return 'Reserving this item…';
    if (holdEligible && holdExpired) {
      return 'Your reservation expired — hold the item again to pay.';
    }
    if (holdEligible && !hold) return 'Reserving this item…';
    if (method === 'COURIER') {
      const hasCoords = deliveryLat != null && deliveryLng != null;
      if (!hasCoords) return 'Add a delivery address to see delivery options.';
      if (quoteState.kind === 'loading') return 'Pricing delivery…';
      if (quoteState.kind === 'error') return quoteState.message;
      if (!deliveryOption) {
        return 'Choose a delivery option above to continue.';
      }
    }
    return null;
  }

  // ─── Fee preview ──────────────────────────────────────────────────
  // Operator 2026-10: the listing price is the seller's raw ask. The buyer
  // pays ONE Platform Fee, calculated LAST on (item + delivery). Marketplace
  // fees are marginal 10/9/8/7; auctions are a flat 5% buyer share.
  // The actual numbers are re-computed server-side on Pay; this is display.
  //
  // ⚠️ THE MATHS LIVES IN lib/platform-fee.ts NOW, NOT HERE. It was copied
  // into this file, the offer checkout, the listing page and the sell form;
  // they agreed by luck rather than by construction, and this copy had already
  // drifted from the backend on the auction floor. `scripts/fee-sync.cjs` fails
  // the build if the shared copy and fee.calculator.ts ever disagree.
  function previewBreakdown(): {
    listing: number;
    shipping: number;
    handling: number;
    platform: number;
    total: number;
  } | null {
    if (!listing.price) return null;
    const item = listing.price * (listing.trackInventory ? quantity : 1);
    const shipping =
      quoteState.kind === 'ready' ? quoteState.quote.priceCents : 0;
    // Delivery is quoted at the courier's live rate (no margin since 2026-10-23).
    const handling = 0;
    const delivery = shipping + handling;
    // Auctions: 5% of (hammer + delivery), floored at R10 and capped at the
    // base. Marketplace: marginal bands on (item + delivery), floored at R10.
    const platform = platformFeeForCents(
      item + delivery,
      listing.listingType === 'AUCTION',
    );
    return {
      listing: item,
      shipping,
      handling,
      platform,
      total: item + delivery + platform,
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
        if (/launching soon/i.test(msg)) {
          setComingSoon(true);
          setSubmitting(false);
          return;
        }
        // The server refuses a second payable session while an unfinished one
        // exists — surface the resume panel instead of a wall of error text.
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
      // Pay claims the hold. Any failure (gateway, validation after the claim)
      // can leave the buyer holding nothing, so take a fresh reservation and
      // let the clock tell the truth.
      if (holdEligible) {
        holdRequestedRef.current = true;
        void ensureHold();
      }
    }
  }

  // Phase-1 payment gate — card payments aren't live yet.
  if (comingSoon) {
    return <PaymentsComingSoon backHref={`/listings/${listing.id}`} />;
  }

  // ─── Layout figures ───────────────────────────────────────────────
  // ONE source for the numbers the review column and the sticky summary both
  // show: previewBreakdown() is the display twin of the server's own maths.
  const breakdown = previewBreakdown();
  const summaryItemsCents = breakdown?.listing ?? 0;
  const summaryPlatformCents = breakdown?.platform ?? 0;
  const summaryTotalCents = breakdown?.total ?? 0;
  const summaryIsCourier = method === 'COURIER';
  const summaryDelivery = !summaryIsCourier
    ? { value: '—', muted: true }
    : quoteState.kind === 'ready'
      ? { value: formatPrice(breakdown?.shipping ?? 0), muted: false }
      : quoteState.kind === 'loading'
        ? { value: 'Calculating…', muted: true }
        : quoteState.kind === 'error'
          ? { value: '—', muted: true }
          : { value: 'Choose a delivery option', muted: true };
  // The sticky CTA opens the address drawer when the courier rail has nowhere
  // to send the parcel yet, instead of sitting disabled with no obvious fix.
  const needsDeliveryAddress =
    !isCollection && method === 'COURIER' && !hasDeliveryAddress;
  const payReady = isReady();
  const payBlocked = payBlockedReason();
  const isAuctionWin =
    listing.listingType === 'AUCTION' && listing.status === 'PAYMENT_PENDING';

  return (
    <>
      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-8 lg:items-start">
        {/* LEFT — the review column: how it arrives, when, where, quantity,
            consents, payment and the optional delivery note. */}
        <div className="min-w-0 space-y-6">
      {error && (
        <div
          className="px-4 py-3 rounded-[6px] text-sm"
          style={{ background: 'var(--red-wash)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Interrupted payment recovery (2026-11-24). Shown above everything:
          the buyer abandoned the hosted payment page and this checkout has an
          unpaid gateway attempt on it. Resume is primary; Start again is only
          accepted once the payment window has lapsed. */}
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
            You have an unfinished payment for this item
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            It wasn&apos;t completed. Resume it to avoid paying twice — or start
            again if the payment window has closed.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <a
              href={`/checkout/resume/${unpaidAttempt}`}
              className="px-4 py-2 rounded-[6px] text-sm font-medium"
              style={{
                background: 'var(--action-primary-bg)',
                color: '#fff',
                textDecoration: 'none',
              }}
            >
              Resume payment
            </a>
            <button
              type="button"
              onClick={() => void abandonUnpaidAttempt()}
              disabled={abandoningAttempt}
              className="px-4 py-2 rounded-[6px] text-sm"
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-visible)',
                cursor: abandoningAttempt ? 'not-allowed' : 'pointer',
                opacity: abandoningAttempt ? 0.6 : 1,
              }}
            >
              {abandoningAttempt ? 'Releasing…' : 'Start again'}
            </button>
          </div>
          {attemptActionError && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
              {attemptActionError}
            </p>
          )}
        </div>
      )}

      {/* Reservation clock, compact: one line + timer. The old block was a
          tall sticky card that pushed the actual form down the screen; only the
          expired state needs words. */}
      {holdEligible && (
        <div>
          <div
            role="timer"
            aria-live="polite"
            className="flex items-center gap-3 rounded-[6px] px-3 py-2"
            style={{
              background:
                holdExpired || holdError ? 'var(--red-wash)' : 'var(--bg-card)',
              border: `1px solid ${
                holdExpired || holdError
                  ? 'var(--red)'
                  : 'var(--border-visible)'
              }`,
            }}
          >
            <span
              className="text-xs"
              style={{
                color:
                  holdExpired || holdError
                    ? 'var(--red)'
                    : 'var(--text-secondary)',
                fontWeight: 500,
              }}
            >
              {holding || !hold
                ? 'Reserving this item…'
                : holdExpired
                  ? 'Reservation expired'
                  : 'Item reserved for you'}
            </span>
            <span
              className="ml-auto text-sm"
              aria-label={`${formatHold(holdMs)} left to pay`}
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
                color:
                  holdExpired || holdError
                    ? 'var(--red)'
                    : 'var(--text-primary)',
              }}
            >
              {holding || !hold
                ? '--:--'
                : holdExpired
                  ? '0:00'
                  : formatHold(holdMs)}
            </span>
          </div>
          {(holdExpired || holdError) && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
              {holdError ?? 'Your 15-minute reservation has expired.'}{' '}
              <button
                type="button"
                onClick={() => {
                  holdRequestedRef.current = true;
                  void ensureHold();
                }}
                disabled={holding}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--red)',
                  cursor: holding ? 'not-allowed' : 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                {holding ? 'Holding…' : 'Hold it again'}
              </button>
              {' · '}
              <Link
                href="/my/orders"
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                View my orders
              </Link>
            </p>
          )}
        </div>
      )}

      {/* Collection-only panel — replaces every courier surface (method
          selector, delivery address, quote line). The item is collected in
          person from the seller, so there is nothing to choose; the selected
          "Collect" card plus this copy is the whole delivery section. Once
          paid, we share contact details so both parties can coordinate a
          pickup time; payment is held until the buyer confirms collection. */}
      {isCollection && (
        <div
          className="rounded-[8px] p-4 text-sm space-y-2"
          style={{
            background: 'var(--action-option-selected-bg)',
            border: '1.5px solid var(--action-option-selected-edge)',
            color: 'var(--text-primary)',
            lineHeight: 1.55,
          }}
        >
          <p
            className="text-xs"
            style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}
          >
            Delivery method
          </p>
          <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Collect
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Collect in person from the seller
          </p>
          <p
            className="text-xs uppercase"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Collection only &mdash; {vicinityLabel(listing)}
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
              This item is in <strong>{vicinityLabel(listing)}</strong>. You
              can collect it yourself, or send your own transporter — it
              doesn&apos;t have to be you at the gate. After you pay,
              we&apos;ll share contact details so you can arrange the pickup. Your payment is held until you confirm the item is with
              you. ALL Outdoor doesn&apos;t arrange, quote or insure that
              transport.
            </p>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>
              You&apos;ll collect this item in person from the seller in{' '}
              <strong>{vicinityLabel(listing)}</strong>. After you pay,
              we&apos;ll share contact details so you can arrange a pickup
              time. Your payment is held until you confirm you&apos;ve
              collected it.
            </p>
          )}
        </div>
      )}

      {/* Delivery method — option cards. onSelect is the SAME setMethod, so
          state + payload are unchanged. A single legal method still renders
          as a selected card so the buyer can see how the item arrives;
          collection-only items rendered their own Collect card above. */}
      {allowedMethods.length > 0 && (
        <DeliveryMethodCards
          methods={allowedMethods}
          selected={method}
          onSelect={setMethod}
          isFirearm={listing.isFirearm}
          dealerName={listing.plannedDealerName}
          dealerLocation={listing.plannedDealerLocation}
        />
      )}

      {/* Delivery address — ONE row: the address that will be used, and one
          control to change it. "Select Delivery Address" when the book and the
          profile fallback are both empty. The address drawer (below) owns every
          write: adding, editing and deleting saved addresses all happen there,
          so there is no inline first-address capture form any more. */}
      {usesDeliveryPicker && (
        <div>
          {(actionToken ? !meLoaded : !addressBookLoaded) && !hasDeliveryAddress ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Loading your address…
            </p>
          ) : (
            <DeliveryAddressSummary
              label={hasDeliveryAddress ? 'Delivery to' : 'Select Delivery Address'}
              address={hasDeliveryAddress ? deliverSummaryLine : ''}
              incomplete={hasDeliveryAddress && deliverSummaryIncomplete}
              changeLabel={hasDeliveryAddress ? 'Change' : 'Select'}
              buttonRef={addressTriggerRef}
              onChange={() => setAddressDialogOpen(true)}
            />
          )}
        </div>
      )}

      {/* The address DRAWER. Every pick/add/edit/delete writes the same ONE
          effective-address state above, so the summary, the delivery picker's
          quote and the Pay payload can never disagree about the destination. */}
      {usesDeliveryPicker && addressDialogOpen && (
        <DeliveryAddressDialog
          returnFocusTo={addressTriggerRef.current}
          initialAddress={deliveryAddress}
          initialLat={deliveryLat}
          initialLng={deliveryLng}
          selectedAddressId={deliveryAddressId}
          getToken={getToken}
          recipient={{
            name: [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || null,
            phone: me?.phone ?? null,
          }}
          // A signed-out SMS-link checkout (actionToken) cannot reach the
          // session-only address book; it gets the typed address as a one-off.
          canSaveToBook={!actionToken}
          requireCoords
          onClose={() => setAddressDialogOpen(false)}
          onSelect={applyDeliveryAddress}
          onUseOnce={applyTypedDeliveryAddress}
          onAddressesChanged={handleAddressesChanged}
        />
      )}

      {/* Delivery date & time — Bob Go door-to-door is the only courier rail,
          so the priced options for THIS parcel to the address above are the
          buyer's delivery-date cards. The chosen option feeds the order
          summary and the payload. */}
      {usesDeliveryPicker && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Delivery date &amp; time
          </p>
          <DeliveryOptionsPicker
            listingId={listing.id}
            deliveryAddress={pickerAddress}
            onSelect={handleSelectDeliveryOption}
            getToken={getToken}
            // The courier is booked for the whole stack, so the price the
            // buyer sees has to be for the whole stack.
            quantity={listing.trackInventory ? quantity : 1}
          />
        </div>
      )}

      {/* Dealer transfer — self-arrange. We don't yet have a
          comprehensive SAPS dealer directory, so instead of forcing
          the buyer to pick from an incomplete dropdown we let them
          use any SAPS-licensed dealer of their choice. After the
          item lands at their dealer they upload 3 photos (SAPS 534
          + stock register last line + firearm with serial visible)
          and AI vision verifies before funds release to the
          seller. The verification flow lives at
          /transactions/[id]/dealer-verification (built in D1–D6). */}
      {/* Private arrangement — the handover terms (payment held until
          confirmation, contact sharing, non-refundable Platform Fee) are in
          the Terms of Service and accepted at sign-up, so there is no
          per-checkout consent block. The payload still carries the consent
          flag the backend requires. */}

      {/* M33 — 18+/competency attestation. Required by the backend
          for every firearm transaction. Rendered last in the consent
          stack so it's the buyer's final affirmation before Pay. */}
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
                border: '1px solid var(--border-visible)',
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
                border: '1px solid var(--border-visible)',
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

      {/* Payment method — the second decision in the review column. */}
      <PaymentMethodSection
        methods={paymentMethods}
        value={paymentProvider}
        onChange={setPaymentProvider}
      />

      {/* Delivery instructions — courier only, opt in, explicitly saved. The
          note goes on the carrier's delivery label, so it is capped at the
          same 120 characters the backend enforces and is never sent from a
          half-typed draft. */}
      {usesDeliveryPicker && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Delivery instructions
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={wantInstructions}
              onChange={(e) => toggleInstructions(e.target.checked)}
              style={{ marginTop: 3, accentColor: 'var(--red)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
              Want to add delivery instructions?
            </span>
          </label>
          {wantInstructions && (
            <div className="mt-3">
              <label
                htmlFor="checkout-delivery-instructions"
                className="text-xs"
                style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
              >
                For the driver — for example &quot;Leave at reception&quot;. It
                is printed on your delivery label.
              </label>
              <textarea
                id="checkout-delivery-instructions"
                value={instructionDraft}
                onChange={(e) => {
                  setInstructionDraft(e.target.value.slice(0, INSTRUCTIONS_MAX));
                  if (instructionError) setInstructionError(null);
                }}
                maxLength={INSTRUCTIONS_MAX}
                rows={2}
                placeholder="e.g. Leave at reception, ring the bell twice"
                aria-describedby="checkout-delivery-instructions-count"
                className="w-full mt-1.5 rounded-[6px] px-3 py-2 text-sm"
                style={{
                  background: 'var(--field-bg)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
              <div className="flex items-center justify-between gap-2 mt-1">
                <span
                  id="checkout-delivery-instructions-count"
                  aria-live="polite"
                  className="text-xs"
                  style={{
                    color: 'var(--text-tertiary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {instructionDraft.length}/{INSTRUCTIONS_MAX}
                </span>
                <button
                  type="button"
                  onClick={saveInstructions}
                  disabled={
                    !instructionDraft.trim() ||
                    instructionDraft.trim() === savedInstructions
                  }
                  className="px-3 py-1.5 rounded-[6px] text-xs flex-shrink-0"
                  style={{
                    background:
                      !instructionDraft.trim() ||
                      instructionDraft.trim() === savedInstructions
                        ? 'var(--bg-inset)'
                        : 'var(--action-secondary-bg)',
                    color:
                      !instructionDraft.trim() ||
                      instructionDraft.trim() === savedInstructions
                        ? 'var(--text-tertiary)'
                        : 'var(--action-secondary-ink)',
                    border: 'none',
                    fontWeight: 500,
                    cursor:
                      !instructionDraft.trim() ||
                      instructionDraft.trim() === savedInstructions
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {savedInstructions ? 'Update note' : 'Save note'}
                </button>
              </div>
              {savedInstructions && instructionDraft.trim() === savedInstructions && (
                <p className="text-xs mt-1" style={{ color: 'var(--success)' }}>
                  Saved — this note will be printed on your delivery label.
                </p>
              )}
              {instructionError && (
                <p
                  role="alert"
                  className="text-xs mt-1"
                  style={{ color: 'var(--red)' }}
                >
                  {instructionError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!payReady && payBlocked && (
        <p
          className="text-xs"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
        >
          {payBlocked}
        </p>
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
      {/* Verified contact points. Both are required before Pay — the server
          refuses a checkout whose buyer has not proven them (CONTACT_UNVERIFIED),
          so this is the visible half of that gate. `next` brings the buyer back
          to this exact checkout. */}
      {meLoaded && me && (me.phoneVerified === false || me.emailVerifiedAt === null) && (
        <div
          className="rounded-[6px] p-4 space-y-2"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-secondary)',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <p style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            Verify your contact details to continue
          </p>
          <p>
            We ask every buyer and seller to confirm their phone number and
            email address before money changes hands — it is how we reach you
            about delivery, and how we protect your account.
          </p>
          <p className="space-x-3">
            {me.phoneVerified === false && (
              <a
                href={`/verify-phone?next=${encodeURIComponent(
                  `/checkout/${listing.id}`,
                )}`}
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Verify your phone
              </a>
            )}
            {me.emailVerifiedAt === null && (
              <a
                href={`/verify-email?email=${encodeURIComponent(me.email)}`}
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Verify your email
              </a>
            )}
          </p>
        </div>
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
        </div>

        {/* RIGHT — sticky order summary + the single primary action. Hidden on
            phones, where the fixed bar below carries the same CTA state. */}
        <div className="hidden lg:block lg:sticky lg:top-20 min-w-0 mt-8 lg:mt-0">
          <CheckoutSummary
            item={{
              imageUrl:
                listing.images.find((i) => i.isPrimary)?.url ??
                listing.images[0]?.url ??
                null,
              title: listing.title,
              meta: `${CONDITION_LABELS[listing.condition] ?? listing.condition} · ${listing.category.name}`,
              sellerUsername: listing.seller.username ?? null,
              quantity: listing.trackInventory ? quantity : 1,
              priceCents: summaryItemsCents,
              details: [
                listing.make ? { label: 'Make', value: listing.make } : null,
                listing.model ? { label: 'Model', value: listing.model } : null,
                listing.calibre
                  ? { label: 'Calibre', value: listing.calibre }
                  : null,
              ].filter(
                (detail): detail is { label: string; value: string } =>
                  detail !== null,
              ),
            }}
            note={
              isAuctionWin
                ? 'Auction payment — the winning bidder must complete payment within the auction’s payment window.'
                : null
            }
            itemsCents={summaryItemsCents}
            delivery={summaryDelivery}
            platformFeeCents={summaryPlatformCents}
            totalCents={summaryTotalCents}
            needsAddress={needsDeliveryAddress}
            ready={payReady}
            submitting={submitting}
            blockedReason={payBlocked}
            onSelectAddress={() => setAddressDialogOpen(true)}
            onPay={handleProceed}
            isFirearm={listing.isFirearm}
          />
        </div>
      </div>

      {/* Mobile sticky pay bar. /checkout is a PUSH route (not a tab route),
          so the PWA tab bar is not rendered here and the bar sits flush at the
          bottom with safe-area padding — same pattern as the cart bar. */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 lg:hidden"
        style={{
          background: 'var(--bg-deep)',
          borderTop: '1px solid var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="max-w-[var(--page-max)] mx-auto px-4 py-3 flex items-center gap-3">
          <div className="min-w-0 flex-shrink-0">
            <p
              className="text-[11px] uppercase"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              Total
            </p>
            <p
              className="text-sm font-semibold"
              style={{
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatPrice(summaryTotalCents)}
            </p>
          </div>
          <CheckoutCta
            className="flex-1 min-w-0"
            needsAddress={needsDeliveryAddress}
            ready={payReady}
            submitting={submitting}
            totalCents={summaryTotalCents}
            blockedReason={payBlocked}
            onSelectAddress={() => setAddressDialogOpen(true)}
            onPay={handleProceed}
          />
        </div>
      </div>
      {/* Spacer so the fixed bar never covers the last review row. */}
      <div
        className="lg:hidden"
        aria-hidden
        style={{ height: 'calc(78px + env(safe-area-inset-bottom))' }}
      />
    </>
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
            background: 'var(--field-bg)',
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
            background: !valid || saving ? 'var(--bg-card)' : 'var(--action-primary-bg)',
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

// Pre-payment acknowledgement for collection-only listings whose papers are
// handed over at collection.
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
        background: 'var(--red-wash)',
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
          color: accepted ? 'var(--success)' : 'var(--text-tertiary)',
        }}
      >
        {accepted
          ? '✓ Acknowledged. You can proceed to payment below.'
          : 'Tick the box to enable payment.'}
      </p>
    </div>
  );
}
