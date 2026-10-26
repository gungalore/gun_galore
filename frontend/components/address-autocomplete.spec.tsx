// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddressAutocomplete } from './address-autocomplete';

// The suggestions come from our backend, not the Google widget. Pin the
// request, the dropdown, and the selected-place callbacks.
describe('AddressAutocomplete — server-backed suggestions', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes('/listings/place-autocomplete')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              suggestions: [
                {
                  placeId: 'p1',
                  text: 'Wildman Cape Gate, Cape Town',
                },
              ],
            }),
          };
        }
        if (href.includes('/listings/place/p1')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              place: {
                placeId: 'p1',
                name: 'Wildman Cape Gate',
                address: 'Wildman Cape Gate, Okavango Road, Cape Town',
                street: '12 Okavango Road',
                suburb: 'Brackenfell',
                city: 'Cape Town',
                province: 'Western Cape',
                postalCode: '7560',
                lat: -33.85,
                lng: 18.7,
              },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('suggests as the seller types and fills the picked place', async () => {
    const onChange = vi.fn();
    const onComponents = vi.fn();
    const onPlaceSelected = vi.fn();

    render(
      <AddressAutocomplete
        value=""
        onChange={onChange}
        onComponents={onComponents}
        onPlaceSelected={onPlaceSelected}
        placeTypes={['establishment']}
        hideLocate
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'wildman ca' } });

    const option = await screen.findByRole('option', {
      name: 'Wildman Cape Gate, Cape Town',
    });
    fireEvent.mouseDown(option);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        'Wildman Cape Gate, Okavango Road, Cape Town',
        'p1',
      ),
    );
    expect(onComponents).toHaveBeenCalledWith(
      expect.objectContaining({
        street: '12 Okavango Road',
        suburb: 'Brackenfell',
        city: 'Cape Town',
        province: 'Western Cape',
        postalCode: '7560',
        lat: -33.85,
        lng: 18.7,
      }),
    );
    expect(onPlaceSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Wildman Cape Gate',
        placeId: 'p1',
      }),
    );
    expect((input as HTMLInputElement).value).toBe(
      'Wildman Cape Gate, Okavango Road, Cape Town',
    );
  });

  it('uses the establishment type for a dealer search', async () => {
    render(
      <AddressAutocomplete
        value=""
        onChange={() => {}}
        placeTypes={['establishment']}
        hideLocate
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'wildman ca' },
    });
    await screen.findByRole('option');
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).includes('/place-autocomplete'),
    );
    expect(String(call?.[0])).toContain('types=establishment');
  });
});
