// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  CartDeliveryPicker,
  CartDeliveryToggle,
} from './cart-delivery-picker';
import {
  cartGroupKey,
  groupCartBySellerAndClass,
  type CartClassGroup,
} from '@/lib/cart-delivery';
import type { CartItem } from '@/lib/cart-store';

// ─────────────────────────────────────────────────────────────────────
// APPROVED CART SHAPE (operator 2026-11-27):
//   • one toggle per seller + delivery class (Accessories Courier/Private,
//     Firearms Dealer Stock/Private);
//   • a seller with both shows TWO independent groups/toggles;
//   • no per-item delivery controls;
//   • ONE shipping row/price per seller accessories group when Courier.
// ─────────────────────────────────────────────────────────────────────

const goods = (over: Partial<CartItem> = {}): CartItem => ({
  listingId: 'l-goods',
  title: 'Scope rings',
  price: 50_000,
  sellerId: 'seller-1',
  sellerUsername: 'johan',
  isFirearm: false,
  shippingMethods: ['COURIER', 'PRIVATE_ARRANGE'],
  quantity: 1,
  ...over,
});

const firearm = (over: Partial<CartItem> = {}): CartItem => ({
  listingId: 'l-firearm',
  title: '9mm pistol',
  price: 900_000,
  sellerId: 'seller-1',
  sellerUsername: 'johan',
  isFirearm: true,
  shippingMethods: ['DEALER_TRANSFER', 'PRIVATE_ARRANGE'],
  quantity: 1,
  ...over,
});

const classGroup = (items: CartItem[]): CartClassGroup => {
  const groups = groupCartBySellerAndClass(items);
  return groups[0].classes[0];
};

const ADDRESS = {
  streetAddress: '1 Main Road',
  suburb: 'Milpark',
  city: 'Johannesburg',
  postalCode: '2092',
  province: 'GAUTENG',
};

const apiGroup = (over: Record<string, unknown>) => ({
  groupKey: 'q-1',
  listingIds: ['l-goods'],
  consolidated: false,
  door: {
    priceCents: 12_500,
    carrierRateCents: 12_500,
    serviceName: 'Bob Go Express',
    serviceCode: 'ECO',
    providerSlug: 'bobgo',
    serviceLevelCode: 'ECO',
    deliveryDaysMin: 2,
    deliveryDaysMax: 4,
  },
  fastestDoor: null,
  storePickup: [],
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CartDeliveryToggle — one toggle per seller + class', () => {
  it('renders the Courier / Private pair for an accessories group', () => {
    const onChange = vi.fn();
    render(
      <CartDeliveryToggle group={classGroup([goods()])} onChange={onChange} />,
    );
    const toggle = screen.getByRole('group', {
      name: /delivery method for johan's accessories/i,
    });
    expect(toggle).toBeInTheDocument();
    // Exactly ONE two-sided toggle, no per-item controls.
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Courier' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));
    expect(onChange).toHaveBeenCalledWith(
      cartGroupKey('seller-1', 'GOODS'),
      'PRIVATE_ARRANGE',
    );
  });

  it('renders Dealer Stock / Private for a firearms group', () => {
    const onChange = vi.fn();
    render(
      <CartDeliveryToggle group={classGroup([firearm()])} onChange={onChange} />,
    );
    expect(
      screen.getByRole('group', { name: /transfer method for johan's firearms/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dealer Stock' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));
    expect(onChange).toHaveBeenCalledWith(
      cartGroupKey('seller-1', 'FIREARM'),
      'PRIVATE_ARRANGE',
    );
  });

  it('gives a seller with goods + firearm TWO independent groups', () => {
    const groups = groupCartBySellerAndClass([goods(), firearm()]);
    render(
      <div>
        {groups[0].classes.map((group) => (
          <CartDeliveryToggle
            key={group.key}
            group={group}
            onChange={() => undefined}
          />
        ))}
      </div>,
    );
    const toggles = screen.getAllByRole('group');
    expect(toggles).toHaveLength(2);
    expect(toggles.map((node) => node.getAttribute('aria-label'))).toEqual([
      "Delivery method for johan's accessories",
      "Transfer method for johan's firearms",
    ]);
  });

  it('shows a single Private state (not a dead toggle) for a collection-only line', () => {
    const collectionOnly = goods({
      listingId: 'l-trailer',
      shippingMethods: ['COLLECTION'],
    });
    render(
      <CartDeliveryToggle
        group={classGroup([collectionOnly])}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Private')).toBeInTheDocument();
  });
});

describe('CartDeliveryPicker — ONE priced parcel per seller', () => {
  it('renders one delivery group per seller and defaults it to cheapest door', async () => {
    const onChoose = vi.fn();
    const onGroups = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify([
            apiGroup({ groupKey: 'q-1', listingIds: ['l-goods'] }),
            apiGroup({
              groupKey: 'q-2',
              listingIds: ['l-other'],
              door: {
                priceCents: 8_000,
                carrierRateCents: 8_000,
                serviceName: 'Bob Go Saver',
                serviceCode: 'SAV',
                providerSlug: 'bobgo',
                serviceLevelCode: 'SAV',
                deliveryDaysMin: 3,
                deliveryDaysMax: 5,
              },
            }),
          ]),
      }),
    );

    render(
      <CartDeliveryPicker
        lines={[
          { listingId: 'l-goods' },
          { listingId: 'l-other' },
        ]}
        deliveryAddress={ADDRESS}
        chosen={{}}
        onChoose={onChoose}
        onGroups={onGroups}
        sellerNames={{ 'l-goods': 'johan', 'l-other': 'ana' }}
      />,
    );

    // One row per seller accessories group — and the buyer can see whose.
    expect(await screen.findByText(/johan — delivery for this item/i)).toBeInTheDocument();
    expect(screen.getByText(/ana — delivery for this item/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Cheapest Door Delivery/)).toHaveLength(2);
    // Each group defaults to its cheapest door: one choice per group, not per line.
    await waitFor(() => {
      expect(onChoose).toHaveBeenCalledWith(
        'q-1',
        expect.objectContaining({ kind: 'DOOR_CHEAPEST' }),
      );
      expect(onChoose).toHaveBeenCalledWith(
        'q-2',
        expect.objectContaining({ kind: 'DOOR_CHEAPEST' }),
      );
    });
    // Group shape is reported to the cart so Continue can be gated on it.
    expect(onGroups).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ groupKey: 'q-1', sellerName: 'johan' }),
        expect.objectContaining({ groupKey: 'q-2', sellerName: 'ana' }),
      ]),
    );
  });

  it('asks for an address before quoting anything', () => {
    render(
      <CartDeliveryPicker
        lines={[{ listingId: 'l-goods' }]}
        deliveryAddress={null}
        chosen={{}}
        onChoose={() => undefined}
        onGroups={() => undefined}
      />,
    );
    expect(
      screen.getByText(/Enter your delivery address to see delivery options/i),
    ).toBeInTheDocument();
  });
});
