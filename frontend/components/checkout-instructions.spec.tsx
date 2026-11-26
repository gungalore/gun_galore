// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Phase D — the delivery-instructions payload. These mount the REAL
// CheckoutForm and pay through its real handleProceed(), asserting what the
// server would actually receive: the note rides along only when the buyer
// opted in, and only once they explicitly saved it.

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

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

// Stable getToken identity — the checkout's effects depend on it.
vi.mock('../lib/auth', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken }) };
});

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

vi.mock('@/components/payments-coming-soon', () => ({
  PaymentsComingSoon: () => null,
}));

// A picked, priced door option — the real picker needs a network round-trip;
// this stub makes the form ready so the payload can be inspected.
vi.mock('@/components/delivery-options-picker', () => ({
  DeliveryOptionsPicker: ({ onSelect }: { onSelect: (option: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          kind: 'DOOR_CHEAPEST',
          carrierRateCents: 7500,
          serviceCode: 'door-cheap',
          providerSlug: 'bobgo',
          serviceLevelCode: 'econ',
          deliveryDaysMin: 2,
          deliveryDaysMax: 4,
          label: 'Cheapest Door Delivery',
          detail: 'Bob Go · estimated 1–2 Mar',
          serviceName: 'Bob Go',
          priceCents: 7500,
        })
      }
    >
      Choose cheapest option
    </button>
  ),
}));

import { CheckoutForm } from '../app/checkout/[listingId]/checkout-form';

/** Bodies POSTed to /transactions in the current test. */
let transactionPayloads: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  transactionPayloads = [];
  global.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/users/me/addresses')) return json([DEFAULT_ADDR]);
      if (url.endsWith('/users/me')) return json(ME);
      if (url.includes('/transactions/hold')) {
        return json({
          holdId: 'h1',
          listingId: LISTING.id,
          quantity: 1,
          serverNow: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        });
      }
      if (url.endsWith('/transactions') && init?.method === 'POST') {
        transactionPayloads.push(
          JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
        );
        return json({
          transactionId: 't1',
          paymentId: 'mock-1',
          breakdown: {
            listingPrice: 100000,
            shippingCost: 7500,
            commissionZar: 0,
            processingFee: 0,
            buyerTotal: 110750,
            sellerPayout: 100000,
          },
        });
      }
      return json({});
    },
  ) as unknown as typeof fetch;
});

/** Wait until the address is seeded (the picker reset effect has run) and the
 *  door option makes Pay ready. */
async function waitForReadyPayButton() {
  await screen.findByText('Delivery to');
  fireEvent.click(
    await screen.findByRole('button', { name: /choose cheapest option/i }),
  );
  let pay: HTMLElement | undefined;
  await waitFor(() => {
    pay = screen.getAllByRole('button', { name: /^pay /i })[0];
    expect(pay).toBeTruthy();
    expect((pay as HTMLButtonElement).disabled).toBe(false);
  });
  return pay!;
}

describe('CheckoutForm delivery instructions', () => {
  it('sends deliveryInstructions only when opted in and saved', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const pay = await waitForReadyPayButton();

    const checkbox = screen.getByRole('checkbox', {
      name: /want to add delivery instructions/i,
    });
    fireEvent.click(checkbox);

    const textarea = screen.getByLabelText(
      /for the driver/i,
    ) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(120);

    fireEvent.change(textarea, {
      target: { value: 'Leave at gate, ring twice' },
    });
    expect(screen.getByText('25/120')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /save note/i }));
    expect(
      screen.getByText(/this note will be printed on your delivery label/i),
    ).toBeTruthy();

    fireEvent.click(pay);

    await waitFor(() => expect(transactionPayloads.length).toBe(1));
    expect(transactionPayloads[0].deliveryInstructions).toBe(
      'Leave at gate, ring twice',
    );
  });

  it('never sends deliveryInstructions when the option was not ticked', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const pay = await waitForReadyPayButton();

    fireEvent.click(pay);

    await waitFor(() => expect(transactionPayloads.length).toBe(1));
    expect('deliveryInstructions' in transactionPayloads[0]).toBe(false);
  });

  it('does not send an unsaved draft, and clears the note when unticked', async () => {
    render(<CheckoutForm listing={LISTING as never} />);
    const pay = await waitForReadyPayButton();

    const checkbox = screen.getByRole('checkbox', {
      name: /want to add delivery instructions/i,
    });
    fireEvent.click(checkbox);
    fireEvent.change(
      screen.getByLabelText(/for the driver/i) as HTMLTextAreaElement,
      { target: { value: 'Ring the bell' } },
    );

    // Untick before paying: the draft must not survive.
    fireEvent.click(checkbox);
    expect(screen.queryByLabelText(/for the driver/i)).toBeNull();

    fireEvent.click(pay);
    await waitFor(() => expect(transactionPayloads.length).toBe(1));
    expect('deliveryInstructions' in transactionPayloads[0]).toBe(false);
  });
});
