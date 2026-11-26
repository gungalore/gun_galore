// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrintDelivery from './print-delivery';
import { motivationsApi } from '@/lib/motivations-api';

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

/** The profile default the /users/me fallback fetches. */
const savedProfile = {
  addrStreet: '12 Loop Street',
  addrAddress2: 'Unit 4',
  addrSuburb: 'Gardens',
  addrCity: 'Cape Town',
  addrPostalCode: '8001',
  addrProvince: 'WESTERN_CAPE',
};

const profileBookRow = {
  id: 'profile',
  label: 'Profile address',
  building: null,
  street: savedProfile.addrStreet,
  address2: savedProfile.addrAddress2,
  suburb: savedProfile.addrSuburb,
  city: savedProfile.addrCity,
  postalCode: savedProfile.addrPostalCode,
  province: 'WESTERN_CAPE',
  lat: null,
  lng: null,
  isDefault: true,
};

/**
 * Stub fetch so the prefill sees a saved address (or none, when null). The
 * address BOOK is the source of truth now; /users/me is the fallback.
 */
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
        if (!profile) return json([]);
        if (!profile.addrSuburb) {
          return json([{ ...profileBookRow, suburb: '' }]);
        }
        return json([profileBookRow]);
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
    expect(await screen.findByText('Delivery to')).toBeDefined();
    expect(
      screen.getByText('12 Loop Street, Unit 4, Gardens, Cape Town, 8001'),
    ).toBeDefined();
    // The drawer body (address list + form) is not mounted while collapsed.
    expect(screen.queryByText('Delivery Addresses')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('opens the address drawer with the saved address and Add', async () => {
    renderComponent('DELIVER');
    await userEvent.click(await screen.findByRole('button', { name: /change/i }));

    const drawer = await screen.findByRole('dialog', {
      name: /select delivery address/i,
    });
    // The single saved address is listed — it is NOT hidden behind a "2+"
    // threshold (the 2026-11-26 @ruanda failure mode).
    expect(within(drawer).getByText('Profile address')).toBeTruthy();
    expect(within(drawer).getByText(/12 Loop Street/)).toBeTruthy();
    expect(within(drawer).getByText('Default')).toBeTruthy();
    expect(
      within(drawer).getByRole('button', { name: /add a new address/i }),
    ).toBeTruthy();

    // Close returns to the collapsed summary.
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Delivery to')).toBeTruthy();
  });

  it('applies the saved address picked in the drawer', async () => {
    renderComponent('DELIVER');
    await userEvent.click(await screen.findByRole('button', { name: /change/i }));

    const drawer = await screen.findByRole('dialog', {
      name: /select delivery address/i,
    });
    const radio = within(drawer).getByRole('radio', {
      name: /profile address/i,
    });
    if (!(radio as HTMLInputElement).checked) {
      await userEvent.click(radio);
    }
    await userEvent.click(
      within(drawer).getByRole('button', { name: 'Continue' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText(
        '12 Loop Street, Unit 4, Gardens, Cape Town, 8001',
      ),
    ).toBeTruthy();
  });

  it('quotes the default address without opening the drawer', async () => {
    const onSelection = vi.fn();
    renderComponent('DELIVER', vi.fn(), onSelection);

    // The quote is debounced (550 ms) against the prefilled address; it fires
    // without the seller ever opening the drawer.
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
    expect(await screen.findByText('Delivery to')).toBeDefined();
    expect(screen.getByText(/looks incomplete/i)).toBeDefined();
  });

  it('shows a "Select Delivery Address" row and the drawer form when nothing was prefilled', async () => {
    stubPrefill(null);
    renderComponent('DELIVER');
    expect(await screen.findByText('Select Delivery Address')).toBeDefined();

    await userEvent.click(
      screen.getByRole('button', { name: /^select$/i }),
    );
    const drawer = await screen.findByRole('dialog', {
      name: /select delivery address/i,
    });
    expect(
      await within(drawer).findByText(/don’t have any saved addresses yet/i),
    ).toBeTruthy();
    await userEvent.click(
      within(drawer).getByRole('button', { name: /add a new address/i }),
    );
    expect(
      within(drawer).getByPlaceholderText('Street address *'),
    ).toBeTruthy();
  });
});
