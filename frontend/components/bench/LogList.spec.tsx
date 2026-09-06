// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ⚠️ ONE getToken, HOISTED OUT OF THE HOOK — the same note as every other
 * component spec in this folder: a fresh arrow per call changes identity on
 * every render.
 */
vi.mock('@clerk/nextjs', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true }) };
});

import LogList from './LogList';
import { benchApi, type LogEntry } from '@/lib/bench/api';

/**
 * THE BENCH — the load log.
 *
 * 🚨 THREE THINGS THE AUDIT FOUND HERE, ALL OF THEM ABOUT SOMEONE'S OWN
 * RECORD. An entry logged two grains over the max looked exactly like every
 * other row, because the server's flags were never rendered. Delete was ONE
 * TAP, with no confirmation, no undo and nothing said when it failed. And the
 * sheet promised "Results (velocity, group) are added after the range" over a
 * list with no way to add them.
 */

const BASE: LogEntry = {
  id: 'e1',
  cartridgeKey: '6-5-creedmoor',
  cartridgeName: '6,5 Creedmoor',
  bulletLabel: 'Hornady ELD Match 140 gr',
  powderName: 'H4350',
  chargeGr: 43.2,
  coalMm: 71.12,
  primer: 'CCI BR-2',
  caseLabel: 'Lapua',
  loadId: 'row-1',
  velocityMs: null,
  groupMm: null,
  notes: null,
  shotAt: '2026-09-04T09:00:00.000Z',
  createdAt: '2026-09-04T09:00:00.000Z',
  flags: [],
  startGr: 35.6,
  maxGr: 41.5,
};

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return { ...BASE, ...over };
}

function list(entries: LogEntry[], props: Partial<Parameters<typeof LogList>[0]> = {}) {
  const onDelete = props.onDelete ?? vi.fn();
  render(
    <LogList
      units="metric"
      entries={entries}
      loading={false}
      onClose={() => {}}
      {...props}
      onDelete={onDelete}
    />,
  );
  return { onDelete };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the server’s flags are on the row', () => {
  it('shows the charge flags with the figure they are about', () => {
    list([entry({ flags: ['ABOVE_MAX'] })]);
    expect(screen.getByText('ABOVE MAX 41.5')).toBeInTheDocument();
  });

  it('shows a below-start entry against its own start charge', () => {
    list([entry({ chargeGr: 34, flags: ['BELOW_START'] })]);
    expect(screen.getByText('BELOW START 35.6')).toBeInTheDocument();
  });

  it('shows the COAL flags the results rows use', () => {
    list([entry({ flags: ['COAL_OVER_MAX', 'COAL_RANGE'] })]);
    expect(screen.getByText('COAL OVER MAX')).toBeInTheDocument();
    expect(screen.getByText('COAL RANGE')).toBeInTheDocument();
  });

  /** Wire data: a name this build has not learnt is not a sentence to show. */
  it('drops a flag it does not know rather than printing it raw', () => {
    list([entry({ flags: ['SOMETHING_NEW'] })]);
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
  });

  it('prints the window the charge is judged against', () => {
    list([entry()]);
    expect(screen.getByText('35.6–41.5 gr')).toBeInTheDocument();
  });

  it('says nothing about a window the entry does not carry', () => {
    list([entry({ startGr: null, maxGr: null })]);
    expect(screen.queryByText('35.6–41.5 gr')).toBeNull();
  });

  it('shows the day the round was fired', () => {
    list([entry()]);
    expect(screen.getByText('2026-09-04')).toBeInTheDocument();
  });

  /** The server orders by shotAt desc; the list must not re-order it. */
  it('keeps the order it was given', () => {
    list([entry({ id: 'a', powderName: 'H4350' }), entry({ id: 'b', powderName: 'Varget' })]);
    const text = document.body.textContent ?? '';
    expect(text.indexOf('H4350')).toBeLessThan(text.indexOf('Varget'));
  });
});

