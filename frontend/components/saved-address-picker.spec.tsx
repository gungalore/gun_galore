// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavedAddressPicker } from './saved-address-picker';
import type { Address } from '@/lib/types';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    getToken: async () => 't',
    isLoaded: true,
    isSignedIn: true,
  }),
}));

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

function mockFetch(addresses: Address[]) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => addresses,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SavedAddressPicker', () => {
  it('renders nothing when the book is empty', async () => {
    mockFetch([]);
    const onSelect = vi.fn();
    const { container } = render(
      <SavedAddressPicker minToShow={1} onSelect={onSelect} />,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a single profile address and auto-selects it as the default', async () => {
    const profile = address({
      id: 'profile',
      label: 'Profile address',
      isDefault: true,
    });
    mockFetch([profile]);
    const onSelect = vi.fn();
    render(<SavedAddressPicker minToShow={1} onSelect={onSelect} />);

    expect(await screen.findByText('Profile address')).toBeTruthy();
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(profile));
  });

  it('auto-selects the default and switches when another card is picked', async () => {
    const home = address({ id: 'a1', isDefault: true });
    const work = address({
      id: 'a2',
      label: 'Work',
      street: '9 Office Park',
      isDefault: false,
    });
    mockFetch([home, work]);
    const onSelect = vi.fn();
    render(<SavedAddressPicker minToShow={1} onSelect={onSelect} />);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(home));

    await userEvent.click(screen.getByRole('radio', { name: /Work/i }));
    expect(onSelect).toHaveBeenLastCalledWith(work);
  });
});
