// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── The 2026-11-26 delivery-address regression ───────────────────────────
// @ruanda reported "I am unable to select a different delivery address to
// ship the product". Root cause: the checkout address editor's autocomplete
// onChange only mirrored typed text into `street` when street was EMPTY; the
// editor opens prefilled from the saved address, so every keystroke was
// silently discarded and the parcel stayed on the old address. This test
// mounts the real CheckoutForm, opens the editor and proves typed text reaches
// the submitted address fields.

const DEFAULT_ADDR = {
  id: 'a1',
  label: null,
  building: null,
  street: '36 Sterappel Crescent',
  address2: null,
  suburb: 'Langeberg Glen',
  city: 'Cape Town',
  postalCode: '7570',
  province: 'WESTERN_CAPE',
  lat: -33.8359558,
  lng: 18.6900397,
  isDefault: true,
  createdAt: '2026-11-24T21:02:20.173Z',
  updatedAt: '2026-11-24T21:02:20.173Z',
};

const ME = {
  id: 'u1',
  email: 'buyer@example.com',
  username: 'buyer',
  firstName: 'Buyer',
  lastName: 'Test',
  phone: '+27821234567',
  phoneVerified: true,
  emailVerifiedAt: '2026-11-01T00:00:00.000Z',
  addrBuilding: null,
  addrStreet: DEFAULT_ADDR.street,
  addrAddress2: null,
  addrSuburb: DEFAULT_ADDR.suburb,
  addrCity: DEFAULT_ADDR.city,
  addrPostalCode: DEFAULT_ADDR.postalCode,
  addrProvince: DEFAULT_ADDR.province,
  addrLat: DEFAULT_ADDR.lat,
  addrLng: DEFAULT_ADDR.lng,
};

const LISTING = {
  id: 'l1',
  referenceNumber: 'BN000001',
  sellerId: 's1',
  categoryId: 'c1',
  title: 'Match saver',
  description: 'A match saver for the range.',
  price: 1000,
  listingType: 'BUY_NOW',
  status: 'ACTIVE',
  condition: 'GOOD',
  province: 'WESTERN_CAPE',
  publicLocality: 'Cape Town',
  isFirearm: false,
  collectionOnly: false,
  shippingMethods: ['COURIER'],
  trackInventory: false,
  quantityAvailable: 1,
  acceptsOffers: true,
  images: [],
  category: { id: 'c1', name: 'Shooting accessories', slug: 'shooting-accessories' },
  seller: { id: 's1', username: 'seller' },
};

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('@/lib/payment-methods', () => ({
  usePaymentMethods: () => ({
    methods: [],
    provider: 'OZOW',
    setProvider: vi.fn(),
  }),
}));

vi.mock('@/components/payment-method-section', () => ({
  PaymentMethodSection: () => null,
}));

vi.mock('@/components/delivery-options-picker', () => ({
  DeliveryOptionsPicker: () => null,
}));

vi.mock('@/components/payments-coming-soon', () => ({
  PaymentsComingSoon: () => null,
}));

import { CheckoutForm } from '../app/checkout/[listingId]/checkout-form';

beforeEach(() => {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.includes('/users/me/addresses')) return json([DEFAULT_ADDR]);
    if (url.includes('/users/me/buyer-phone')) return json({ phone: ME.phone });
    if (url.endsWith('/users/me')) return json(ME);
    if (url.includes('/transactions/hold')) {
      return json({
        id: 'h1',
        listingId: LISTING.id,
        quantity: 1,
        serverNow: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    }
    return json({});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CheckoutForm delivery address', () => {
  it('accepts a typed address after opening the editor (regression for @ruanda)', async () => {
    render(<CheckoutForm listing={LISTING as never} />);

    // The collapsed row uses the saved default.
    const change = await screen.findByRole('button', {
      name: /select a different address/i,
    });
    fireEvent.click(change);

    // The editor's autocomplete is prefilled with the saved address. Typing a
    // new one must reach the address fields the payload is built from.
    const combo = await screen.findByPlaceholderText('Search for address…');
    fireEvent.change(combo, { target: { value: '10 New Road' } });

    await waitFor(() => {
      const street = document.querySelector(
        '#checkout-addr-street',
      ) as HTMLInputElement | null;
      expect(street).not.toBeNull();
      expect(street!.value).toBe('10 New Road');
    });
  });
});