describe('delete takes two taps', () => {
  it('does not delete on the first tap', () => {
    const { onDelete } = list([entry()]);
    fireEvent.click(screen.getByRole('button', { name: /^Delete 6,5 Creedmoor/ }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete?')).toBeInTheDocument();
  });

  it('deletes on the second', () => {
    const { onDelete } = list([entry()]);
    fireEvent.click(screen.getByRole('button', { name: /^Delete 6,5 Creedmoor/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, delete/ }));
    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  it('gives the armed row back after four seconds', () => {
    vi.useFakeTimers();
    try {
      const { onDelete } = list([entry()]);
      fireEvent.click(screen.getByRole('button', { name: /^Delete 6,5 Creedmoor/ }));
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText('Delete?')).toBeNull();
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * 🚨 A DELETE THAT FAILED USED TO SAY NOTHING AT ALL. The page removes the
   * row first, so a rejection is the only signal the entry is still there.
   */
  it('says so when the delete fails, and tells the page', async () => {
    const onError = vi.fn();
    const onDelete = vi.fn().mockRejectedValue(new Error('Network is down'));
    list([entry()], { onDelete, onError });
    fireEvent.click(screen.getByRole('button', { name: /^Delete 6,5 Creedmoor/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Yes, delete/ }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Network is down');
    expect(onError).toHaveBeenCalledWith('Network is down');
  });
});

describe('results are added after the range', () => {
  it('offers to add them, and saves what was measured', async () => {
    const updated = entry({ velocityMs: 732, groupMm: 18 });
    const update = vi.spyOn(benchApi, 'updateLog').mockResolvedValue(updated);
    const onUpdated = vi.fn();
    list([entry()], { onUpdated });

    fireEvent.click(screen.getByRole('button', { name: 'Add results' }));
    fireEvent.change(screen.getByLabelText('Velocity, m/s'), { target: { value: '732' } });
    fireEvent.change(screen.getByLabelText('Group, mm'), { target: { value: '18' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save results' }));
    });

    expect(update).toHaveBeenCalledWith(expect.any(Function), 'e1', {
      velocityMs: 732,
      groupMm: 18,
    });
    expect(onUpdated).toHaveBeenCalledWith(updated);
    expect(await screen.findByText('732 m/s · 18 mm group')).toBeInTheDocument();
  });

  /** Stored in m/s whatever the member reads in. */
  it('converts a velocity typed in fps', async () => {
    const update = vi.spyOn(benchApi, 'updateLog').mockResolvedValue(entry({ velocityMs: 747 }));
    list([entry()], { units: 'imperial' });

    fireEvent.click(screen.getByRole('button', { name: 'Add results' }));
    fireEvent.change(screen.getByLabelText('Velocity, fps'), { target: { value: '2450' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save results' }));
    });

    expect(update.mock.calls[0][2]).toEqual({ velocityMs: 747, groupMm: null });
  });

  it('offers to edit them once they are there', () => {
    list([entry({ velocityMs: 732, groupMm: 18 })]);
    expect(screen.getByRole('button', { name: 'Edit results' })).toBeInTheDocument();
    expect(screen.getByText('732 m/s · 18 mm group')).toBeInTheDocument();
  });

  it('waits rather than saving a figure it cannot read', () => {
    list([entry()]);
    fireEvent.click(screen.getByRole('button', { name: 'Add results' }));
    fireEvent.change(screen.getByLabelText('Velocity, m/s'), { target: { value: 'fast' } });
    expect(screen.getByRole('button', { name: 'Save results' })).toBeDisabled();
  });
});

describe('the export', () => {
  it('is not offered over an empty log', () => {
    list([]);
    expect(screen.queryByRole('button', { name: /Export CSV/ })).toBeNull();
  });

  it('is offered the moment there is a row', () => {
    list([entry()]);
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
  });
});
