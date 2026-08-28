'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, SignInButton } from '@clerk/nextjs';
import {
  useCart,
  removeFromCart,
  setCartQuantity,
  getCart,
} from '@/lib/cart-store';
import { NumberStepper } from '@/components/number-stepper';
import { formatPrice } from '@/lib/utils';
import { PaymentsComingSoon } from '@/components/payments-coming-soon';
import { PaymentMethodSection } from '@/components/payment-method-section';
import { BuyerTermsAck } from '@/components/buyer-terms-ack';
import { vicinityLabel } from '@/lib/vicinity';
import { useWishlist } from '@/lib/use-wishlist';
import {
  CartDeliveryPicker,
  type CartDeliveryOption,
  type CartDeliveryGroupView,
} from '@/components/cart-delivery-picker';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
import {
  FirearmAttestation,
  DealerTransferConsent,
  PrivateArrangeConsent,
} from '@/components/firearm-consents';
import { TrustBullets } from '@/components/trust-bullets';
import { SavedAddressPicker } from '@/components/saved-address-picker';
import { Breadcrumbs, type Crumb } from '@/components/breadcrumbs';
import type { Address } from '@/lib/types';

// Two-crumb trail — Breadcrumbs renders nothing for fewer than two, so this
// is the shortest trail that still shows. Same on every state below (empty,
// payments-coming-soon, populated): the page's place in the site doesn't
// change with what's in the cart.
const CART_TRAIL: Crumb[] = [{ label: 'Home', href: '/' }, { label: 'Cart' }];

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type FirearmRoute = 'DEALER_TRANSFER' | 'PRIVATE_ARRANGE';

// Per-firearm state — route + the two required confirmations, keyed by
// listingId. Both attestation and the route's consent must be accepted
// before the firearm is checkout-ready.
interface FirearmState {
  route: FirearmRoute;
  attestationAccepted: boolean;
  consentAccepted: boolean;
}

// UX-M24 — live stock for one cart line, read from the PUBLIC listing payload
// (trackInventory / quantityAvailable / quantityReserved are all in
// PUBLIC_LISTING_SELECT). We deliberately do NOT trust the localStorage
// snapshot for this: a cart can sit for days while other buyers reserve units,
// so the quantity ceiling has to come from the server every time /cart loads.
// `sellable` mirrors the PDP's trackedSellable (available − reserved).
interface LineStock {
  trackInventory: boolean;
  sellable: number;
  /** Town + province, kept from the stock read we were already making. */
  vicinity?: string;
  // Board review — seller-group header avatar. Piggybacks on this SAME
  // per-line /listings/:id read below (no extra request). PUBLIC_LISTING_SELECT's
  // seller sub-select (backend/src/listings/listings.service.ts) carries
  // avatarUrl but NOT kycStatus, so a "verified" pill can't be built from
  // this payload — see the group header render for why it's omitted.
  sellerAvatarUrl?: string | null;
}

