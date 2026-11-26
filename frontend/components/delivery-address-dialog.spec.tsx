// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import {
  DeliveryAddressDialog,
  type DeliveryAddressDialogProps,
} from './delivery-address-dialog';
import { type ManualAddressValue } from './manual-address-fields';
import type { Address } from '@/lib/types';

// The delivery-address DRAWER (2026-11-26, Takealot-parity checkout).
// Covered here: the saved list (even a single row), Continue applies + closes,
// Add POST body, Edit PATCH, Delete with inline confirm, the profile row's
// hidden delete, token mode, load-error retry, and "saving disables close".
// The d04e9d73 coordinate rules (typed text replaces street; editing a
// deciding field clears stale coords) are pinned below too.

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
    isDefault: false,
    ...overrides,
  };
}

const PROFILE_ROW = address({
  id: 'profile',
  label: 'Profile address',
  street: '12 Loop Street',
  suburb: 'Gardens',
  postalCode: '8001',
  isDefault: true,
});

const HOME_ROW = address();

const INITIAL_ADDRESS: ManualAddressValue = {
  building: '',
  street: '36 Sterappel Crescent',
  address2: '',
  suburb: 'Langeberg Glen',
  city: 'Cape Town',
  postalCode: '7570',
  province: 'WESTERN_CAPE',
};

let rows: Address[] = [];
let failNextGet = false;
let hangNextPost = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetchStub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/listings/place-autocomplete')) {
        return json({ suggestions: [] });
      }
      if (url.includes('/users/me/addresses')) {
        if (method === 'GET') {
          if (failNextGet) {
            failNextGet = false;
            return json({ message: 'boom' }, 500);
          }
          return json(rows);
        }
        if (method === 'POST') {
          if (hangNextPost) return new Promise<Response>(() => undefined);
          const body = JSON.parse(String(init?.body ?? '{}')) as Partial<Address>;
          const created = address({
            id: 'a9',
            label: body.label ?? null,
            street: body.street ?? '',
            suburb: body.suburb ?? null,
            city: body.city ?? '',
            postalCode: body.postalCode ?? '',
            province: body.province ?? 'WESTERN_CAPE',
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            isDefault: body.isDefault ?? false,
          });
          rows = [created, ...rows];
          return json(created, 201);
        }
        if (method === 'PATCH') {
          const id = decodeURIComponent(url.split('/').pop() ?? '');
          const body = JSON.parse(String(init?.body ?? '{}')) as Partial<Address>;
          const index = rows.findIndex((row) => row.id === id);
          if (index === -1) return json({ message: 'Address not found' }, 404);
          const updated = { ...rows[index], ...body, id } as Address;
          rows = rows.map((row) => (row.id === id ? updated : row));
          return json(updated);
        }
        if (method === 'DELETE') {
          const id = decodeURIComponent(url.split('/').pop() ?? '');
          rows = rows.filter((row) => row.id !== id);
          return json({ deleted: true });
        }
      }
      return json({});
    }),
  );
}

function renderDrawer(overrides: Partial<DeliveryAddressDialogProps> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onUseOnce = vi.fn();
  const onAddressesChanged = vi.fn();
  const props: DeliveryAddressDialogProps = {
    initialAddress: INITIAL_ADDRESS,
    initialLat: -33.8359558,
    initialLng: 18.6900397,
    getToken: async () => 'test-token',
    onSelect,
    onUseOnce,
    onAddressesChanged,
    onClose,
    idPrefix: 'test',
    recipient: { name: 'Buyer Test', phone: '+27821234567' },
    ...overrides,
  };
  render(<DeliveryAddressDialog {...props} />);
  const dialog = screen.getByRole('dialog', { name: /select delivery address/i });
  const closeButton = within(dialog).getByRole('button', { name: 'Close' });
  return { dialog, closeButton, onSelect, onClose, onUseOnce, onAddressesChanged };
}

