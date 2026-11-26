// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  DeliveryAddressDialog,
  type DeliveryAddressDialogProps,
} from './delivery-address-dialog';
import {
  emptyManualAddress,
  type ManualAddressValue,
} from './manual-address-fields';
import type { Address } from '@/lib/types';

// The delivery-address WINDOW (2026-11-26, member report @ruanda). These specs
// pin the three things that made "Select a different address" look inert:
// a single saved address is still listed, "Add a new address" is reachable in
// the same window, and saving a new address POSTs it to the book and then
// applies it to the order.

function address(overrides: Partial<Address> = {}): Address {
  return {
    id: 'a1',
    label: 'Home',
    building: null,
    street: '1 Main Rd',
    address2: null,
    suburb: 'Rondebosch',
    city: 'Cape Town',
    postalCode: '7700',
    province: 'WESTERN_CAPE',
    lat: -33.9,
    lng: 18.4,
    isDefault: true,
    ...overrides,
  };
}

const INITIAL_ADDRESS: ManualAddressValue = {
  building: '',
  street: '36 Sterappel Crescent',
  address2: '',
  suburb: 'Langeberg Glen',
  city: 'Cape Town',
  postalCode: '7570',
  province: 'WESTERN_CAPE',
};

type FetchStub = {
  rows?: Address[];
  postResult?: Address | null;
  postStatus?: number;
};

function stubFetch({ rows = [], postResult = null, postStatus = 200 }: FetchStub) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if ((init?.method ?? 'GET') === 'POST') {
        if (postStatus >= 400) {
          return json({ message: 'Could not save that address.' }, postStatus);
        }
        return json(postResult ?? rows[0]);
      }
      return json(rows);
    }),
  );
}

function renderDialog(overrides: Partial<DeliveryAddressDialogProps> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onUseOnce = vi.fn();
  const props: DeliveryAddressDialogProps = {
    initialAddress: INITIAL_ADDRESS,
    initialLat: -33.8359558,
    initialLng: 18.6900397,
    getToken: async () => 'test-token',
    onSelect,
    onUseOnce,
    onClose,
    idPrefix: 'test',
    ...overrides,
  };
  render(<DeliveryAddressDialog {...props} />);
  const dialog = screen.getByRole('dialog', { name: /delivery address/i });
  return { dialog, onSelect, onClose, onUseOnce };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeliveryAddressDialog', () => {
  it('lists a single saved address (default marked) and offers "Add a new address"', async () => {
    stubFetch({ rows: [address()] });
    const { dialog } = renderDialog();

    expect(await within(dialog).findByText('Home')).toBeTruthy();
    expect(within(dialog).getByText('Default')).toBeTruthy();
    expect(within(dialog).getByText(/1 Main Rd/)).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    ).toBeTruthy();
  });

  it('reveals the add-new form from the list and prefills it from the current address', async () => {
    stubFetch({ rows: [address()] });
    const { dialog } = renderDialog();

    await within(dialog).findByText('Home');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );

    const street = within(dialog).getByPlaceholderText(
      'Street address *',
    ) as HTMLInputElement;
    expect(street.value).toBe(INITIAL_ADDRESS.street);
    // Required fields are already satisfied by the prefill.
    const save = within(dialog).getByRole('button', {
      name: /save and use this address/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('selects a saved address and closes', async () => {
    const saved = address();
    stubFetch({ rows: [saved] });
    const { dialog, onSelect, onClose } = renderDialog();

    await within(dialog).findByText('Home');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Home/i }));

    expect(onSelect).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers the form directly when the book is empty', async () => {
    stubFetch({ rows: [] });
    const { dialog } = renderDialog();
    // No saved rows: the window must not be a dead end.
    expect(
      await within(dialog).findByText(/don’t have any saved addresses yet/i),
    ).toBeTruthy();
    expect(
      within(dialog).getByPlaceholderText('Street address *'),
    ).toBeTruthy();
  });

  it('saves a new address to the book, then applies it to the order', async () => {
    const saved = address({
      id: 'a9',
      label: null,
      street: '10 New Road',
      suburb: 'Athlone',
      city: 'Cape Town',
      postalCode: '7764',
      lat: -33.96,
      lng: 18.5,
    });
    stubFetch({ rows: [], postResult: saved });
    const { dialog, onSelect, onClose } = renderDialog({
      initialAddress: emptyManualAddress,
      initialLat: null,
      initialLng: null,
      requireCoords: false,
    });

    // Empty book: the form opens as soon as the (empty) list lands.
    await within(dialog).findByPlaceholderText('Street address *');
    fireEvent.change(
      within(dialog).getByPlaceholderText('Street address *'),
      { target: { value: '10 New Road' } },
    );
    fireEvent.change(within(dialog).getByPlaceholderText('Suburb *'), {
      target: { value: 'Athlone' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('City / Town *'), {
      target: { value: 'Cape Town' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('Postal code *'), {
      target: { value: '7764' },
    });
    fireEvent.change(document.getElementById('test-addr-province')!, {
      target: { value: 'WESTERN_CAPE' },
    });

    fireEvent.click(
      within(dialog).getByRole('button', { name: /save and use this address/i }),
    );

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(saved);

    const call = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body).toMatchObject({
      building: null,
      street: '10 New Road',
      suburb: 'Athlone',
      city: 'Cape Town',
      postalCode: '7764',
      province: 'WESTERN_CAPE',
      lat: null,
      lng: null,
      isDefault: false,
    });
  });

  it('shows a failed save inline and keeps the dialog open', async () => {
    stubFetch({ rows: [address()], postStatus: 500 });
    const { dialog, onSelect, onClose } = renderDialog();

    await within(dialog).findByText('Home');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: /save and use this address/i }),
    );

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not let the address be saved without coordinates on a courier checkout', async () => {
    stubFetch({ rows: [address()] });
    const { dialog } = renderDialog({ initialLat: null, initialLng: null });

    await within(dialog).findByText('Home');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );

    const save = within(dialog).getByRole('button', {
      name: /save and use this address/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(
      within(dialog).getByText(/pick your address from the suggestions/i),
    ).toBeTruthy();
  });

  it('uses a typed address for this order only when the book is unavailable', async () => {
    // Signed-out SMS-link checkout: no session, so no address book.
    stubFetch({ rows: [] });
    const { dialog, onSelect, onUseOnce, onClose } = renderDialog({
      canSaveToBook: false,
      requireCoords: false,
    });

    expect(
      within(dialog).getByText(/saved addresses aren’t available/i),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /save and use/i })).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: /^use this address$/i }),
    );
    expect(onUseOnce).toHaveBeenCalledWith(
      expect.objectContaining({ street: INITIAL_ADDRESS.street }),
      -33.8359558,
      18.6900397,
    );
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    // The session-only book is never even read.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    stubFetch({ rows: [address()] });
    const { onClose } = renderDialog();
    await screen.findByText(/1 Main Rd/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