export default function CartPage() {
  const items = useCart();
  const { getToken } = useAuth();
  // Save-for-later reads/writes the SAME wishlist store the heart icon uses
  // everywhere else (lib/use-wishlist.tsx) — no second "saved items" path.
  const wishlist = useWishlist();

  // What the buyer chose, per parcel the cart will ship as. The groups are
  // the server's — a cart consolidates, and every Daily Deal shares the house
  // seller id, so a client-side grouping would show one parcel where two
  // suppliers each ship one.
  const [chosenDelivery, setChosenDelivery] = useState<Record<string, CartDeliveryOption>>({});
  const [deliveryGroups, setDeliveryGroups] = useState<CartDeliveryGroupView[]>([]);
  const [addr, setAddr] = useState<ManualAddressValue>(emptyManualAddress);
  // Per-firearm route + consent state, keyed by listingId.
  const [firearmState, setFirearmState] = useState<Record<string, FirearmState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase-1 payment gate — card payments aren't live yet, so the cart
  // checkout POST returns 503 "launching soon". True once we've detected that.
  const [comingSoon, setComingSoon] = useState(false);
  // UX-M24 — live per-listing stock, keyed by listingId. Empty until the fetch
  // below lands (and stays empty for any line whose fetch failed), which is the
  // safe default: no entry ⇒ quantity ceiling of 1 ⇒ exactly today's behaviour.
  const [stock, setStock] = useState<Record<string, LineStock>>({});
  // In-progress text for a quantity input, keyed by listingId. The committed
  // value always lives in the cart store; this only exists so typing (which can
  // pass through '' or an over-max number) doesn't fight the controlled input.
  // Cleared on blur so the field always settles back on the stored quantity.
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // In-flight listingId for "Save for later" — disables only that row's
  // button for the duration of its own request.
  const [savingId, setSavingId] = useState<string | null>(null);

  // cart-store's read() already normalises quantity to a whole number >= 1, so
  // this is belt-and-braces for the optional TYPE rather than a real case.
  const qtyOf = (q?: number) => q ?? 1;

  // Save for later — adds the line to the wishlist, then removes it from the
  // cart. Guards against re-toggling an already-wishlisted line: `toggle`
  // FLIPS state, so calling it on something already saved would un-save it.
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
  // changes (not on every quantity tick — `ids` is a stable sorted key, so
  // clamping below can't re-trigger this effect).
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
            // Public endpoint — no token needed, and no auth means a signed-out
            // browse-then-sign-in cart still gets its ceilings.
            const res = await fetch(`${API_URL}/listings/${id}`);
            if (!res.ok) return null;
            const l = await res.json();
            const trackInventory = Boolean(l?.trackInventory);
            return [
              id,
              {
                trackInventory,
                // Town + province, from the read we were already making. The
                // acknowledgement above "Continue to payment" names every
                // item's town, so the buyer cannot tick "I've seen where these
                // items are" against nothing.
                vicinity: vicinityLabel(l),
                sellerAvatarUrl: l?.seller?.avatarUrl ?? null,
                sellable: trackInventory
                  ? Math.max(
                      0,
                      (l.quantityAvailable ?? 0) - (l.quantityReserved ?? 0),
                    )
                  : 1,
              },
            ] as const;
          } catch {
            // Network blip — leave the line un-ceilinged (max 1). Never block
            // the cart on a stock read.
            return null;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, LineStock> = {};
      for (const r of results) if (r) map[r[0]] = r[1];
      setStock(map);
      // Clamp anything the buyer banked earlier that no longer fits — units
      // sold while the cart sat in localStorage. Reads the store fresh (not the
      // render-time `items`) so this effect needn't depend on it. Floor of 1:
      // a sold-out line keeps its quantity and is blocked by name below rather
      // than silently mutating to zero.
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

  // The quantity ceiling for a line. Firearms are always single-unit (one
  // licence, one serial, one dealer transfer), and an untracked listing is a
  // single physical item — only inventory-tracked stock can exceed 1.
  const maxQtyFor = (listingId: string, isFirearm: boolean): number => {
    if (isFirearm) return 1;
    const s = stock[listingId];
    if (!s || !s.trackInventory) return 1;
    return s.sellable;
  };

  // Lines the seller has since run out of. Consistent with the PDP, where
  // trackedSellable <= 0 hides Buy Now — here we can't hide the line, so we
  // name it and block Continue until it's removed (the backend would reject
  // the whole order with "This item is sold out." otherwise).
  const soldOutItems = items.filter((i) => {
    const s = stock[i.listingId];
    return !i.isFirearm && s?.trackInventory && s.sellable <= 0;
  });

  // Money + counts are per-UNIT now: a line is unitPrice × quantity.
  const itemsSubtotal = items.reduce(
    (s, i) => s + i.price * qtyOf(i.quantity),
    0,
  );
  const unitCount = items.reduce((s, i) => s + qtyOf(i.quantity), 0);

  // Split shippable (courier) items from firearms — firearms branch to a
  // dealer-transfer / in-person route and never touch the courier picker.
  // Collection-only lines (trailers / oversized goods / >100Wh lithium) can't
  // ride the cart rail at all — the backend rejects a courier method for them
  // and there's no cart collection route. The listing page now suppresses
  // Add-to-cart for these, but a stale localStorage cart written before that
  // fix may still carry one, so belt-and-braces here: surface + block them by
  // name rather than letting the whole basket hard-fail with an unnamed error.
  const collectionItems = items.filter(
    (i) => !i.isFirearm && i.shippingMethods?.includes('COLLECTION'),
  );
  const shippableItems = items.filter(
    (i) => !i.isFirearm && !i.shippingMethods?.includes('COLLECTION'),
  );
  const firearmItems = items.filter((i) => i.isFirearm);

  // The per-firearm state for a listing, defaulting to DEALER_TRANSFER with
  // nothing accepted yet. Kept as a pure read so render + the checkout gate
  // agree without mutating state during render.
  const stateFor = (listingId: string): FirearmState =>
    firearmState[listingId] ?? {
      route: 'DEALER_TRANSFER',
      attestationAccepted: false,
      consentAccepted: false,
    };

  const setFirearm = (listingId: string, patch: Partial<FirearmState>) =>
    setFirearmState((prev) => {
      const cur = prev[listingId] ?? {
        route: 'DEALER_TRANSFER' as FirearmRoute,
        attestationAccepted: false,
        consentAccepted: false,
      };
      return { ...prev, [listingId]: { ...cur, ...patch } };
    });

  // Group lines by seller (Phase 8d — a cart can mix sellers). One payment
  // covers all; each seller ships + is paid independently.
  //
  // `sellerId` (the seller's clerkId) is carried on the group because it, not
  // the handle, is the identity here: a seller can hold no username at all
  // (see cart-store.ts) and every nameless one is written into the cart under
  // the same literal, so handles do not tell two sellers apart. `name` is
  // display text and nothing more.
  const groups = Array.from(
    items
      .reduce((m, i) => {
        const g = m.get(i.sellerId) ?? {
          sellerId: i.sellerId,
          // The wording the rest of the buy flow uses for a missing handle
          // (listings/[id]/page.tsx:1066, checkout/[listingId]/page.tsx:138),
          // and no tombstone label inviting a click through to a profile that
          // 404s. ⚠️ It fires only for a line with no sellerUsername key at
          // all: both add-to-cart writers coerce a null handle before it gets
          // here — the PDP to 'Seller', /deals to 'All Outdoor' — so a
          // nameless seller's block still reads 'Seller'. Aligning that is a
          // change at the writer; never by rewriting a stored value.
          name: i.sellerUsername ?? 'Anonymous seller',
          items: [] as typeof items,
        };
        g.items.push(i);
        m.set(i.sellerId, g);
        return m;
      }, new Map<string, { sellerId: string; name: string; items: typeof items }>())
      .values(),
  );

  const addrComplete =
    addr.street.trim() &&
    addr.suburb.trim() &&
    addr.city.trim() &&
    addr.province &&
    addr.postalCode.trim().length >= 4;
  // Courier shipping only needs to be ready when there ARE shippable items.
  //
  // THE STRUCTURAL CHANGE. This used to prove "a locker or an address exists",
  // which is not the same as "we know what delivery costs". Now every parcel
  // the cart ships as must have a chosen, priced option — so the total on
  // screen is the total that gets charged, and a group the courier cannot
  // serve blocks checkout instead of silently pricing at zero.
  const courierReady =
    shippableItems.length === 0 ||
    (Boolean(addrComplete) &&
      deliveryGroups.length > 0 &&
      deliveryGroups.every(
        (g) => !g.unavailableReason && !!chosenDelivery[g.groupKey],
      ));

  // Delivery for the whole cart: the sum of the chosen options. Each figure is
  // already margin-inclusive (one number for the buyer), and a consolidated
  // group contributes ONE charge, not one per line.
  const deliveryTotalCents = deliveryGroups.reduce(
    (sum, g) => sum + (chosenDelivery[g.groupKey]?.priceCents ?? 0),
    0,
  );

  // Every firearm must have a chosen route, its 18+ attestation, and the
  // consent for the chosen route accepted.
  const firearmsReady = firearmItems.every((i) => {
    const s = stateFor(i.listingId);
    return s.route && s.attestationAccepted && s.consentAccepted;
  });

  // One acknowledgement for the whole cart — the buyer ticks once, over a list
  // naming each item's town. It rides on CreateOrderDto, not per line.
  const [buyerTermsAck, setBuyerTermsAck] = useState(false);

  const shippingReady =
    buyerTermsAck &&
    courierReady &&
    firearmsReady &&
    collectionItems.length === 0 &&
    // UX-M24 — a sold-out line poisons the whole order server-side, so gate on
    // it here. Only ever true off a SUCCESSFUL stock read; a failed fetch
    // leaves the line unknown and never blocks checkout.
    soldOutItems.length === 0;

  // The address in the shape the quoting endpoint takes.
  const pickerAddress =
    addrComplete
      ? {
          streetAddress: addr.street.trim(),
          suburb: addr.suburb.trim(),
          city: addr.city.trim(),
          postalCode: addr.postalCode.trim(),
          province: addr.province,
        }
      : null;

  // Changing the address invalidates every price already chosen against the
  // old one. Clearing here stops a stale figure surviving into the payload.
  useEffect(() => {
    setChosenDelivery({});
  }, [addr.street, addr.suburb, addr.city, addr.postalCode, addr.province]);

  async function checkout() {
    if (!shippingReady || items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const lines = items.map((i) => {
        if (i.isFirearm) {
          const s = stateFor(i.listingId);
          return {
            listingId: i.listingId,
            shippingMethod: s.route,
            firearmAttestation18Plus: true,
            ...(s.route === 'PRIVATE_ARRANGE'
              ? { privateArrangeConsent: true }
              : {}),
          };
        }
        // UX-M24 — per-line units. Only sent when the buyer actually raised it
        // (CreateOrderLineDto.quantity is optional and resolves to 1 when
        // absent), so a single-unit cart posts the byte-identical payload it
        // always did. The server re-resolves against live stock and reserves
        // that many units atomically before the order exists.
        const units = qtyOf(i.quantity);
        // Which parcel is this line in, and what did the buyer choose for it?
        const group = deliveryGroups.find((g) =>
          g.listingIds.includes(i.listingId),
        );
        const option = group ? chosenDelivery[group.groupKey] : undefined;
        // The METHOD is derived from the delivery the buyer picked, never
        // asked for. PUDO and TCG are slots — a collection point and a door —
        // not carriers, and the buyer chooses the shape of the hand-over.
        const shippingMethod = option?.kind === 'PICKUP_POINT' ? 'PUDO' : 'TCG';
        return {
          listingId: i.listingId,
          shippingMethod,
          ...(units > 1 ? { quantity: units } : {}),
          // The address rides on EVERY courier line regardless of slot. A
          // collection point pins where within an area the parcel lands; it
          // does not tell the carrier which area, and the server's re-quote
          // returns null without it.
          deliveryAddress: {
            building: addr.building.trim() || undefined,
            streetAddress: addr.street.trim(),
            address2: addr.address2.trim() || undefined,
            suburb: addr.suburb.trim(),
            city: addr.city.trim(),
            province: addr.province,
            postalCode: addr.postalCode.trim(),
          },
          ...(option?.kind === 'PICKUP_POINT' && option.locationId != null
            ? { pudoPickupLockerId: String(option.locationId) }
            : {}),
        };
      });
      const res = await fetch(`${API_URL}/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ buyerTermsAccepted: buyerTermsAck, lines }),
      });
      const data = await res.json().catch(() => ({}));
      // Phase-1 payment gate: the API returns 503 "card payments are
      // launching soon" until PAYMENTS_LIVE. Show the launching-soon state.
      if (res.status === 503 || /launching soon/i.test(data?.message ?? '')) {
        setComingSoon(true);
        return;
      }
      // No successful checkout is possible while the gate is closed, so any
      // other non-ok response is a genuine failure (item gone, etc.).
      setError(
        data?.message ||
          'Checkout failed. An item may no longer be available — refresh and try again.',
      );
    } catch {
      setError('Something went wrong reaching checkout. Please try again.');
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
          Add buy-now items to your cart and check out in one payment. Items ship per seller.
        </p>
        <Link
          href="/"
          className="inline-block text-sm px-5 py-2.5 rounded-[6px]"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
        >
          Browse the marketplace
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-[var(--content-max)] mx-auto px-4 py-8">
      <Breadcrumbs trail={CART_TRAIL} className="mb-6" />
      <h1 className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Your cart
      </h1>
      <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
        {groups.length === 1 ? (
          <>All from <strong>{groups[0].name}</strong>. </>
        ) : (
          <>From <strong>{groups.length} sellers</strong> — each ships and is paid
          separately. </>
        )}
        One payment. Courier items are priced once you enter your delivery
        address, and anything shipping together is charged once.
        {firearmItems.length > 0 && (
          <> Firearms route through a licensed dealer or in person — confirm each
          firearm&apos;s details below before you can continue.</>
        )}
      </p>

      {/* Board — two-pane layout: content takes the remaining width, order
          summary is a 344px sidebar that sticks as you scroll (see the
          sidebar div below, opened right before Totals). Unwinds to one
          column below lg — same pattern app/checkout/[listingId]/page.tsx
          uses. --content-max (globals.css) is sized to fit this exact split. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_344px] gap-5 items-start">
      <div className="min-w-0">

      {/* Items — grouped by seller (Phase 8d) */}
      {groups.map((g) => {
        // P6.2 — 2+ courier (non-firearm) items from ONE seller ship as a SINGLE
        // parcel (one waybill, one handling fee). The cart sends all courier
        // lines to the same method + destination, so any such group consolidates
        // at checkout. Flag it here so the buyer knows the per-parcel handling
        // fee is charged once, not once per item.
        const shippableInGroup = g.items.filter((i) => !i.isFirearm).length;
        return (
        <div
          // ⚠️ sellerId, never the handle. This was `key={g.username}`, and a
          // handle is not unique: a seller can hold none, and the add-to-cart
          // writer stores the same literal for every one of them, so two such
          // lines gave two siblings the SAME key. React warns, reconciliation
          // between them is undefined, and a re-render (a quantity tick) can
          // drop a block while checkout still charges for every line.
          key={g.sellerId}
          className="rounded-[8px] mb-4 overflow-hidden"
          style={{ border: '0.5px solid var(--border)' }}
        >
          {groups.length > 1 && (
            <div
              className="px-3 py-2 flex items-center gap-2 text-xs"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
            >
              {g.items[0] && stock[g.items[0].listingId]?.sellerAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={stock[g.items[0].listingId]!.sellerAvatarUrl!}
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
              <span style={{ fontWeight: 500 }}>{g.name}</span>
              {/* Board review also asked for a verified pill here, keyed on
                  kycStatus. PUBLIC_LISTING_SELECT's seller sub-select (the
                  same /listings/:id read the avatar above comes from) does
                  NOT select kycStatus — only Me / admin projections do.
                  Rendering a pill from data we don't have would risk showing
                  an unverified seller as verified (or vice versa), so it's
                  left off until that field is added to the public payload. */}
            </div>
          )}
          {g.items.map((i) => {
            // UX-M24 — per-line units. `max` is the live sellable count (1 for
            // firearms and untracked single items, so the stepper simply never
            // renders for them — same rule the PDP uses for its own stepper).
            const units = qtyOf(i.quantity);
            const max = maxQtyFor(i.listingId, i.isFirearm);
            const lineSoldOut = soldOutItems.includes(i);
            return (
            <div
              key={i.listingId}
              className="flex items-center gap-3 p-3"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.imageUrl ? (
                <img
                  src={i.imageUrl}
                  alt={i.title}
                  className="w-12 h-12 rounded-[6px] object-cover"
                  style={{ background: 'var(--bg-inset)' }}
                />
              ) : (
                <div className="w-12 h-12 rounded-[6px]" style={{ background: 'var(--bg-inset)' }} />
              )}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/listings/${i.listingId}`}
                  className="block text-sm truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {i.title}
                </Link>
                {i.isFirearm && (
                  <span
                    className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-[4px] uppercase"
                    style={{
                      background: 'rgba(200,16,46,0.08)',
                      border: '0.5px solid var(--red)',
                      color: 'var(--red)',
                      letterSpacing: '0.03em',
                      fontWeight: 600,
                    }}
                  >
                    Firearm — dealer / in-person
                  </span>
                )}

                {/* Sold out beats the stepper — there's nothing to choose a
                    quantity of, and Continue is blocked until it's gone. */}
                {lineSoldOut ? (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--red)', lineHeight: 1.4 }}>
                    Sold out while it sat in your cart — remove it to continue.
                  </p>
                ) : max > 1 ? (
                  <div
                    className="mt-2 flex items-center gap-2"
                    // Blur bubbles here from the input; clearing the draft makes
                    // the field settle back on the committed cart quantity, so a
                    // half-typed or over-max entry can never be left on screen
                    // disagreeing with the totals.
                    onBlur={() =>
                      setQtyDraft((d) => {
                        if (!(i.listingId in d)) return d;
                        const next = { ...d };
                        delete next[i.listingId];
                        return next;
                      })
                    }
                  >
                    {/* Wider on mobile: number-stepper.tsx's +/− buttons grow
                        to a 44px tap target below sm, so the row needs the
                        extra width to fit them without squeezing the input. */}
                    <div className="w-[136px] sm:w-[108px]">
                      <NumberStepper
                        value={qtyDraft[i.listingId] ?? String(units)}
                        min={1}
                        max={max}
                        aria-label={`Quantity for ${i.title}`}
                        onChange={(next) => {
                          setQtyDraft((d) => ({ ...d, [i.listingId]: next }));
                          const n = Number.parseInt(next, 10);
                          if (!Number.isFinite(n) || n < 1) return; // mid-edit / cleared
                          const clamped = Math.min(max, n);
                          setCartQuantity(i.listingId, clamped);
                          // Typed past the stock ceiling → snap the visible
                          // field down immediately rather than waiting for blur,
                          // so the buyer sees WHY they can't have more.
                          if (clamped !== n) {
                            setQtyDraft((d) => ({
                              ...d,
                              [i.listingId]: String(clamped),
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
                  {formatPrice(i.price * units)}
                </span>
                {units > 1 && (
                  <span
                    className="block text-xs"
                    style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatPrice(i.price)} each
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {/* Save for later — moves the line into the wishlist rather
                    than discarding it. Signed-out matches WishlistButton's
                    own gate (components/wishlist-button.tsx): a modal
                    sign-in prompt, not a silent no-op. */}
                {wishlist.isSignedIn ? (
                  <button
                    type="button"
                    onClick={() => saveForLater(i.listingId)}
                    disabled={savingId === i.listingId}
                    aria-label={`Save ${i.title} for later`}
                    className="text-xs px-2 py-1 rounded-[4px]"
                    style={{
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-secondary)',
                      opacity: savingId === i.listingId ? 0.5 : 1,
                      cursor: savingId === i.listingId ? 'wait' : 'pointer',
                    }}
                  >
                    {savingId === i.listingId ? 'Saving…' : 'Save for later'}
                  </button>
                ) : (
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      aria-label={`Sign in to save ${i.title} for later`}
                      className="text-xs px-2 py-1 rounded-[4px]"
                      style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Save for later
                    </button>
                  </SignInButton>
                )}
                <button
                  type="button"
                  onClick={() => removeFromCart(i.listingId)}
                  aria-label={`Remove ${i.title}`}
                  className="text-xs px-2 py-1 rounded-[4px]"
                  style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
                >
                  Remove
                </button>
              </div>
            </div>
            );
          })}
          {shippableInGroup >= 2 && (
            <div
              className="px-3 py-2 text-xs flex items-center gap-1.5"
              style={{
                borderTop: '0.5px solid var(--border)',
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                lineHeight: 1.4,
              }}
            >
              <span aria-hidden>📦</span>
              These {shippableInGroup} items ship together as one parcel — you
              only pay one handling fee.
            </div>
          )}
        </div>
        );
      })}

      {/* Collection-only lines can't check out from the cart — name each one
          and point the buyer at its own Buy Now checkout. Blocks Continue via
          shippingReady above until they're removed. */}
      {collectionItems.map((i) => (
        <div
          key={i.listingId}
          className="rounded-[8px] mb-4 p-3"
          style={{ border: '0.5px solid var(--red)', background: 'rgba(200,16,46,0.06)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {i.title}
          </p>
          <p className="text-xs mt-1 mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            This item is collection only — it can&apos;t be bought in a cart.
            Buy it on its own to arrange collection with the seller.
          </p>
          <div className="flex gap-2">
            <Link
              href={`/checkout/${i.listingId}`}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Buy this item on its own
            </Link>
            <button
              type="button"
              onClick={() => removeFromCart(i.listingId)}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
            >
              Remove from cart
            </button>
          </div>
        </div>
      ))}

      {/* Delivery — courier picker only when there ARE shippable (non-firearm)
          items. A firearm-only cart hides this entirely. */}
      {shippableItems.length > 0 && (
        <>
          <h2 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Delivery
          </h2>
          {/* Address FIRST — nothing can be priced without it. There is no
              carrier toggle any more: the buyer chooses a delivery, and which
              carrier fulfils it is ours to decide. */}
          <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Where should we deliver? Delivery is priced once we have your
            address.
          </p>
          <div className="mb-4">
            {/* UX-3 — saved-address picker (2+ book addresses only).
                Picking one fills the same `addr` state the payload reads. */}
            <SavedAddressPicker
              onSelect={(a: Address) =>
                setAddr({
                  building: a.building ?? '',
                  street: a.street,
                  address2: a.address2 ?? '',
                  suburb: a.suburb ?? '',
                  city: a.city,
                  postalCode: a.postalCode,
                  province: a.province,
                })
              }
            />
            <ManualAddressFields value={addr} onChange={setAddr} idPrefix="cart" />
          </div>

          <div className="mb-5">
            <CartDeliveryPicker
              lines={shippableItems.map((i) => ({
                listingId: i.listingId,
                quantity: qtyOf(i.quantity),
              }))}
              deliveryAddress={pickerAddress}
              chosen={chosenDelivery}
              onChoose={(groupKey, option) =>
                setChosenDelivery((prev) => ({ ...prev, [groupKey]: option }))
              }
              onGroups={setDeliveryGroups}
              getToken={getToken}
            />
          </div>
        </>
      )}

      {/* Firearms — one route + consent block per firearm line */}
      {firearmItems.length > 0 && (
        <>
          <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Firearms
          </h2>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Firearms don&apos;t ship by courier. Choose a route and confirm the
            required details for each one.
          </p>
          {firearmItems.map((i) => {
            const s = stateFor(i.listingId);
            const offersPrivate = i.shippingMethods.includes('PRIVATE_ARRANGE');
            return (
              <div
                key={i.listingId}
                className="rounded-[8px] mb-4 p-3 space-y-3"
                style={{ border: '0.5px solid var(--border)', background: 'var(--bg-card)' }}
              >
                <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {i.title}
                </p>

                {/* Route toggle — DEALER_TRANSFER always; PRIVATE_ARRANGE only
                    if the seller offered it. */}
                <div className="flex gap-2">
                  {(['DEALER_TRANSFER', ...(offersPrivate ? ['PRIVATE_ARRANGE'] : [])] as FirearmRoute[]).map(
                    (route) => (
                      <button
                        key={route}
                        type="button"
                        onClick={() =>
                          // Switching route clears the previous route's consent —
                          // each route has its own gate.
                          setFirearm(i.listingId, { route, consentAccepted: false })
                        }
                        className="flex-1 py-2.5 rounded-[6px] text-xs"
                        style={{
                          background: s.route === route ? 'var(--red)' : 'var(--bg-inset)',
                          color: s.route === route ? '#fff' : 'var(--text-secondary)',
                          border: '0.5px solid var(--border)',
                          fontWeight: 500,
                          lineHeight: 1.4,
                        }}
                      >
                        {route === 'DEALER_TRANSFER'
                          ? 'Dealer transfer — funds held until verified'
                          : 'Arrange in person — released immediately'}
                      </button>
                    ),
                  )}
                </div>

                {/* 18+/competency attestation — required for every firearm. */}
                <FirearmAttestation
                  accepted={s.attestationAccepted}
                  onChange={(v) => setFirearm(i.listingId, { attestationAccepted: v })}
                />

                {/* Route-specific consent. */}
                {s.route === 'DEALER_TRANSFER' ? (
                  <DealerTransferConsent
                    accepted={s.consentAccepted}
                    onChange={(v) => setFirearm(i.listingId, { consentAccepted: v })}
                  />
                ) : (
                  <PrivateArrangeConsent
                    accepted={s.consentAccepted}
                    onChange={(v) => setFirearm(i.listingId, { consentAccepted: v })}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* UX-8 — payment-method section shell (EFT active today; card seam). */}
      <PaymentMethodSection />

      </div>

      {/* Order-summary sidebar — totals, terms ack, CTA, trust bullets.
          lg:sticky only engages at lg+, where the two-column grid exists;
          below that it sits in normal flow under the content column. */}
      <div className="lg:sticky lg:top-20 min-w-0">

      {/* Totals */}
      <div
        className="rounded-[8px] p-4 mb-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex justify-between text-sm py-1">
          {/* Counts UNITS, not lines — 3 boxes of ammo on one line is 3 items. */}
          <span style={{ color: 'var(--text-tertiary)' }}>Items ({unitCount})</span>
          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatPrice(itemsSubtotal)}
          </span>
        </div>
        <div className="flex justify-between text-sm py-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Delivery</span>
          <span
            style={{
              color: deliveryTotalCents > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {shippableItems.length === 0
              ? '—'
              : deliveryTotalCents > 0
                ? formatPrice(deliveryTotalCents)
                : 'Choose an option above'}
          </span>
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          Delivery is one figure — nothing is added on top. Items that ship
          together count once. Firearms move through a licensed dealer or are
          arranged in person, and carry no courier charge.
        </p>
      </div>

      {error && (
        <p className="text-sm mb-3" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      <BuyerTermsAck
        variant="courier"
        location=""
        items={items.map((i) => ({
          title: i.title,
          location: stock[i.listingId]?.vicinity ?? 'the seller’s area',
        }))}
        checked={buyerTermsAck}
        onChange={setBuyerTermsAck}
      />

      <button
        type="button"
        disabled={!shippingReady || submitting}
        onClick={checkout}
        className="block w-full py-3 rounded-[6px] text-sm text-center"
        style={{
          background: !shippingReady || submitting ? 'var(--bg-inset)' : 'var(--red)',
          color: !shippingReady || submitting ? 'var(--text-tertiary)' : '#fff',
          fontWeight: 500,
          cursor: !shippingReady || submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting
          ? 'Creating your order…'
          : shippingReady
            ? 'Continue to payment'
            : !buyerTermsAck
              ? 'Tick the acknowledgement to continue'
            : soldOutItems.length > 0
              ? 'Remove the sold-out item to continue'
              : !firearmsReady
                ? 'Confirm the firearm details to continue'
                : collectionItems.length > 0
                  ? 'Remove the collection-only item to continue'
                  : !addrComplete
                    ? 'Enter a delivery address to continue'
                    : 'Choose a delivery option to continue'}
      </button>
      <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-tertiary)' }}>
        The seller is only paid once you confirm delivery.
      </p>

      {/* UX-1e — trust bullets under the cart summary CTA. Same component
          as the PDP (UX-1d). Firearm bullet shown when the cart contains a
          firearm line. */}
      <div
        className="mt-4 rounded-[8px] p-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <TrustBullets isFirearm={items.some((i) => i.isFirearm)} />
      </div>

      </div>
      </div>
    </main>
  );
}