beforeEach(() => {
  rows = [];
  failNextGet = false;
  hangNextPost = false;
  vi.clearAllMocks();
  installFetchStub();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeliveryAddressDialog (drawer)', () => {
  it('lists a single saved address with label, Default badge and recipient, plus Add', async () => {
    rows = [PROFILE_ROW];
    const { dialog } = renderDrawer();

    expect(await within(dialog).findByText('Profile address')).toBeTruthy();
    expect(within(dialog).getByText('Default')).toBeTruthy();
    expect(within(dialog).getByText('12 Loop Street')).toBeTruthy();
    expect(within(dialog).getByText(/Gardens, Cape Town, 8001/)).toBeTruthy();
    expect(within(dialog).getByText('Buyer Test · +27821234567')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    ).toBeTruthy();
    expect(within(dialog).getByText('Delivery Addresses')).toBeTruthy();
  });

  it('keeps Continue disabled until a row is selected, then applies and closes', async () => {
    rows = [HOME_ROW];
    const { dialog, onSelect, onClose } = renderDrawer();

    await within(dialog).findByText('Home');
    const cont = within(dialog).getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole('radio', { name: /Home/i }));
    expect(cont.disabled).toBe(false);
    fireEvent.click(cont);

    expect(onSelect).toHaveBeenCalledWith(HOME_ROW);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('adds an address: POSTs the body, returns to the list and selects the saved row', async () => {
    rows = [PROFILE_ROW];
    const { dialog, onSelect, onClose, onAddressesChanged } = renderDrawer({
      initialAddress: INITIAL_ADDRESS,
      initialLat: null,
      initialLng: null,
      requireCoords: false,
    });

    await within(dialog).findByText('Profile address');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );

    fireEvent.change(within(dialog).getByPlaceholderText('Street address *'), {
      target: { value: '10 New Road' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Home, Work'), {
      target: { value: 'Work' },
    });
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: /set as default delivery address/i,
      }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: /save address/i }),
    );

    await waitFor(() => expect(onAddressesChanged).toHaveBeenCalled());
    const call = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      ([url, init]) =>
        String(url).includes('/users/me/addresses') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body).toMatchObject({
      label: 'Work',
      street: '10 New Road',
      suburb: 'Langeberg Glen',
      city: 'Cape Town',
      postalCode: '7570',
      province: 'WESTERN_CAPE',
      isDefault: true,
    });

    // Back on the list with the new row selected; Continue applies it.
    expect(await within(dialog).findByText('Work')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ street: '10 New Road' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('edits the profile row with PATCH and notifies the host', async () => {
    rows = [PROFILE_ROW];
    const { dialog, onAddressesChanged } = renderDrawer({ requireCoords: false });

    await within(dialog).findByText('Profile address');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /edit profile address/i }),
    );
    fireEvent.change(within(dialog).getByPlaceholderText('Street address *'), {
      target: { value: '14 Loop Street' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /save changes/i }),
    );

    await waitFor(() => expect(onAddressesChanged).toHaveBeenCalled());
    const call = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      ([url, init]) =>
        String(url).includes('/users/me/addresses/profile') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.street).toBe('14 Loop Street');
    expect(await within(dialog).findByText('14 Loop Street')).toBeTruthy();
  });

  it('deletes a saved row only after the inline confirm', async () => {
    rows = [PROFILE_ROW, HOME_ROW];
    const { dialog, onAddressesChanged } = renderDrawer();

    await within(dialog).findByText('Home');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /delete home/i }),
    );
    expect(within(dialog).getByText(/delete this address\?/i)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: /^delete$/i }),
    );

    await waitFor(() => expect(onAddressesChanged).toHaveBeenCalled());
    const call = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      ([url, init]) =>
        String(url).includes('/users/me/addresses/a1') &&
        (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(call).toBeTruthy();
    await waitFor(() =>
      expect(within(dialog).queryByText('1 Main Rd')).toBeNull(),
    );
  });

  it('hides Delete for the profile row and points at the profile instead', async () => {
    rows = [PROFILE_ROW, HOME_ROW];
    const { dialog } = renderDrawer();

    await within(dialog).findByText('Profile address');
    expect(within(dialog).getByText(/edit from your profile/i)).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: /delete profile address/i }),
    ).toBeNull();
    // The book row's delete is still there.
    expect(
      within(dialog).getByRole('button', { name: /delete home/i }),
    ).toBeTruthy();
  });

  it('runs in token mode: no address-book read, form only, "Use this address"', async () => {
    const { dialog, onUseOnce, onClose } = renderDrawer({
      canSaveToBook: false,
      requireCoords: false,
    });

    expect(
      within(dialog).getByText(/saved addresses aren’t available/i),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: /add a new address/i }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: /save address/i }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: /^use this address$/i }),
    );
    expect(onUseOnce).toHaveBeenCalledWith(
      expect.objectContaining({ street: INITIAL_ADDRESS.street }),
      -33.8359558,
      18.6900397,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The session-only book is never even read.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows a load error with Try again and recovers', async () => {
    rows = [HOME_ROW];
    failNextGet = true;
    const { dialog } = renderDrawer();

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /try again/i }));
    expect(await within(dialog).findByText('Home')).toBeTruthy();
  });

  it('refuses to close while a save is in flight', async () => {
    rows = [PROFILE_ROW];
    hangNextPost = true;
    const { dialog, closeButton, onClose } = renderDrawer({
      requireCoords: false,
    });

    await within(dialog).findByText('Profile address');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: /save address/i }),
    );

    await waitFor(() => expect(closeButton).toBeDisabled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: /saving…/i })).toBeTruthy();
  });

  it('typed text replaces street and clears stale coordinates on a courier checkout', async () => {
    rows = [PROFILE_ROW];
    const { dialog } = renderDrawer();

    await within(dialog).findByText('Profile address');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /add a new address/i }),
    );

    const street = within(dialog).getByPlaceholderText(
      'Street address *',
    ) as HTMLInputElement;
    expect(street.value).toBe(INITIAL_ADDRESS.street);

    fireEvent.change(within(dialog).getByPlaceholderText('Search for address…'), {
      target: { value: '10 New Road' },
    });

    await waitFor(() => expect(street.value).toBe('10 New Road'));
    // Coordinates came from the address we started on; typing invalidates them
    // so a door quote can never be priced against the old location.
    const save = within(dialog).getByRole('button', {
      name: /save address/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(
      within(dialog).getByText(/pick your address from the suggestions/i),
    ).toBeTruthy();
  });
});
