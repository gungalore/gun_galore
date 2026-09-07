// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StationPicker } from './station-picker';
import { crimeStatsApi, type CrimeStatsStation } from '@/lib/motivations-api';

const STATIONS: CrimeStatsStation[] = [
  { name: 'Sea Point', district: 'Cape Town', province: 'Western Cape' },
  { name: 'Table View', district: 'Cape Town', province: 'Western Cape' },
];

const getToken = async () => 'test-token';

function renderPicker(overrides: Partial<Parameters<typeof StationPicker>[0]> = {}) {
  const onChangeText = vi.fn();
  const onSelectStation = vi.fn();
  const utils = render(
    <StationPicker
      id="police_station"
      label="Police station"
      value=""
      missing={false}
      getToken={getToken}
      onChangeText={onChangeText}
      onSelectStation={onSelectStation}
      {...overrides}
    />,
  );
  return { ...utils, onChangeText, onSelectStation };
}

/** Runs the 250ms debounce past, plus the microtasks the mocked fetch resolves on. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StationPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not search below the two-character minimum', async () => {
    const spy = vi.spyOn(crimeStatsApi, 'stations');
    renderPicker({ value: 'S' });
    await settle();
    expect(spy).not.toHaveBeenCalled();
  });

  it('searches, debounced, once there is enough to search for', async () => {
    const spy = vi
      .spyOn(crimeStatsApi, 'stations')
      .mockResolvedValue({ stations: STATIONS });
    renderPicker({ value: 'Sea' });
    // Not yet — still inside the debounce window.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(spy).not.toHaveBeenCalled();
    await settle();
    expect(spy).toHaveBeenCalledWith(getToken, 'Sea', expect.anything());
  });

  it('renders the results as combobox options, "name · district, province"', async () => {
    vi.spyOn(crimeStatsApi, 'stations').mockResolvedValue({ stations: STATIONS });
    renderPicker({ value: 'Sea' });
    await settle();
    expect(
      screen.getByRole('option', { name: 'Sea Point · Cape Town, Western Cape' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Table View · Cape Town, Western Cape' }),
    ).toBeInTheDocument();
  });

  it('writes the station through onSelectStation on click, not onChangeText', async () => {
    vi.spyOn(crimeStatsApi, 'stations').mockResolvedValue({ stations: STATIONS });
    const { onSelectStation, onChangeText } = renderPicker({ value: 'Sea' });
    await settle();
    fireEvent.click(
      screen.getByRole('option', { name: 'Sea Point · Cape Town, Western Cape' }),
    );
    expect(onSelectStation).toHaveBeenCalledWith(STATIONS[0]);
    // Picking a suggestion is not free-typing — onChangeText only fires from
    // the input's own onChange handler.
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('selects the highlighted option with the keyboard', async () => {
    vi.spyOn(crimeStatsApi, 'stations').mockResolvedValue({ stations: STATIONS });
    const { onSelectStation } = renderPicker({ value: 'Sea' });
    await settle();
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectStation).toHaveBeenCalledWith(STATIONS[1]);
  });

  it('closes the panel on Escape', async () => {
    vi.spyOn(crimeStatsApi, 'stations').mockResolvedValue({ stations: STATIONS });
    renderPicker({ value: 'Sea' });
    await settle();
    const box = screen.getByRole('combobox');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the server-supplied provenance line when the value was prefilled', () => {
    renderPicker({
      value: 'Sea Point',
      provenance: {
        source: 'READ',
        from: 'Nearest SAPS station to your address',
        at: '2026-09-01T00:00:00.000Z',
      },
    });
    expect(
      screen.getByText('from Nearest SAPS station to your address'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not my station')).toBeInTheDocument();
  });

  it('does not show the "Not my station" affordance without provenance', () => {
    renderPicker({ value: 'Sea Point' });
    expect(screen.queryByText('Not my station')).toBeNull();
  });

  it('focuses and selects the input text when "Not my station" is clicked', () => {
    renderPicker({
      value: 'Sea Point',
      provenance: {
        source: 'READ',
        from: 'Nearest SAPS station to your address',
        at: '2026-09-01T00:00:00.000Z',
      },
    });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    fireEvent.click(screen.getByText('Not my station'));
    expect(document.activeElement).toBe(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('writes free-typed text through onChangeText', () => {
    const { onChangeText } = renderPicker({ value: '' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Fish Hoek' } });
    expect(onChangeText).toHaveBeenCalledWith('Fish Hoek');
  });
});
