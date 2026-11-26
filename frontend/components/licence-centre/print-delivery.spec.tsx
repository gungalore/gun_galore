// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrintDelivery from './print-delivery';
import { motivationsApi } from '@/lib/motivations-api';

vi.mock('@/components/saved-address-picker', () => ({
  SavedAddressPicker: () => null,
}));

vi.mock('@/lib/motivations-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/motivations-api')>();
  return {
    ...actual,
    motivationsApi: {
      ...actual.motivationsApi,
      printQuote: vi.fn(async () => ({
        motivationCents: 29_500,
        printFeeCents: 7_500,
        shippingCents: 5_000,
        totalCents: 42_000,
        serviceName: 'Door to door',
        deliveryDaysMin: 1,
        deliveryDaysMax: 2,
      })),
    },
  };
});

const token = async () => 't';

/** The profile default the /users/me prefill fetches. */
const savedProfile = {
  addrStreet: '12 Loop Street',
  addrAddress2: 'Unit 4',
  addrSuburb: 'Gardens',
  addrCity: 'Cape Town',
  addrPostalCode: '8001',
  addrProvince: 'WC',
};

/** Stub fetch so the prefill sees a saved address (or none, when null). */
function stubPrefill(profile: typeof savedProfile | null = savedProfile) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.includes('/users/me/addresses')) {
        // The backend lists the profile address as a book row, so the address
        // dialog has exactly one default row for a member with one address.
        return profile
          ? json([
              {
                id: 'profile',
                label: 'Profile address',
                building: null,
                street: profile.addrStreet,
                address2: profile.addrAddress2,
                suburb: profile.addrSuburb,
                city: profile.addrCity,
                postalCode: profile.addrPostalCode,
                province: 'WESTERN_CAPE',
                lat: null,
                lng: null,
                isDefault: true,
              },
            ])
          : json([]);
      }
      if (url.endsWith('/users/me')) {
        return profile
          ? json(profile)
          : new Response(JSON.stringify({ message: 'Not found' }), {
              status: 500,
            });
      }
      return json({});
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubPrefill();
});

function renderComponent(
  mode: 'DIGITAL' | 'DELIVER',
  onModeChange = vi.fn(),
  onSelection = vi.fn(),
) {
  return render(
    <PrintDelivery
      motivationId="mo-1"
      token={token}
      baseCents={29_500}
      feeCents={7_500}
      mode={mode}
      locked={false}
      onModeChange={onModeChange}
      onSelection={onSelection}
    />,
  );
}

describe('Print and Deliver', () => {
  it('offers Print / Download and Print and Deliver (R75)', () => {
    renderComponent('DIGITAL');
    expect(screen.getByRole('button', { name: /Print \/ Download/i })).toBeDefined();
    expect(
      screen.getByRole('button', { name: /Print and Deliver/i }),
    ).toBeDefined();
    expect(screen.getByText(/R 75/)).toBeDefined();
  });

  it('asks the server to switch the mode', async () => {
    const onModeChange = vi.fn();
    renderComponent('DIGITAL', onModeChange);
    await userEvent.click(screen.getByRole('button', { name: /Print and Deliver/i }));
    expect(onModeChange).toHaveBeenCalledWith('DELIVER');
  });

  it('publishes the single-payment total to the pack page', async () => {
    const onSelection = vi.fn();
    renderComponent('DIGITAL', vi.fn(), onSelection);
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'DIGITAL', totalCents: 29_500 }),
      ),
    );
  });

  it('collapses the prefilled default address into the summary row', async () => {
    renderComponent('DELIVER');
    expect(await screen.findByText('Deliver to my default address')).toBeDefined();
    expect(
      screen.getByText('12 Loop Street, Unit 4, Gardens, Cape Town, 8001'),
    ).toBeDefined();
    // The editor (address book + fields) is not mounted while collapsed.
    expect(screen.queryByText('Delivery address')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('opens the address window with the saved address and "Add a new address"', async () => {
    renderComponent('DELIVER');
    await userEvent.click(await screen.findByText('Select a different address'));

    const dialog = await screen.findByRole('dialog', {
      name: /delivery address/i,
    });
    // The single saved address is listed — it is NOT hidden behind a "2+"
    // threshold (the 2026-11-26 @ruanda failure mode).
    expect(within(dialog).getByText('Profile address')).toBeTruthy();
    expect(within(dialog).getByText(/12 Loop Street/)).toBeTruthy();
    expect(within(dialog).getByText('Default')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    ).toBeTruthy();

    // Cancel closes back to the collapsed default summary.
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );
    expect(await screen.findByText('Deliver to my default address')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('quotes the default address without opening the editor', async () => {
    const onSelection = vi.fn();
    renderComponent('DELIVER', vi.fn(), onSelection);

    // The quote is debounced (550 ms) against the prefilled address; it fires
    // without the seller ever opening the editor.
    await waitFor(() => expect(motivationsApi.printQuote).toHaveBeenCalled(), {
      timeout: 4000,
    });
    expect((await screen.findByText(/Door to door/, {}, { timeout: 4000 }))).toBeDefined();
    await waitFor(
      () =>
        expect(onSelection).toHaveBeenCalledWith(
          expect.objectContaining({ mode: 'DELIVER', totalCents: 42_000 }),
        ),
      { timeout: 4000 },
    );
  });

  it('warns when the saved default address is incomplete', async () => {
    stubPrefill({ ...savedProfile, addrSuburb: '' });
    renderComponent('DELIVER');
    expect(await screen.findByText('Deliver to my default address')).toBeDefined();
    expect(screen.getByText(/looks incomplete/i)).toBeDefined();
  });

  it('shows the editor directly when no saved address was prefilled', async () => {
    stubPrefill(null);
    renderComponent('DELIVER');
    await waitFor(() => expect(screen.getByText('Delivery address')).toBeDefined());
    expect(screen.queryByText('Deliver to my default address')).toBeNull();
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});
