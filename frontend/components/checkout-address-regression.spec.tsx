// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

// ── The 2026-11-26 delivery-address regression ───────────────────────────
// @ruanda reported "I am unable to select a different delivery address to
// ship the product". Two failures stacked:
//
//  1. The checkout address editor's autocomplete `onChange` only mirrored
//     typed text into `street` when street was EMPTY; the editor opens
//     prefilled from the saved address, so every keystroke was silently
//     discarded and the parcel stayed on the old address. Fixed in d04e9d73;
//     the typed-text test below keeps it fixed.
//  2. "Select a different address" swapped the summary row for an inline
//     editor that looked like the address already shown — the saved-address
//     picker hides itself below 2 addresses, so a member with exactly one had
//     no visible way to change or add an address. The second fix is a real
//     dialog that lists the saved address and offers "Add a new address".
//
// These specs mount the real CheckoutForm so the dialog is proved through the
// same wiring a buyer gets.

type MockAddress = {
  id: string;
  label: string | null;
  building: string | null;
  street: string;
  address2: string | null;
  suburb: string | null;
  city: string;
  postalCode: string;
  province: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const DEFAULT_ADDR: MockAddress = {
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

const WORK_ADDR: MockAddress = {
  ...DEFAULT_ADDR,
  id: 'a2',
  label: 'Work',
  street: '9 Office Park',
  suburb: 'Century City',
  postalCode: '7441',
  isDefault: false,
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

// ⚠️ STABLE getToken IDENTITY. The checkout's effects depend on `getToken`;
// returning a fresh async function per render re-fires them forever (the
// address/me fetches looped and unmounted the suggestion list mid-test).
vi.mock('../lib/auth', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken }) };
});

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

/** Address-book rows the mocked backend returns. Per-test override. */
let addressRows: MockAddress[] = [DEFAULT_ADDR];

beforeEach(() => {
  addressRows = [DEFAULT_ADDR];
  global.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      // Address suggestions / details: picking one refreshes the coordinates.
      if (url.includes('/listings/place-autocomplete')) {
        return json({
          suggestions: [
            { placeId: 'p1', text: '10 New Road, Testville, Cape Town, 7570' },
          ],
        });
      }
      if (url.includes('/listings/place/')) {
        return json({
          place: {
            placeId: 'p1',
            name: '10 New Road',
            address: '10 New Road, Testville, Cape Town, 7570',
            street: '10 New Road',
            suburb: 'Testville',
            city: 'Cape Town',
            province: 'Western Cape',
            postalCode: '7570',
            lat: -33.9,
            lng: 18.7,
          },
        });
      }
      if (url.includes('/users/me/addresses')) {
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<
            string,
            unknown
          >;
          // Mirrors the server: the saved row comes back with its own id.
          return json({
            id: 'a9',
            label: null,
            building: body.building ?? null,
            street: body.street,
            address2: body.address2 ?? null,
            suburb: body.suburb ?? null,
            city: body.city,
            postalCode: body.postalCode,
            province: body.province,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            isDefault: false,
            createdAt: '2026-11-26T00:00:00.000Z',
            updatedAt: '2026-11-26T00:00:00.000Z',
          });
        }
        return json(addressRows);
      }
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
    },
  ) as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openDialog() {
  const change = await screen.findByRole('button', {
    name: /select a different address/i,
  });
  fireEvent.click(change);
  return screen.findByRole('dialog', { name: /delivery address/i });
}

describe('CheckoutForm delivery address', () => {
  it('opens the address window listing the single saved address and "Add a new address" (regression for @ruanda)', async () => {
    render(<CheckoutForm listing={LISTING as never} />);

    const dialog = await openDialog();

    // Exactly one saved address: it is LISTED, not hidden behind the old
    // "2+ addresses" threshold that made the control look inert.
    expect(
      await within(dialog).findByText(/36 Sterappel Crescent/),
    ).toBeTruthy();
    expect(within(dialog).getByText('Default')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    ).toBeTruthy();
  });

  it('accepts a typed address after opening the dialog (regression for @ruanda)', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const dialog = await openDialog();
    await within(dialog).findByText(/36 Sterappel Crescent/);

    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );

    // The form's autocomplete is prefilled with the saved address. Typing a
    // new one must reach the street field the payload is built from.
    const combo = within(dialog).getByPlaceholderText('Search for address…');
    fireEvent.change(combo, { target: { value: '10 New Road' } });

    await waitFor(() => {
      const street = within(dialog).getByPlaceholderText(
        'Street address *',
      ) as HTMLInputElement;
      expect(street.value).toBe('10 New Road');
    });
  });

  it('selects a saved address from the dialog and applies it to the order', async () => {
    addressRows = [DEFAULT_ADDR, WORK_ADDR];
    render(<CheckoutForm listing={LISTING as never} />);

    const dialog = await openDialog();
    const work = await within(dialog).findByRole('radio', { name: /Work/i });
    fireEvent.click(work);

    // The dialog closes and the collapsed summary now names the picked place.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/9 Office Park/)).toBeTruthy();
  });

  it('saves a new address to the book, uses it for the order, and closes', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const dialog = await openDialog();
    await within(dialog).findByText(/36 Sterappel Crescent/);

    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );

    // Typing replaces the prefilled street; typing alone invalidates the old
    // coordinates, so the member picks a suggestion (which captures all the
    // components + fresh coords) before saving.
    fireEvent.change(within(dialog).getByPlaceholderText('Search for address…'), {
      target: { value: '10 New Road' },
    });
    // The autocomplete is debounced (220 ms) and then fetches suggestions.
    await waitFor(
      () => {
        expect(
          (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
            ([url]) => String(url).includes('/listings/place-autocomplete'),
          ),
        ).toBe(true);
      },
      { timeout: 3000 },
    );
    const option = await within(dialog).findByRole(
      'option',
      { name: /10 New Road/i },
      { timeout: 3000 },
    );
    fireEvent.mouseDown(option);

    await waitFor(() => {
      const street = within(dialog).getByPlaceholderText(
        'Street address *',
      ) as HTMLInputElement;
      expect(street.value).toBe('10 New Road');
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /save and use this address/i }),
    );

    await waitFor(() => {
      const call = (
        global.fetch as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.find(
        ([url, init]) =>
          String(url).includes('/users/me/addresses') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call![1] as RequestInit).body));
      expect(body.street).toBe('10 New Road');
      expect(body.suburb).toBe('Testville');
      expect(body.city).toBe('Cape Town');
      expect(body.postalCode).toBe('7570');
      expect(body.province).toBe('WESTERN_CAPE');
      // Coordinates ride along — a door quote needs them.
      expect(body.lat).toBe(-33.9);
      expect(body.lng).toBe(18.7);
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/10 New Road/)).toBeTruthy();
  });
});
