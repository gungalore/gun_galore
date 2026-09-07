// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrecinctCard } from './precinct-card';
import { motivationsApi, type PrecinctFigures } from '@/lib/motivations-api';
import { AUTOSAVE_MS } from '@/lib/motivation-draft';

const getToken = async () => 'test-token';

const FIGURES: PrecinctFigures = {
  station: { name: 'Sea Point', district: 'Cape Town', province: 'Western Cape' },
  release: {
    key: '2026Q2',
    periodLabel: 'Apr–Jun 2026',
    fetchedOn: '2026-08-01',
    sourceUrl: 'https://saps.gov.za/example',
  },
  categories: [
    {
      category: 'Murder',
      latest: { period: '2026Q2', label: 'Apr–Jun 2026', count: 12 },
      sameQuarterLastYear: { period: '2025Q2', label: 'Apr–Jun 2025', count: 9 },
      recent: [],
      yearOnYearPct: 33.3,
      lastTwelveMonths: 44,
    },
    {
      category: 'Burglary at residential premises',
      latest: { period: '2026Q2', label: 'Apr–Jun 2026', count: 812 },
      sameQuarterLastYear: { period: '2025Q2', label: 'Apr–Jun 2025', count: 900 },
      recent: [],
      yearOnYearPct: -9.8,
      lastTwelveMonths: 3120,
    },
  ],
};

/** Runs the card's own fetch delay (AUTOSAVE_MS + slack) past, plus microtasks. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(AUTOSAVE_MS + 400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PrecinctCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing while no station has been chosen', () => {
    render(
      <PrecinctCard motivationId="m1" policeStation="" getToken={getToken} />,
    );
    expect(document.body.textContent).toBe('');
  });

  it('shows a quiet skeleton while loading, not a spinner', () => {
    vi.spyOn(motivationsApi, 'precinct').mockReturnValue(new Promise(() => {}));
    render(
      <PrecinctCard motivationId="m1" policeStation="Sea Point" getToken={getToken} />,
    );
    expect(screen.getByLabelText('Loading precinct figures')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders the station, the release and the headline category rows', async () => {
    vi.spyOn(motivationsApi, 'precinct').mockResolvedValue(FIGURES);
    render(
      <PrecinctCard motivationId="m1" policeStation="Sea Point" getToken={getToken} />,
    );
    await settle();

    expect(screen.getByText('Sea Point')).toBeInTheDocument();
    expect(screen.getByText(/Cape Town, Western Cape/)).toBeInTheDocument();
    expect(screen.getByText('SAPS quarterly release, Apr–Jun 2026')).toBeInTheDocument();
    expect(screen.getByText('Murder')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('+33.3% y/y')).toBeInTheDocument();
    expect(screen.getByText('−9.8% y/y')).toBeInTheDocument();
    expect(screen.getByText('44 in the last 12 months')).toBeInTheDocument();
    expect(
      screen.getByText(
        'These figures go into your motivation as SAPS-recorded facts for this precinct.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the empty state when the station has no figures on file', async () => {
    vi.spyOn(motivationsApi, 'precinct').mockResolvedValue(null);
    render(
      <PrecinctCard motivationId="m1" policeStation="Nowhere Central" getToken={getToken} />,
    );
    await settle();
    expect(
      screen.getByText('No SAPS figures on file for this station yet.'),
    ).toBeInTheDocument();
  });

  it('refetches when the station changes, aborting the stale request', async () => {
    const spy = vi.spyOn(motivationsApi, 'precinct').mockResolvedValue(FIGURES);
    const { rerender } = render(
      <PrecinctCard motivationId="m1" policeStation="Sea Point" getToken={getToken} />,
    );
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);

    rerender(
      <PrecinctCard motivationId="m1" policeStation="Table View" getToken={getToken} />,
    );
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    // The most recent call's signal must not already be aborted — that would
    // mean the fetch for the CURRENT value was cancelled by its own cleanup.
    const lastSignal = spy.mock.calls[1][2] as AbortSignal;
    expect(lastSignal.aborted).toBe(false);
  });
});
