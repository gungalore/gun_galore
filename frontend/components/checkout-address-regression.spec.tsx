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
//     no visible way to change or add an address. The fix is the address
//     DRAWER that lists every saved address and offers Add / Edit / Delete.
//
// These specs mount the real CheckoutForm so the drawer is proved through the
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

// Phase A0 — the backend returns Peach ONLY now. The mock mirrors the real
// hook's shape exactly (including `loading`) so the checkout's readiness gate
// is exercised with a live rail.
vi.mock('@/lib/payment-methods', () => ({
  usePaymentMethods: () => ({
    methods: [
      {
        provider: 'PEACH',
        label: 'Credit & Debit Card',
        description: 'Pay securely by card.',
      },
    ],
    provider: 'PEACH',
    setProvider: vi.fn(),
    loading: false,
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
/** /users/me payload. Per-test override (an empty address book falls back to
 *  this profile address, so the "no address anywhere" case needs both). */
let meRow: Record<string, unknown> = ME;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  addressRows = [DEFAULT_ADDR];
  meRow = ME;
  global.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
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
          const created = {
            id: 'a9',
            label: (body.label as string | null) ?? null,
            building: body.building ?? null,
            street: body.street,
            address2: body.address2 ?? null,
            suburb: body.suburb ?? null,
            city: body.city,
            postalCode: body.postalCode,
            province: body.province,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            isDefault: body.isDefault === true,
          } as MockAddress;
          addressRows = [created, ...addressRows];
          return json(created);
        }
        if (method === 'PATCH') {
          const id = decodeURIComponent(url.split('/').pop() ?? '');
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<
            string,
            unknown
          >;
          addressRows = addressRows.map((row) =>
            row.id === id ? ({ ...row, ...body, id } as MockAddress) : row,
          );
          return json(addressRows.find((row) => row.id === id));
        }
        if (method === 'DELETE') {
          const id = decodeURIComponent(url.split('/').pop() ?? '');
          addressRows = addressRows.filter((row) => row.id !== id);
          return json({ deleted: true });
        }
        return json(addressRows);
      }
      if (url.includes('/users/me/buyer-phone')) return json({ phone: ME.phone });
      if (url.endsWith('/users/me')) return json(meRow);
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

async function openDrawer() {
  // The summary row's control is "Change" once an address is seeded from the
  // book (or "Select" when there is none).
  const change = await screen.findByRole('button', {
    name: /^(change|select)$/i,
  });
  fireEvent.click(change);
  return screen.findByRole('dialog', { name: /select delivery address/i });
}

describe('CheckoutForm delivery address', () => {
  it('seeds the effective address from the book default and opens the drawer listing a single saved address', async () => {
    render(<CheckoutForm listing={LISTING as never} />);

    // The book default is what the summary shows — not a bare prompt.
    expect(await screen.findByText('Delivery to')).toBeTruthy();
    expect(screen.getAllByText(/36 Sterappel Crescent/).length).toBeGreaterThan(0);

    const drawer = await openDrawer();
    expect(
      await within(drawer).findByText(/36 Sterappel Crescent/),
    ).toBeTruthy();
    expect(within(drawer).getByText('Default')).toBeTruthy();
    expect(
      within(drawer).getByRole('button', { name: /add a new address/i }),
    ).toBeTruthy();
    expect(within(drawer).getByText('Delivery Addresses')).toBeTruthy();
  });

  it('accepts a typed address after opening the drawer (regression for @ruanda)', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const drawer = await openDrawer();
    await within(drawer).findByText(/36 Sterappel Crescent/);

    fireEvent.click(
      within(drawer).getByRole('button', { name: /add a new address/i }),
    );

    // The form's autocomplete is prefilled with the saved address. Typing a
    // new one must reach the street field the payload is built from.
    const combo = within(drawer).getByPlaceholderText('Search for address…');
    fireEvent.change(combo, { target: { value: '10 New Road' } });

    await waitFor(() => {
      const street = within(drawer).getByPlaceholderText(
        'Street address *',
      ) as HTMLInputElement;
      expect(street.value).toBe('10 New Road');
    });
  });

  it('picks a saved address in the drawer and applies it on Continue', async () => {
    addressRows = [DEFAULT_ADDR, WORK_ADDR];
    render(<CheckoutForm listing={LISTING as never} />);

    const drawer = await openDrawer();
    const work = await within(drawer).findByRole('radio', { name: /Work/i });
    fireEvent.click(work);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Continue' }));

    // The drawer closes and the collapsed summary now names the picked place.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/9 Office Park/)).toBeTruthy();
  });

  it('adds a new address with fresh coordinates, then applies it on Continue', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const drawer = await openDrawer();
    await within(drawer).findByText(/36 Sterappel Crescent/);

    fireEvent.click(
      within(drawer).getByRole('button', { name: /add a new address/i }),
    );

    // Typing replaces the prefilled street; typing alone invalidates the old
    // coordinates, so the member picks a suggestion (which captures all the
    // components + fresh coords) before saving.
    fireEvent.change(within(drawer).getByPlaceholderText('Search for address…'), {
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
    const option = await within(drawer).findByRole(
      'option',
      { name: /10 New Road/i },
      { timeout: 3000 },
    );
    fireEvent.mouseDown(option);

    await waitFor(() => {
      const street = within(drawer).getByPlaceholderText(
        'Street address *',
      ) as HTMLInputElement;
      expect(street.value).toBe('10 New Road');
    });
    fireEvent.click(
      within(drawer).getByRole('button', { name: /save address/i }),
    );

    // The save handler awaits the token then POSTs; give it headroom when the
    // whole suite is competing for the worker (this is a timing flake, not a
    // behaviour change — the drawer's internals are untouched by the layout).
    await waitFor(
      () => {
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
      },
      { timeout: 5000 },
    );

    // Saving returns to the list with the new row selected; Continue applies.
    const cont = await within(drawer).findByRole('button', { name: 'Continue' });
    fireEvent.click(cont);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/10 New Road/)).toBeTruthy();
  });

  it('falls back to the book default when the selected address is deleted', async () => {
    addressRows = [DEFAULT_ADDR, WORK_ADDR];
    render(<CheckoutForm listing={LISTING as never} />);

    // Pick Work, so the selected row is the one we then delete.
    let drawer = await openDrawer();
    fireEvent.click(await within(drawer).findByRole('radio', { name: /Work/i }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/9 Office Park/)).toBeTruthy();

    drawer = await openDrawer();
    await within(drawer).findByRole('radio', { name: /Work/i });
    fireEvent.click(
      within(drawer).getByRole('button', { name: /delete work/i }),
    );
    fireEvent.click(
      within(drawer).getByRole('button', { name: /^delete$/i }),
    );
    await waitFor(() =>
      expect(within(drawer).queryByText('9 Office Park')).toBeNull(),
    );
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Default (a1) is the fallback the server remembers.
    expect(await screen.findByText(/36 Sterappel Crescent/)).toBeTruthy();
  });

  it('offers Select Delivery Address in the sticky summary and opens the drawer when there is none', async () => {
    // No address anywhere: an empty book AND an empty profile fallback.
    addressRows = [];
    meRow = {
      ...ME,
      addrBuilding: null,
      addrStreet: null,
      addrAddress2: null,
      addrSuburb: null,
      addrCity: null,
      addrPostalCode: null,
      addrProvince: null,
      addrLat: null,
      addrLng: null,
    };

    render(<CheckoutForm listing={LISTING as never} />);

    // The summary CTA (right rail + the mobile bar) is an action, not a dead
    // disabled Pay button: both open the same address drawer.
    const ctas = await screen.findAllByRole('button', {
      name: /^select delivery address$/i,
    });
    expect(ctas.length).toBeGreaterThan(0);
    fireEvent.click(ctas[0]);

    expect(
      await screen.findByRole('dialog', { name: /select delivery address/i }),
    ).toBeTruthy();
  });
});
