'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth, SignInButton } from '../../lib/auth';
import {
  useCart,
  removeFromCart,
  setCartQuantity,
  getCart,
  clearCart,
  replaceCartItems,
  type CartItem,
} from '@/lib/cart-store';
import { NumberStepper } from '@/components/number-stepper';
import { formatPrice } from '@/lib/utils';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { usePaymentMethods } from '@/lib/payment-methods';
import { useWishlist } from '@/lib/use-wishlist';
import {
  CartDeliveryPicker,
  CartDeliveryToggle,
  type CartDeliveryOption,
  type CartDeliveryGroupView,
} from '@/components/cart-delivery-picker';
import {
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
import { TrustBullets } from '@/components/trust-bullets';
import { DeliveryAddressSummary } from '@/components/delivery-address-summary';
import { DeliveryAddressDialog } from '@/components/delivery-address-dialog';
import { Breadcrumbs, type Crumb } from '@/components/breadcrumbs';
import ItemDistance from '@/components/item-distance';
import { DistanceProvider } from '@/lib/distance-context';
import {
  buildCartCheckoutLines,
  cartClassGroups,
  courierClassGroups,
  groupCartBySellerAndClass,
  hasConflictedGroup,
  needsCollectionPapersAck,
  pruneCartDeliveryChoices,
  quoteGroupForClassGroup,
  readCartDeliveryChoices,
  saveCartDeliveryChoice,
  shippingTotalCents,
  type CartClassGroup,
  type CartSellerGroup,
} from '@/lib/cart-delivery';
import { cartItemsSubtotalCents, cartTotals } from '@/lib/cart-totals';
import {
  getPendingOrder,
  setPendingOrder,
  clearPendingOrder,
} from '@/lib/pending-order';
import {
  cartItemsFromOrder,
  orderLineListingId,
  type OrderDetail,
} from '@/lib/order-page';
import { removeOrderLine } from '@/lib/order-removal';
import { deliveryLabel } from '@/lib/delivery-methods';
import type { Address } from '@/lib/types';
import type { Me } from '@/lib/types';

// Two-crumb trail — Breadcrumbs renders nothing for fewer than two, so this
// is the shortest trail that still shows. Same on every state below (empty,
// payments-coming-soon, populated): the page's place in the site doesn't
// change with what's in the cart.
const CART_TRAIL: Crumb[] = [{ label: 'Home', href: '/' }, { label: 'Cart' }];

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// UX-M24 — live stock for one cart line, read from the PUBLIC listing payload
// (trackInventory / quantityAvailable are in PUBLIC_LISTING_SELECT). We
// deliberately do NOT trust the localStorage snapshot: a cart can sit for days
// while other buyers reserve units, so the quantity ceiling comes from the
// server every time /cart loads.
interface LineStock {
  trackInventory: boolean;
  sellable: number;
  // Screenshot review — seller-group header avatar. Piggybacks on this SAME
  // per-line /listings/:id read (no extra request).
  sellerAvatarUrl?: string | null;
}

interface GroupQuoteState {
  group: CartClassGroup;
  quote: CartDeliveryGroupView | null;
  option: CartDeliveryOption | undefined;
  unavailableReason?: string;
}

/** Human description of a group's chosen hand-over. */
function groupMethodDescription(group: CartClassGroup): string | undefined {
  return group.options.find((option) => option.method === group.method)
    ?.description;
}

export default function CartPage() {
  const items = useCart();
  const { getToken } = useAuth();
  // The payment picker is ENABLED now (operator 2026-11-27): the selected
  // provider rides on POST /orders/checkout and locks the single order capture.
  const {
    methods: paymentMethods,
    provider: paymentProvider,
    setProvider: setPaymentProvider,
    loading: paymentLoading,
  } = usePaymentMethods();
  // Save-for-later reads/writes the SAME wishlist store the heart icon uses.
  const wishlist = useWishlist();

  // Per seller+class toggle choice, persisted in localStorage (see
  // lib/cart-delivery.ts). Loaded after mount so SSR and the first client
  // render agree.
  const [deliveryChoices, setDeliveryChoices] = useState<Record<string, string>>(
    {},
  );
  // What the buyer chose, per parcel the cart will ship as. The groups are the
  // server's — the client must not compute parcel keys.
  const [chosenDelivery, setChosenDelivery] = useState<
    Record<string, CartDeliveryOption>
  >({});
  const [deliveryGroups, setDeliveryGroups] = useState<CartDeliveryGroupView[]>(
    [],
  );
  const [addr, setAddr] = useState<ManualAddressValue>(emptyManualAddress);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // The unpaid order this cart was already handed to the gateway for. While it
  // exists, Remove must hit the backend (the order owns the reserved lines) and
  // a reload shows a "resume payment" banner instead of pretending nothing
  // happened.
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState<'resume' | 'cancel' | null>(
    null,
  );
  // Collection-papers acknowledgement (trailers / caravans). One tick for the
  // whole cart; the backend refuses a requiresPapers line without it.
  const [collectionAck, setCollectionAck] = useState(false);
  // Phase-1 payment gate — card payments aren't live yet, so checkout POST may
  // return 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);
  // UX-M24 — live per-listing stock, keyed by listingId.
  const [stock, setStock] = useState<Record<string, LineStock>>({});
  // In-progress text for a quantity input, keyed by listingId.
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // In-flight listingId for "Save for later".
  const [savingId, setSavingId] = useState<string | null>(null);

  // ── Delivery block collapse — PRESENTATION ONLY ─────────────────────
  const [deliveryOpen, setDeliveryOpen] = useState(true);
  const [savedAddressPicked, setSavedAddressPicked] = useState(false);
  const deliveryUserToggledRef = useRef(false);
  const deliveryAutoCollapsedRef = useRef(false);
  const addrTouchedRef = useRef(false);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressBookLoaded, setAddressBookLoaded] = useState(false);
  const addressChosenRef = useRef(false);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const addressTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profilePrefilledRef = useRef(false);
  const profileFetchedRef = useRef(false);
  const pendingReconciledRef = useRef(false);

  // Read the persisted per-group toggle choices after mount (localStorage is
  // not available during SSR).
  useEffect(() => {
    setDeliveryChoices(readCartDeliveryChoices());
  }, []);

  // ── The approved grouping: seller → delivery class → ONE toggle ──────
  const sellerGroups: CartSellerGroup[] = groupCartBySellerAndClass(
    items,
    deliveryChoices,
  );
  const courierGroups = courierClassGroups(sellerGroups);
  const courierLines = courierGroups.flatMap((group) =>
    group.items.map((item) => ({
      listingId: item.listingId,
      quantity: item.quantity ?? 1,
    })),
  );
  const sellerNames: Record<string, string> = {};
  for (const item of items) {
    sellerNames[item.listingId] =
      item.sellerUsername?.trim() || 'Anonymous seller';
  }
  const conflicted = hasConflictedGroup(sellerGroups);
  const collectionAckNeeded = needsCollectionPapersAck(sellerGroups);

  // Save for later — adds the line to the wishlist, then removes it from the
  // cart. After a checkout attempt exists the backend owns the line, so this
  // is hidden; Remove is the only safe way to drop it then.
  async function saveForLater(listingId: string) {
    if (savingId) return;
    setSavingId(listingId);
    try {
      if (!wishlist.isSaved(listingId)) {
        await wishlist.toggle(listingId);
      }
      removeFromCart(listingId);
    } catch {
      // Wishlist write failed — leave the line in the cart rather than
      // losing it silently; the buyer can retry.
    } finally {
      setSavingId(null);
    }
  }

  // UX-M24 — fetch live stock for every line whenever the SET of listings
  // changes (not on every quantity tick).
  const ids = items
    .map((i) => i.listingId)
    .sort()
    .join(',');
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        ids.split(',').map(async (id) => {
          try {
            const res = await fetch(`${API_URL}/listings/${id}`);
            if (!res.ok) return null;
            const l = await res.json();
            const trackInventory = Boolean(l?.trackInventory);
            return [
              id,
              {
                trackInventory,
                sellerAvatarUrl: l?.seller?.avatarUrl ?? null,
                // Model A — quantityAvailable already nets reservations.
                sellable: trackInventory
                  ? Math.max(0, l.quantityAvailable ?? 0)
                  : 1,
              },
            ] as const;
          } catch {
            // Network blip — leave the line un-ceilinged (max 1).
            return null;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, LineStock> = {};
      for (const r of results) if (r) map[r[0]] = r[1];
      setStock(map);
      // Clamp anything the buyer banked earlier that no longer fits.
      for (const [id, s] of Object.entries(map)) {
        const line = getCart().find((i) => i.listingId === id);
        if (!line) continue;
        const ceiling = Math.max(1, s.sellable);
        if ((line.quantity ?? 1) > ceiling) setCartQuantity(id, ceiling);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  // Live per-line stock ceiling: firearms and untracked items are 1 unit.
  const maxQtyFor = (listingId: string, isFirearm: boolean): number => {
    if (isFirearm) return 1;
    const s = stock[listingId];
    if (!s || !s.trackInventory) return 1;
    return s.sellable;
  };

  const soldOutItems = items.filter((i) => {
    const s = stock[i.listingId];
    return !i.isFirearm && s?.trackInventory && s.sellable <= 0;
  });

  // Defence in depth: the catalog writer only puts BUY_NOW lines in the cart,
  // but a legacy/hand-edited row claiming another listing type would poison
  // the WHOLE order server-side. Name it here instead of letting Pay fail.
  const unsupportedTypeItems = items.filter(
    (item) => item.listingType != null && item.listingType !== 'BUY_NOW',
  );

  // Money + counts are per-UNIT now: a line is unitPrice × quantity.
  const itemsSubtotal = cartItemsSubtotalCents(items);
  const unitCount = items.reduce(
    (s, i) => s + Math.max(1, i.quantity ?? 1),
    0,
  );

  /** Map an address-book row onto the cart's field shape. */
  function toManualAddress(a: Address): ManualAddressValue {
    return {
      building: a.building ?? '',
      street: a.street,
      address2: a.address2 ?? '',
      suburb: a.suburb ?? '',
      city: a.city,
      postalCode: a.postalCode,
      province: a.province,
    };
  }

  // Fetch the member's default address once so the cart can open on it.
  useEffect(() => {
    if (profileFetchedRef.current) return;
    profileFetchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const bookRes = await fetch(`${API_URL}/users/me/addresses`, {
          headers,
          cache: 'no-store',
        });
        if (bookRes.ok) {
          const rows = (await bookRes.json()) as Address[];
          if (cancelled || !Array.isArray(rows) || addressChosenRef.current) {
            return;
          }
          const preferred =
            rows.find((a) => a.isDefault) ??
            rows.find((a) => a.id === 'profile') ??
            rows[0];
          if (preferred) {
            profilePrefilledRef.current = true;
            setAddr((prev) =>
              prev.street.trim() || prev.city.trim()
                ? prev
                : toManualAddress(preferred),
            );
            setAddressId(preferred.id);
            setSavedAddressPicked(true);
            return;
          }
        }
        const res = await fetch(`${API_URL}/users/me`, {
          headers,
          cache: 'no-store',
        });
        if (!res.ok) return;
        const me = (await res.json()) as Me;
        if (cancelled || addressChosenRef.current) return;
        if (!me?.addrStreet && !me?.addrCity) return;
        const fallback: ManualAddressValue = {
          building: me.addrBuilding ?? '',
          street: me.addrStreet ?? '',
          address2: me.addrAddress2 ?? '',
          suburb: me.addrSuburb ?? '',
          city: me.addrCity ?? '',
          postalCode: me.addrPostalCode ?? '',
          province: (me.addrProvince as ManualAddressValue['province']) ?? '',
        };
        profilePrefilledRef.current = true;
        setAddr((prev) =>
          prev.street.trim() || prev.city.trim() ? prev : fallback,
        );
        setSavedAddressPicked(true);
      } catch {
        // Non-fatal — the drawer's add form is the fallback.
      } finally {
        if (!cancelled) setAddressBookLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reconcile an existing unpaid-order marker once on load ─────────────
  // A paid order means those items are bought: drop their cart lines and the
  // marker. A cancelled/gone order just clears the marker (the cart lines stay
  // so the buyer can try again). An awaiting-payment order shows the resume
  // banner.
  useEffect(() => {
    if (pendingReconciledRef.current) return;
    pendingReconciledRef.current = true;
    const marker = getPendingOrder();
    if (!marker) return;
    setPendingOrderId(marker.orderId);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_URL}/orders/${encodeURIComponent(marker.orderId)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: 'no-store',
          },
        );
        if (!res.ok) {
          // ONLY a 404 proves the order is gone. A 401/5xx/network blip must
          // keep the marker — clearing it would make Remove delete locally and
          // desync the still-live reservation.
          if (res.status === 404) {
            clearPendingOrder();
            setPendingOrderId(null);
          }
          return;
        }
        const order = (await res.json()) as OrderDetail;
        if (order.status === 'AWAITING_PAYMENT') return;
        if (['PAID', 'PARTIALLY_FULFILLED', 'COMPLETED'].includes(order.status)) {
          // Payment settled elsewhere (webhook / order page) — the reserved
          // lines are bought now, so they leave the cart.
          const listingIds =
            marker.listingIds?.length
              ? marker.listingIds
              : (order.lineItems ?? []).map((line) => orderLineListingId(line));
          for (const listingId of listingIds) {
            if (listingId) removeFromCart(listingId);
          }
        }
        clearPendingOrder();
        setPendingOrderId(null);
      } catch {
        // Offline — keep the marker; the complete page / order page still own
        // the truth, and Remove stays backend-gated.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addrComplete =
    addr.street.trim() &&
    addr.suburb.trim() &&
    addr.city.trim() &&
    addr.province &&
    addr.postalCode.trim().length >= 4;
  // The address in the shape the quoting endpoint takes.
  const pickerAddress = addrComplete
    ? {
        streetAddress: addr.street.trim(),
        suburb: addr.suburb.trim(),
        city: addr.city.trim(),
        postalCode: addr.postalCode.trim(),
        province: addr.province,
      }
    : null;

  // Changing the address invalidates every price already chosen against the
  // old one.
  useEffect(() => {
    setChosenDelivery({});
    if (addrTouchedRef.current) setDeliveryOpen(true);
    else addrTouchedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr.street, addr.suburb, addr.city, addr.postalCode, addr.province]);

  // The buyer needs an address only when at least one seller group chose
  // Courier. Private / firearm / collection-only carts need none.
  const needsAddress = courierGroups.length > 0;

  /** The server quote group pricing one seller's courier group + its choice. */
  const quoteFor = (group: CartClassGroup) =>
    quoteGroupForClassGroup(group, deliveryGroups);

  const courierStates: GroupQuoteState[] = courierGroups.map((group) => {
    const quote = quoteFor(group);
    const option = quote ? chosenDelivery[quote.groupKey] : undefined;
    return {
      group,
      quote,
      option,
      unavailableReason: quote?.unavailableReason,
    };
  });
  const courierQuotesReady = courierStates.every(
    (state) => !!state.quote && !state.unavailableReason && !!state.option,
  );
  const courierReady = !needsAddress || (Boolean(addrComplete) && courierQuotesReady);

  // One shipping row/price per seller accessories group.
  const shippingRows = courierStates.map((state) => ({
    group: state.group,
    sellerName: state.group.sellerName,
    label: state.option?.label,
    cents: state.option?.priceCents ?? null,
    unavailableReason: state.unavailableReason,
  }));
  const deliveryTotalCents = shippingTotalCents(
    sellerGroups,
    deliveryGroups,
    chosenDelivery,
  );
  // ONE Platform Fee on items + delivery for the WHOLE cart.
  const totals = cartTotals(itemsSubtotal, deliveryTotalCents);

  const everyCourierGroupChosen = courierStates.every(
    (state) => !state.unavailableReason && !!state.option,
  );
  const deliveryDestination = addrComplete
    ? [addr.building.trim(), addr.street.trim(), addr.suburb.trim()]
        .filter(Boolean)
        .slice(0, 2)
        .join(', ')
    : null;
  const addressLine = [
    addr.building.trim(),
    addr.street.trim(),
    addr.address2.trim(),
    addr.suburb.trim(),
    addr.city.trim(),
    addr.postalCode.trim(),
  ]
    .filter(Boolean)
    .join(', ');
  const hasDeliveryAddress = Boolean(addr.street.trim() || addr.city.trim());

  // Auto-collapse the delivery block ONCE: a saved address is present and
  // every courier group has a priced choice.
  useEffect(() => {
    if (
      deliveryAutoCollapsedRef.current ||
      deliveryUserToggledRef.current ||
      !deliveryOpen ||
      !savedAddressPicked ||
      courierGroups.length === 0 ||
      !everyCourierGroupChosen ||
      !addrComplete
    ) {
      return;
    }
    deliveryAutoCollapsedRef.current = true;
    setDeliveryOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deliveryOpen,
    savedAddressPicked,
    courierGroups.length,
    everyCourierGroupChosen,
    addrComplete,
  ]);

  // ── Remove a line ──────────────────────────────────────────────────────
  // No unpaid order → delete locally and re-quote INSTANTLY.
  // Unpaid order → the backend owns the reserved lines: DELETE the line, sync
  // the cart to the order it returns, then hand off to the new payment session
  // (or the cancelled/empty state when it was the last line).
  function pruneAfterRemoval(remaining: CartItem[]) {
    const validKeys = cartClassGroups(remaining).map((group) => group.key);
    setDeliveryChoices(pruneCartDeliveryChoices(validKeys));
    setChosenDelivery((prev) => {
      const remainingIds = new Set(
        remaining.map((item) => item.listingId),
      );
      const next = { ...prev };
      for (const group of deliveryGroups) {
        if (!group.listingIds.some((id) => remainingIds.has(id))) {
          delete next[group.groupKey];
        }
      }
      return next;
    });
  }

  function removeLocally(listingId: string) {
    const remaining = items.filter((item) => item.listingId !== listingId);
    removeFromCart(listingId);
    pruneAfterRemoval(remaining);
  }

  async function removeLine(item: CartItem) {
    if (removingId) return;
    setRemoveError(null);
    if (!pendingOrderId) {
      removeLocally(item.listingId);
      return;
    }
    setRemovingId(item.listingId);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      // The DELETE endpoint takes the line's TRANSACTION id, so read the order
      // first. If it is gone, fall back to a local delete.
      const orderRes = await fetch(
        `${API_URL}/orders/${encodeURIComponent(pendingOrderId)}`,
        { headers, cache: 'no-store' },
      );
      if (!orderRes.ok) {
        clearPendingOrder();
        setPendingOrderId(null);
        removeLocally(item.listingId);
        return;
      }
      const order = (await orderRes.json()) as OrderDetail;
      const line = (order.lineItems ?? []).find(
        (entry) => orderLineListingId(entry) === item.listingId,
      );
      const transactionId = line?.transaction?.id;
      if (!transactionId) {
        // The order no longer contains this line — sync to it locally.
        const nextItems = cartItemsFromOrder(order, items);
        if (nextItems.length === 0) {
          clearCart();
          clearPendingOrder();
          setPendingOrderId(null);
          return;
        }
        replaceCartItems(nextItems);
        setPendingOrder({
          orderId: pendingOrderId,
          listingIds: nextItems.map((entry) => entry.listingId),
        });
        pruneAfterRemoval(nextItems);
        return;
      }

      const outcome = await removeOrderLine({
        orderId: pendingOrderId,
        transactionId,
        request: (path, init) =>
          fetch(`${API_URL}${path}`, {
            ...init,
            headers: {
              'Content-Type': 'application/json',
              ...headers,
              ...(init.headers ?? {}),
            },
            cache: 'no-store',
          }),
      });
      if (outcome.kind === 'paid') {
        // Already paid — the order is no longer editable. Drop the marker and
        // send the buyer to the order, where the paid lines live.
        clearPendingOrder();
        setPendingOrderId(null);
        window.location.href = `/orders/${encodeURIComponent(pendingOrderId)}`;
        return;
      }
      if (outcome.kind === 'error') {
        throw new Error(outcome.message);
      }
      if (outcome.kind === 'cancelled') {
        // Removing the last line cancels the unpaid order and empties the cart.
        clearCart();
        clearPendingOrder();
        setPendingOrderId(null);
        return;
      }
      // Sync the cart to the order the backend just returned — the server owns
      // which lines are still in the paid attempt.
      const nextItems = cartItemsFromOrder(outcome.order, items);
      replaceCartItems(nextItems);
      setPendingOrder({
        orderId: pendingOrderId,
        listingIds: nextItems.map((entry) => entry.listingId),
      });
      pruneAfterRemoval(nextItems);
      // A new payment session must be taken out for the new order total —
      // the old gateway session only covers the old amount.
      if (outcome.redirectUrl) {
        window.location.href = outcome.redirectUrl;
      }
    } catch (e) {
      setRemoveError(
        e instanceof Error ? e.message : 'Could not remove that item.',
      );
    } finally {
      setRemovingId(null);
    }
  }

  // ── Toggle a seller+class group ────────────────────────────────────────
  function chooseGroupMethod(groupKey: string, method: string) {
    setDeliveryChoices(saveCartDeliveryChoice(groupKey, method));
    // The courier line set may have changed: drop this group's stale quote
    // choice (and ONLY this group's — every other seller's quote stays).
    setChosenDelivery((prev) => {
      const group = sellerGroups
        .flatMap((seller) => seller.classes)
        .find((entry) => entry.key === groupKey);
      if (!group) return prev;
      const quote = quoteFor(group);
      if (!quote || !(quote.groupKey in prev)) return prev;
      const next = { ...prev };
      delete next[quote.groupKey];
      return next;
    });
  }

  // ── Pending-order banner actions ───────────────────────────────────────
  async function resumePendingOrder() {
    if (!pendingOrderId || pendingBusy) return;
    setPendingBusy('resume');
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/orders/${encodeURIComponent(pendingOrderId)}/resume`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string;
        paid?: boolean;
        cancelled?: boolean;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.message || 'Could not resume this payment.');
      }
      if (data.paid) {
        clearPendingOrder();
        setPendingOrderId(null);
        window.location.href = `/orders/${encodeURIComponent(pendingOrderId)}`;
        return;
      }
      if (data.cancelled) {
        clearPendingOrder();
        setPendingOrderId(null);
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      throw new Error('The payment gateway did not return a payment link.');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not resume this payment.',
      );
    } finally {
      setPendingBusy(null);
    }
  }

  async function cancelPendingOrder() {
    if (!pendingOrderId || pendingBusy) return;
    setPendingBusy('cancel');
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/orders/${encodeURIComponent(pendingOrderId)}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      if (!res.ok) {
        const message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message;
        throw new Error(message || 'Could not cancel this order.');
      }
      clearPendingOrder();
      setPendingOrderId(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not cancel this order.',
      );
    } finally {
      setPendingBusy(null);
    }
  }

  // ── Checkout ───────────────────────────────────────────────────────────
  const checkoutDisabled =
    submitting ||
    items.length === 0 ||
    // An unpaid order already owns these reservations. Starting a second
    // checkout here would either reserve the same items twice or fail deep in
    // the shared core; the banner above is the one path forward (resume or
    // cancel), so the CTA must not pretend otherwise.
    Boolean(pendingOrderId) ||
    soldOutItems.length > 0 ||
    unsupportedTypeItems.length > 0 ||
    conflicted ||
    !courierReady ||
    (collectionAckNeeded && !collectionAck) ||
    paymentProvider == null ||
    Boolean(removingId);

  const checkoutLabel = submitting
    ? 'Creating your order…'
    : pendingOrderId
      ? 'Resume or cancel your unpaid order above'
      : unsupportedTypeItems.length > 0
      ? 'Remove the unavailable item to continue'
      : soldOutItems.length > 0
        ? 'Remove the sold-out item to continue'
        : conflicted
          ? 'Remove one item from this seller to continue'
          : needsAddress && !addrComplete
            ? 'Enter a delivery address to continue'
            : needsAddress && !courierQuotesReady
              ? 'Delivery isn’t available for this address'
              : collectionAckNeeded && !collectionAck
                ? 'Confirm the collection details to continue'
                : paymentLoading
                  ? 'Loading payment methods…'
                  : paymentProvider == null
                    ? 'Payment is temporarily unavailable'
                    : 'Continue to payment';

  async function checkout() {
    if (checkoutDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Please sign in to check out.');
        return;
      }
      const lines = buildCartCheckoutLines(sellerGroups, {
        quoteForGroup: quoteFor,
        chosenQuotes: chosenDelivery,
        deliveryAddress: needsAddress ? pickerAddress : null,
        collectionPapersAccepted: collectionAck,
      });
      const res = await fetch(`${API_URL}/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lines,
          ...(paymentProvider ? { paymentProvider } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        orderId?: string;
        redirectUrl?: string;
        paymentId?: string;
        code?: string;
        transactionId?: string;
        message?: string | string[];
        orderIdFromError?: string;
      };
      // Payment gate: the API returns 503 "card payments are launching soon"
      // until PAYMENTS_LIVE. That's the friendly gate, not a failed checkout.
      if (
        res.status === 503 ||
        /launching soon|coming soon/i.test(
          Array.isArray(data.message)
            ? data.message.join(' ')
            : (data.message ?? ''),
        )
      ) {
        setComingSoon(true);
        return;
      }
      if (res.status === 409) {
        // An unfinished payment for ONE of these items already exists — the
        // shared checkout core refuses to reserve it twice. The body names the
        // attempt's transaction id, and the resume flow is the actionable
        // next step (never a dead-end error, never a second attempt).
        if (
          data.code === 'UNPAID_CHECKOUT_EXISTS' &&
          data.transactionId
        ) {
          window.location.href = `/checkout/resume/${encodeURIComponent(data.transactionId)}`;
          return;
        }
        // An unfinished ORDER: send the buyer to the order page, where Resume
        // lives, rather than a red wall of error text.
        const existingOrderId = data.orderId ?? data.orderIdFromError;
        if (existingOrderId) {
          setPendingOrder({
            orderId: existingOrderId,
            listingIds: items.map((item) => item.listingId),
          });
          window.location.href = `/orders/${encodeURIComponent(existingOrderId)}`;
          return;
        }
      }
      if (!res.ok) {
        const message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message;
        if (
          pendingOrderId &&
          /no longer available|unpaid|awaiting payment|could not release/i.test(
            message ?? '',
          )
        ) {
          throw new Error(
            'These items are reserved by your unpaid order. Resume or cancel it above before starting a new checkout.',
          );
        }
        throw new Error(
          message ||
            'Checkout failed. An item may no longer be available — refresh and try again.',
        );
      }
      // 200: one order payment session. Store the marker BEFORE leaving the
      // origin so the complete page and the cart can find the order again.
      const { orderId, redirectUrl, paymentId } = data;
      if (!orderId) {
        throw new Error('Checkout did not return an order. Please try again.');
      }
      if (redirectUrl) {
        setPendingOrder({
          orderId,
          listingIds: items.map((item) => item.listingId),
        });
        window.location.href = redirectUrl;
        return;
      }
      // No live gateway to hand off to (mock / not configured) — the same
      // friendly gate the single-item checkout shows.
      setComingSoon(true);
      return;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong reaching checkout. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Phase-1 payment gate — card payments aren't live yet ──
  if (comingSoon) {
    return (
      <main className="max-w-[var(--content-max)] mx-auto px-4 py-8">
        <Breadcrumbs trail={CART_TRAIL} className="mb-6" />
        <PaymentsComingSoon />
      </main>
    );
  }

  // ── Empty cart ──
  if (items.length === 0) {
    return (
      <main className="max-w-[var(--content-max)] mx-auto px-4 py-16 text-center">
        <Breadcrumbs trail={CART_TRAIL} className="mb-6 justify-center" />
        <h1 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          Your cart is empty
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Add buy-now items to your cart and check out in one payment. Each
          seller ships their own parcel.
        </p>
        <Link
          href="/"
          className="inline-block text-sm px-5 py-2.5 rounded-[6px]"
          style={{ background: 'var(--action-primary-bg)', color: '#fff', fontWeight: 500 }}
        >
          Browse the marketplace
        </Link>
      </main>
    );
  }

  const groupCount = sellerGroups.length;

  return (
    <DistanceProvider ids={items.map((item) => item.listingId)}>
      <main className="max-w-[var(--content-max)] mx-auto px-4 py-8">
        <Breadcrumbs trail={CART_TRAIL} className="mb-6" />
        <h1 className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Your cart
        </h1>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          {groupCount === 1 ? (
            <>All from <strong>{sellerGroups[0].sellerName}</strong>. </>
          ) : (
            <>From <strong>{groupCount} sellers</strong> — each seller ships and is paid
            separately. </>
          )}
          One payment. You choose delivery once per seller group; the Platform
          Fee is charged once on the whole cart.
        </p>

        {/* Unpaid order banner — the cart was already handed to the gateway. */}
        {pendingOrderId && (
          <div
            className="rounded-[8px] p-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-2"
            style={{ border: '1px solid var(--warning)', background: 'var(--warning-wash)' }}
          >
            <p className="text-xs flex-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              You have an unpaid payment for this cart. Removing an item updates
              that order and opens a fresh payment session — or resume the
              existing one rather than paying twice.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={resumePendingOrder}
                disabled={pendingBusy != null}
                aria-busy={pendingBusy === 'resume'}
                className="text-xs px-3 py-1.5 rounded-[6px]"
                style={{
                  background: 'var(--action-primary-bg)',
                  color: '#fff',
                  fontWeight: 500,
                  cursor: pendingBusy ? 'wait' : 'pointer',
                }}
              >
                {pendingBusy === 'resume' ? 'Opening…' : 'Resume payment'}
              </button>
              <button
                type="button"
                onClick={cancelPendingOrder}
                disabled={pendingBusy != null}
                aria-busy={pendingBusy === 'cancel'}
                className="text-xs px-3 py-1.5 rounded-[6px]"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-visible)',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  cursor: pendingBusy ? 'wait' : 'pointer',
                }}
              >
                {pendingBusy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          </div>
        )}

        {/* Board — two-pane layout: content takes the remaining width, order
            summary is a 344px sticky sidebar. Unwinds to one column below lg. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_344px] gap-5 items-start">
          <div className="min-w-0">
            {/* Items — grouped by SELLER, then DELIVERY CLASS. Exactly ONE
                toggle per class group controls every line in it; there are no
                per-item delivery controls anywhere. */}
            {sellerGroups.map((seller) => (
              <div
                key={seller.sellerId}
                className="rounded-[8px] mb-4 overflow-hidden"
                style={{ border: '0.5px solid var(--border)' }}
              >
                <div
                  className="px-3 py-2 flex items-center gap-2 text-xs"
                  style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
                >
                  {seller.classes[0]?.items[0] &&
                  stock[seller.classes[0].items[0].listingId]?.sellerAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={stock[seller.classes[0].items[0].listingId]!.sellerAvatarUrl!}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                      style={{ background: 'var(--bg-card)' }}
                    />
                  ) : (
                    <div
                      className="w-6 h-6 rounded-full flex-shrink-0"
                      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
                    />
                  )}
                  <span style={{ fontWeight: 500 }}>{seller.sellerName}</span>
                  <span className="ml-auto">
                    {seller.classes.length > 1
                      ? 'two delivery groups'
                      : 'one delivery group'}
                  </span>
                </div>

                {seller.classes.map((group) => {
                  const courierIndex = courierStates.findIndex(
                    (state) => state.group.key === group.key,
                  );
                  const courierState =
                    courierIndex >= 0 ? courierStates[courierIndex] : null;
                  return (
                    <section
                      key={group.key}
                      aria-label={`${group.deliveryClass === 'FIREARM' ? 'Firearms' : 'Accessories'} from ${seller.sellerName}`}
                      style={{ borderTop: '0.5px solid var(--border)' }}
                    >
                      {/* Group header — the ONE toggle for every line below. */}
                      <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className="text-xs m-0"
                            style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                          >
                            {group.deliveryClass === 'FIREARM'
                              ? 'Firearms'
                              : 'Accessories'}
                          </p>
                          <p className="text-[11px] m-0" style={{ color: 'var(--text-tertiary)' }}>
                            {group.options.find((o) => o.method === group.method)
                              ?.description ?? groupMethodDescription(group)}
                          </p>
                        </div>
                        <CartDeliveryToggle
                          group={group}
                          onChange={chooseGroupMethod}
                        />
                      </div>

                      {group.conflicted && (
                        <p
                          className="px-3 py-2 text-xs m-0"
                          style={{ background: 'var(--red-wash)', color: 'var(--red)', lineHeight: 1.5 }}
                        >
                          These items need different delivery methods, so they
                          can’t share one seller group. Remove one to continue.
                        </p>
                      )}

                      {group.items.map((item) => {
                        const units = Math.max(1, item.quantity ?? 1);
                        const max = maxQtyFor(item.listingId, item.isFirearm);
                        const lineSoldOut = soldOutItems.includes(item);
                        const lineInvalid = unsupportedTypeItems.includes(item);
                        const busy = removingId === item.listingId;
                        return (
                          <div
                            key={item.listingId}
                            className="flex items-center gap-3 p-3"
                            style={{ borderTop: '0.5px solid var(--border)' }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.title}
                                className="w-12 h-12 rounded-[6px] object-cover"
                                style={{ background: 'var(--bg-inset)' }}
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-[6px]" style={{ background: 'var(--bg-inset)' }} />
                            )}
                            <div className="flex-1 min-w-0">
                              <Link
                                href={`/listings/${item.listingId}`}
                                className="block text-sm truncate"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {item.title}
                              </Link>
                              <span
                                className="block text-[11px] mt-0.5"
                                style={{ color: 'var(--text-tertiary)' }}
                              >
                                <ItemDistance listingId={item.listingId} />
                              </span>

                              {/* Sold out / wrong type beat the stepper. A
                                  pending order owns the quantities too — the
                                  only safe edit then is Remove (which opens a
                                  new payment session). */}
                              {lineInvalid ? (
                                <p className="text-xs mt-1.5" style={{ color: 'var(--red)', lineHeight: 1.4 }}>
                                  This item can’t be bought in a cart — remove
                                  it to continue.
                                </p>
                              ) : lineSoldOut ? (
                                <p className="text-xs mt-1.5" style={{ color: 'var(--red)', lineHeight: 1.4 }}>
                                  Sold out while it sat in your cart — remove it to continue.
                                </p>
                              ) : pendingOrderId ||
                                group.deliveryClass === 'FIREARM' ? null : max > 1 ? (
                                <div
                                  className="mt-2 flex items-center gap-2"
                                  onBlur={() =>
                                    setQtyDraft((draft) => {
                                      if (!(item.listingId in draft)) return draft;
                                      const next = { ...draft };
                                      delete next[item.listingId];
                                      return next;
                                    })
                                  }
                                >
                                  <div className="w-[136px] sm:w-[108px]">
                                    <NumberStepper
                                      value={qtyDraft[item.listingId] ?? String(units)}
                                      min={1}
                                      max={max}
                                      aria-label={`Quantity for ${item.title}`}
                                      onChange={(next) => {
                                        setQtyDraft((draft) => ({
                                          ...draft,
                                          [item.listingId]: next,
                                        }));
                                        const n = Number.parseInt(next, 10);
                                        if (!Number.isFinite(n) || n < 1) return;
                                        const clamped = Math.min(max, n);
                                        setCartQuantity(item.listingId, clamped);
                                        if (clamped !== n) {
                                          setQtyDraft((draft) => ({
                                            ...draft,
                                            [item.listingId]: String(clamped),
                                          }));
                                        }
                                      }}
                                    />
                                  </div>
                                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                    {max} available
                                  </span>
                                </div>
                              ) : null}
                            </div>
                            <div className="text-right">
                              <span
                                className="block text-sm"
                                style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {formatPrice(item.price * units)}
                              </span>
                              {units > 1 && (
                                <span
                                  className="block text-xs"
                                  style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}
                                >
                                  {formatPrice(item.price)} each
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                              {/* Save for later is hidden once the backend owns
                                  the line (pending order) — Remove is the only
                                  safe way to drop a reserved line then. */}
                              {!pendingOrderId &&
                                (wishlist.isSignedIn ? (
                                  <button
                                    type="button"
                                    onClick={() => saveForLater(item.listingId)}
                                    disabled={savingId === item.listingId}
                                    aria-label={`Save ${item.title} for later`}
                                    className="text-xs px-2 py-1 rounded-[4px]"
                                    style={{
                                      border: '0.5px solid var(--border)',
                                      color: 'var(--text-secondary)',
                                      opacity: savingId === item.listingId ? 0.5 : 1,
                                      cursor: savingId === item.listingId ? 'wait' : 'pointer',
                                    }}
                                  >
                                    {savingId === item.listingId ? 'Saving…' : 'Save for later'}
                                  </button>
                                ) : (
                                  <SignInButton mode="modal">
                                    <button
                                      type="button"
                                      aria-label={`Sign in to save ${item.title} for later`}
                                      className="text-xs px-2 py-1 rounded-[4px]"
                                      style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                                    >
                                      Save for later
                                    </button>
                                  </SignInButton>
                                ))}
                              <button
                                type="button"
                                onClick={() => void removeLine(item)}
                                disabled={busy || Boolean(removingId)}
                                aria-busy={busy}
                                aria-label={`Remove ${item.title}`}
                                className="text-xs px-2 py-1 rounded-[4px]"
                                style={{
                                  border: '0.5px solid var(--border)',
                                  color: 'var(--text-tertiary)',
                                  opacity: busy ? 0.5 : 1,
                                  cursor: busy ? 'wait' : 'pointer',
                                }}
                              >
                                {busy ? 'Removing…' : 'Remove'}
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* ONE shipping row/price per seller accessories group. */}
                      {group.deliveryClass === 'GOODS' && group.method === 'COURIER' && (
                        <div
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                          style={{ borderTop: '0.5px solid var(--border)', background: 'var(--bg-inset)' }}
                        >
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            {courierState?.unavailableReason
                              ? courierState.unavailableReason
                              : courierState?.option
                                ? `Delivery — ${courierState.option.label}${courierState.option.detail ? ` · ${courierState.option.detail}` : ''}`
                                : needsAddress && !addrComplete
                                  ? 'Delivery — add your address to see the price'
                                  : 'Delivery — calculating…'}
                          </span>
                          <span
                            style={{
                              color: courierState?.option ? 'var(--text-primary)' : 'var(--text-tertiary)',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: courierState?.option ? 500 : 400,
                            }}
                          >
                            {courierState?.option
                              ? formatPrice(courierState.option.priceCents)
                              : '—'}
                          </span>
                        </div>
                      )}

                      {/* Private / firearm / collection rows carry NO delivery
                          charge — a R0 row would read as free shipping. */}
                      {group.deliveryClass === 'FIREARM' && (
                        <p
                          className="px-3 py-2 text-xs m-0"
                          style={{ borderTop: '0.5px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
                        >
                          {deliveryLabel(group.method)} — no delivery charge.
                          {group.method === 'PRIVATE_ARRANGE'
                            ? ' You and the seller arrange the hand-over.'
                            : ' The transfer happens through a licensed dealer.'}
                        </p>
                      )}
                      {group.deliveryClass === 'GOODS' && group.method === 'COLLECTION' && (
                        <p
                          className="px-3 py-2 text-xs m-0"
                          style={{ borderTop: '0.5px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
                        >
                          Private — collect in person. No delivery charge.
                        </p>
                      )}
                      {group.deliveryClass === 'GOODS' && group.method === 'PRIVATE_ARRANGE' && (
                        <p
                          className="px-3 py-2 text-xs m-0"
                          style={{ borderTop: '0.5px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
                        >
                          Private — arrange the hand-over with the seller. No
                          delivery charge.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            ))}

            {/* Collection papers — one acknowledgement for the whole cart. */}
            {collectionAckNeeded && (
              <label
                className="flex items-start gap-2 rounded-[8px] p-3 mb-4 text-xs"
                style={{ border: '1px solid var(--border-visible)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
              >
                <input
                  type="checkbox"
                  checked={collectionAck}
                  onChange={(event) => setCollectionAck(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I’ll collect the vehicle/trailer in person and receive the
                  registration and roadworthy papers from the seller at handover.
                </span>
              </label>
            )}

            {/* Delivery — compact header + collapsible courier picker. Only
                shown when at least one seller group chose Courier; a
                private/firearm-only cart hides it entirely. */}
            {needsAddress && (
              <>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Delivery
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {deliveryOpen
                        ? 'Choose the address and speed'
                        : deliveryDestination
                          ? `Deliver to ${deliveryDestination}`
                          : 'Add a delivery address'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      deliveryUserToggledRef.current = true;
                      setDeliveryOpen((open) => !open);
                    }}
                    className="text-xs px-3 py-1.5 rounded-[6px] flex-shrink-0"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-visible)',
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    {deliveryOpen ? 'Hide' : 'Change'}
                  </button>
                </div>

                {deliveryOpen ? (
                  <>
                    <div className="mb-4">
                      {!addressBookLoaded && !hasDeliveryAddress ? (
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Loading your address…
                        </p>
                      ) : (
                        <DeliveryAddressSummary
                          label={hasDeliveryAddress ? 'Delivery to' : 'Select Delivery Address'}
                          address={hasDeliveryAddress ? addressLine : ''}
                          incomplete={hasDeliveryAddress && !addrComplete}
                          changeLabel={hasDeliveryAddress ? 'Change' : 'Select'}
                          buttonRef={addressTriggerRef}
                          onChange={() => setAddressDialogOpen(true)}
                        />
                      )}
                    </div>

                    {addressDialogOpen && (
                      <DeliveryAddressDialog
                        returnFocusTo={addressTriggerRef.current}
                        initialAddress={addr}
                        selectedAddressId={addressId}
                        requireCoords={false}
                        getToken={getToken}
                        onClose={() => setAddressDialogOpen(false)}
                        onSelect={(a: Address) => {
                          addressChosenRef.current = true;
                          setSavedAddressPicked(true);
                          setAddr(toManualAddress(a));
                          setAddressId(a.id);
                        }}
                        onUseOnce={(value) => {
                          addressChosenRef.current = true;
                          setSavedAddressPicked(true);
                          setAddr(value);
                          setAddressId(null);
                        }}
                        onAddressesChanged={(rows: Address[]) => {
                          if (!addressId) return;
                          const current = rows.find((a) => a.id === addressId);
                          const next =
                            current ??
                            rows.find((a) => a.isDefault) ??
                            rows[0] ??
                            null;
                          if (next) {
                            setAddr(toManualAddress(next));
                            setAddressId(next.id);
                          } else {
                            setAddr(emptyManualAddress);
                            setAddressId(null);
                          }
                        }}
                      />
                    )}

                    <div className="mb-5">
                      <CartDeliveryPicker
                        lines={courierLines}
                        deliveryAddress={pickerAddress}
                        chosen={chosenDelivery}
                        onChoose={(groupKey, option) =>
                          setChosenDelivery((prev) => ({ ...prev, [groupKey]: option }))
                        }
                        onGroups={setDeliveryGroups}
                        getToken={getToken}
                        sellerNames={sellerNames}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mb-4 space-y-1">
                    {deliveryGroups.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Add a delivery address to see delivery options.
                      </p>
                    ) : (
                      deliveryGroups.map((group) => {
                        const chosen = chosenDelivery[group.groupKey];
                        const sellerName =
                          group.sellerName ??
                          sellerNames[group.listingIds[0]] ??
                          'Seller';
                        return (
                          <p
                            key={group.groupKey}
                            className="text-xs"
                            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
                          >
                            {sellerName} ·{' '}
                            {group.unavailableReason
                              ? group.unavailableReason
                              : chosen
                                ? `${chosen.label} — ${formatPrice(chosen.priceCents)}`
                                : 'Choose a delivery option'}
                          </p>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            )}

            {/* Payment method — ENABLED now. The picked provider rides on
                POST /orders/checkout and locks the one capture for the order. */}
            <PaymentMethodSection
              methods={paymentMethods}
              value={paymentProvider}
              onChange={setPaymentProvider}
            />
            {!paymentLoading && paymentMethods.length === 0 && (
              <p
                className="text-xs mb-2"
                style={{ color: 'var(--red)', lineHeight: 1.5 }}
              >
                Card payments are temporarily unavailable. Please try again in a
                moment.
              </p>
            )}
          </div>

          {/* Order-summary sidebar — totals, CTA, trust bullets. */}
          <div className="lg:sticky lg:top-20 min-w-0">
            <div
              className="rounded-[8px] p-4 mb-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <div className="flex justify-between text-sm py-1">
                <span style={{ color: 'var(--text-tertiary)' }}>Items ({unitCount})</span>
                <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(totals.itemsSubtotalCents)}
                </span>
              </div>
              {/* ONE delivery row per seller accessories group. */}
              {shippingRows.map((row) => (
                <div
                  key={row.group.key}
                  className="flex justify-between text-sm py-1 gap-3"
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    Delivery · {row.sellerName}
                  </span>
                  <span
                    style={{
                      color: row.cents != null ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.cents != null
                      ? formatPrice(row.cents)
                      : row.unavailableReason
                        ? 'Unavailable'
                        : 'Calculating…'}
                  </span>
                </div>
              ))}
              {/* ONE Platform Fee for the whole cart. */}
              <div className="flex justify-between text-sm py-1">
                <span style={{ color: 'var(--text-tertiary)' }}>Platform Fee</span>
                <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(totals.platformFeeCents)}
                </span>
              </div>
              <div
                className="flex justify-between text-sm py-2 mt-1"
                style={{ borderTop: '0.5px solid var(--border)' }}
              >
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Total</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(totals.totalCents)}
                </span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                Platform Fee is charged once on items + delivery.
              </p>
            </div>

            {(error || removeError) && (
              <p className="text-sm mb-3" style={{ color: 'var(--red)' }}>
                {error ?? removeError}
              </p>
            )}

            <button
              type="button"
              disabled={checkoutDisabled}
              onClick={checkout}
              className="block w-full py-3 rounded-[6px] text-sm text-center"
              style={{
                background: checkoutDisabled ? 'var(--bg-inset)' : 'var(--action-primary-bg)',
                color: checkoutDisabled ? 'var(--text-tertiary)' : '#fff',
                fontWeight: 500,
                cursor: checkoutDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {checkoutLabel}
            </button>
            <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-tertiary)' }}>
              The seller is only paid once you confirm delivery.
            </p>

            <div
              className="mt-4 rounded-[8px] p-4"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <TrustBullets isFirearm={items.some((item) => item.isFirearm)} />
            </div>
          </div>
        </div>
      </main>

      {/* Mobile sticky checkout bar. /cart is a PUSH route — the PWA bottom tab
          bar is not rendered here, so the bar sits flush at the bottom with
          safe-area padding. Total includes the ONE aggregate Platform Fee. */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 lg:hidden"
        style={{
          background: 'var(--bg-deep)',
          borderTop: '1px solid var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="max-w-[var(--content-max)] mx-auto px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <p
              className="text-[11px] uppercase"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              Total
            </p>
            <p
              className="text-sm font-semibold"
              style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatPrice(totals.totalCents)}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              incl. {formatPrice(totals.platformFeeCents)} fee
            </p>
          </div>
          <button
            type="button"
            disabled={checkoutDisabled}
            onClick={checkout}
            className="flex-1 py-3 rounded-[6px] text-sm text-center"
            style={{
              background: checkoutDisabled ? 'var(--bg-inset)' : 'var(--action-primary-bg)',
              color: checkoutDisabled ? 'var(--text-tertiary)' : '#fff',
              fontWeight: 500,
              cursor: checkoutDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {checkoutLabel}
          </button>
        </div>
      </div>
      {/* Spacer so the fixed bar never covers the last content/sidebar row. */}
      <div
        className="lg:hidden"
        aria-hidden
        style={{ height: 'calc(96px + env(safe-area-inset-bottom))' }}
      />
    </DistanceProvider>
  );
}
