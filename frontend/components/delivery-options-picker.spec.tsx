// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeliveryOptionsPicker } from './delivery-options-picker';
import { formatPrice } from '@/lib/utils';

// Phase C — Takealot-style delivery date cards. ONE POST /shipping/delivery-
// options call feeds the whole picker; these specs pin the card promises
// (Fastest/Cheapest date labels), the Pargo group, and the loading / error /
// no-address / no-options states.

const ADDRESS = {
  streetAddress: '1 Main Road',
  suburb: 'Tokai',
  city: 'Cape Town',
  postalCode: '7945',
  province: 'WESTERN_CAPE',
  lat: -34.06,
  lng: 18.46,
};

const CHEAPEST = {
  priceCents: 8500,
  carrierRateCents: 8500,
  serviceName: 'Bob Go Door – Economy',
  serviceCode: 'door-cheap',
  providerSlug: 'bobgo',
  serviceLevelCode: 'econ',
  deliveryDaysMin: 2,
  deliveryDaysMax: 4,
  minDeliveryDate: '2027-03-01',
  maxDeliveryDate: '2027-03-02',
};

const FASTEST = {
  priceCents: 12000,
  carrierRateCents: 12000,
  serviceName: 'Bob Go Door – Express',
  serviceCode: 'door-fast',
  providerSlug: 'bobgo',
  serviceLevelCode: 'express',
  deliveryDaysMin: 1,
  deliveryDaysMax: 1,
  minDeliveryDate: '2027-02-27',
  maxDeliveryDate: '2027-02-27',
};

const PARGO_A = {
  priceCents: 6000,
  carrierRateCents: 6000,
  serviceName: 'Pargo Click & Collect – Clicks – Pinehurst',
  serviceCode: 'pargo-a',
  providerSlug: 'bobgo',
  serviceLevelCode: 'pargo',
  pickupPointLocationId: 11,
  pickupPointDistanceKm: 1.2,
  description: 'Mon–Fri 08:00–17:00\nCorner Pinehurst & Main',
  deliveryDaysMin: 2,
  deliveryDaysMax: 3,
};

const PARGO_B = {
  ...PARGO_A,
  serviceName: 'Pargo Click & Collect – Engen – Tokai',
  serviceCode: 'pargo-b',
  pickupPointLocationId: 12,
  pickupPointDistanceKm: 4.5,
  priceCents: 5500,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function quote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    door: CHEAPEST,
    fastestDoor: FASTEST,
    storePickup: [PARGO_A, PARGO_B],
    ...overrides,
  };
}

function mockFetch(...responses: Array<() => Response>) {
  let index = 0;
  const fn = vi.fn(async () => {
    const make = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return make();
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Nothing global to restore; the picker only ever reads global.fetch.
});

function renderPicker(
  onSelect: (option: unknown) => void = vi.fn(),
  address: typeof ADDRESS | null = ADDRESS,
) {
  render(
    <DeliveryOptionsPicker
      listingId="l1"
      deliveryAddress={address}
      onSelect={onSelect as never}
    />,
  );
}

// Independent weekday/date expectation — does not reuse the component helper.
function expectedDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date
    .toLocaleDateString('en-ZA', { weekday: 'short', timeZone: 'UTC' })
    .replace(/[,.]/g, '')
    .trim();
  const dayMonth = date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${weekday} ${dayMonth}`;
}

describe('DeliveryOptionsPicker', () => {
  it('renders Fastest and Cheapest door cards with their date promises, services and prices', async () => {
    const onSelect = vi.fn();
    mockFetch(() => json(quote()));
    renderPicker(onSelect);

    const fastest = await screen.findByRole('button', { name: /fastest/i });
    const cheapest = screen.getByRole('button', { name: /cheapest/i });

    // Labels, date promises and service names.
    expect(fastest.textContent).toContain('Fastest');
    expect(fastest.textContent).toContain(expectedDay('2027-02-27'));
    expect(fastest.textContent).toContain('Bob Go Door – Express');
    expect(cheapest.textContent).toContain('Cheapest');
    // A two-day window reads as a range, both ends visible.
    expect(cheapest.textContent).toContain('1–2 Mar');
    expect(cheapest.textContent).toContain('Bob Go Door – Economy');

    // Prices on the cards (the buyer sees ONE figure per option).
    expect(screen.getAllByText(formatPrice(8500)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatPrice(12000)).length).toBeGreaterThan(0);

    // The server-quoted default stays Cheapest, and the parent is told.
    expect(cheapest.getAttribute('aria-pressed')).toBe('true');
    expect(fastest.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'DOOR_CHEAPEST' }),
      );
    });
  });

  it('switches the selection to Fastest when its card is clicked', async () => {
    const onSelect = vi.fn();
    mockFetch(() => json(quote()));
    renderPicker(onSelect);

    const fastest = await screen.findByRole('button', { name: /fastest/i });
    fireEvent.click(fastest);

    expect(fastest.getAttribute('aria-pressed')).toBe('true');
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'DOOR_FASTEST', priceCents: 12000 }),
    );
  });

  it('groups Pargo counters under "Collect from a store" and reveals directions when selected', async () => {
    const onSelect = vi.fn();
    mockFetch(() => json(quote()));
    renderPicker(onSelect);

    expect(await screen.findByText('Collect from a store')).toBeTruthy();

    const first = screen.getByRole('button', {
      name: /Pargo – Clicks – Pinehurst/i,
    });
    expect(first.textContent).toContain('1.2 km away');
    expect(first.textContent).toContain(formatPrice(6000));
    // Directions/trading hours stay collapsed while the card is unselected.
    expect(first.textContent).not.toContain('Corner Pinehurst & Main');

    fireEvent.click(first);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Pargo – Clicks – Pinehurst/i })
          .textContent,
      ).toContain('Corner Pinehurst & Main');
    });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'STORE_PICKUP', pickupPointLocationId: 11 }),
    );

    // The second counter is still listed with its own store + distance.
    const second = screen.getByRole('button', { name: /Pargo – Engen – Tokai/i });
    expect(second.textContent).toContain('4.5 km away');
  });

  it('shows the error state with a working Try again', async () => {
    const onSelect = vi.fn();
    const fetchMock = mockFetch(
      () => json({ message: 'Courier is unavailable right now.' }, 500),
      () => json(quote()),
    );
    renderPicker(onSelect);

    expect(await screen.findByText('Courier is unavailable right now.')).toBeTruthy();
    const retry = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retry);

    expect(await screen.findByRole('button', { name: /cheapest/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks for an address (and does not call the API) when the address is incomplete', async () => {
    const fetchMock = mockFetch(() => json(quote()));
    renderPicker(vi.fn(), null);

    expect(
      screen.getByText(/Enter your delivery address to see the delivery price/i),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the no-options state when the courier does not serve the address', async () => {
    mockFetch(() => json(quote({ door: null, fastestDoor: null, storePickup: [] })));
    renderPicker();

    expect(
      await screen.findByText(/No delivery option is available for this parcel/i),
    ).toBeTruthy();
  });
});
