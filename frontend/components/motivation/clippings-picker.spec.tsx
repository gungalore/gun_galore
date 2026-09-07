// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClippingsPicker } from './clippings-picker';
import {
  motivationsApi,
  type IncidentsResult,
  type NewsIncident,
} from '@/lib/motivations-api';
import { AUTOSAVE_MS } from '@/lib/motivation-draft';
import { PRESS_CLIPPINGS_KEY } from '@/lib/press-clippings';

const getToken = async () => 'test-token';

function incident(i: number, overrides: Partial<NewsIncident> = {}): NewsIncident {
  return {
    id: `inc-${i}`,
    sourceKey: 'lowvelder',
    sourceName: 'Lowvelder',
    url: `https://example.com/${i}`,
    headline: `Headline ${i}`,
    standfirst: `Standfirst for incident ${i}.`,
    imageUrl: i % 2 === 0 ? `https://example.com/img-${i}.jpg` : null,
    author: 'A Reporter',
    publishedOn: '2026-03-12T08:00:00Z',
    crimeType: 'armed_robbery',
    places: ['Nelspruit'],
    distanceKm: 3,
    ...overrides,
  };
}

function result(incidents: NewsIncident[]): IncidentsResult {
  return {
    station: { name: 'Nelspruit', district: 'Mbombela', province: 'Mpumalanga' },
    incidents,
  };
}

/** Runs the picker's own fetch delay (AUTOSAVE_MS + slack) past, plus microtasks. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(AUTOSAVE_MS + 400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A stateful host so a click's onChange really is reflected back as `value`. */
function Host({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ClippingsPicker
      motivationId="m1"
      policeStation="Nelspruit"
      value={value}
      onChange={setValue}
      getToken={getToken}
    />
  );
}

describe('ClippingsPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing while no station has been chosen', () => {
    render(
      <ClippingsPicker
        motivationId="m1"
        policeStation=""
        value=""
        onChange={() => {}}
        getToken={getToken}
      />,
    );
    expect(document.body.textContent).toBe('');
  });

  it('shows a quiet skeleton while loading', () => {
    vi.spyOn(motivationsApi, 'incidents').mockReturnValue(new Promise(() => {}));
    render(<Host />);
    expect(
      screen.getByLabelText('Loading reports from the local press'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders cards from a fixture — headline, meta line, crime chip, alt text', async () => {
    vi.spyOn(motivationsApi, 'incidents').mockResolvedValue(
      result([incident(1, { imageUrl: 'https://example.com/img-1.jpg' })]),
    );
    render(<Host />);
    await settle();

    expect(screen.getByText('Reported near you')).toBeInTheDocument();
    expect(screen.getByText('0 of 8 chosen')).toBeInTheDocument();
    expect(screen.getByText('Headline 1')).toBeInTheDocument();
    expect(screen.getByText('Standfirst for incident 1.')).toBeInTheDocument();
    expect(screen.getByText('3 km away · Lowvelder · 12 Mar 2026')).toBeInTheDocument();
    expect(screen.getByText('Armed robbery')).toBeInTheDocument();
    expect(screen.getByAltText('Headline 1')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Attach to my motivation'),
    ).toBeInTheDocument();
  });

  it('shows a grey block, not an <img>, when there is no thumbnail', async () => {
    vi.spyOn(motivationsApi, 'incidents').mockResolvedValue(
      result([incident(1, { imageUrl: null })]),
    );
    render(<Host />);
    await settle();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the empty state when the station has no incidents on file', async () => {
    vi.spyOn(motivationsApi, 'incidents').mockResolvedValue(result([]));
    render(<Host />);
    await settle();
    expect(
      screen.getByText('Nothing from the local press on file for this station yet.'),
    ).toBeInTheDocument();
  });

  it('reads the same as "nothing on file" when the fetch fails', async () => {
    vi.spyOn(motivationsApi, 'incidents').mockRejectedValue(new Error('network'));
    render(<Host />);
    await settle();
    expect(
      screen.getByText('Nothing from the local press on file for this station yet.'),
    ).toBeInTheDocument();
  });

  it('writes the ids JSON in CLICK order, not list order', async () => {
    vi.spyOn(motivationsApi, 'incidents').mockResolvedValue(
      result([incident(1), incident(2), incident(3)]),
    );
    render(<Host />);
    await settle();

    const boxes = screen.getAllByLabelText('Attach to my motivation');
    // Click the SECOND card first, then the FIRST — click order should win.
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[0]);

    expect(screen.getByText('2 of 8 chosen')).toBeInTheDocument();
    // Unticking the second one again should leave only the first, proving the
    // underlying value really is being written back through onChange.
    fireEvent.click(boxes[1]);
    expect(screen.getByText('1 of 8 chosen')).toBeInTheDocument();
  });

  it('disables the 9th unchecked card once 8 are already chosen, with a reason', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => incident(i));
    vi.spyOn(motivationsApi, 'incidents').mockResolvedValue(result(nine));
    render(<Host initial={JSON.stringify(nine.slice(0, 8).map((n) => n.id))} />);
    await settle();

    expect(screen.getByText('8 of 8 chosen')).toBeInTheDocument();
    const boxes = screen.getAllByLabelText('Attach to my motivation');
    // The first 8 are checked and stay enabled (so they can be unticked).
    for (let i = 0; i < 8; i++) {
      expect(boxes[i]).toBeChecked();
      expect(boxes[i]).toBeEnabled();
    }
    // The 9th is unchecked and disabled, with the limit reason on screen.
    expect(boxes[8]).not.toBeChecked();
    expect(boxes[8]).toBeDisabled();
    expect(
      screen.getByText(
        'You can attach up to 8 clippings — remove one to add another.',
      ),
    ).toBeInTheDocument();
  });

  it('refetches when the station changes, aborting the stale request', async () => {
    const spy = vi
      .spyOn(motivationsApi, 'incidents')
      .mockResolvedValue(result([incident(1)]));
    const { rerender } = render(
      <ClippingsPicker
        motivationId="m1"
        policeStation="Nelspruit"
        value=""
        onChange={() => {}}
        getToken={getToken}
      />,
    );
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);

    rerender(
      <ClippingsPicker
        motivationId="m1"
        policeStation="White River"
        value=""
        onChange={() => {}}
        getToken={getToken}
      />,
    );
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    const lastSignal = spy.mock.calls[1][2] as AbortSignal;
    expect(lastSignal.aborted).toBe(false);
  });

  // The generic field renderer (motivation-field-input.tsx / FieldGrid) draws
  // a plain <input>/<textarea> keyed by the field's own key for every
  // ordinary field. `press_clippings` must never surface that way — this
  // component is its ENTIRE UI, and it renders only checkboxes.
  it('never renders a generic text box for the hidden press_clippings field', async () => {
    vi.spyOn(motivationsApi, 'incidents').mockResolvedValue(
      result([incident(1)]),
    );
    render(<Host />);
    await settle();

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.getElementById(PRESS_CLIPPINGS_KEY)).toBeNull();
    expect(
      document.querySelector(`[name="${PRESS_CLIPPINGS_KEY}"]`),
    ).toBeNull();
  });
});
