// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { TrackerView } from '@/lib/licence-tracker-api';

// ⚠️ .spec.tsx, WITH THE X. The Vitest include is
// ['lib/**/*.spec.ts', 'components/**/*.spec.tsx'] — a `.spec.ts` here is
// never collected, reports nothing, and passes the deploy gate by not
// existing.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children?: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import TrackerCard from './TrackerCard';

// ────────────────────────────────────────────────────────────────────
// THE CARD IS A LINK AND THE BUTTONS ARE ITS SIBLINGS.
//
// ⚠️ A <button> NESTED IN AN <a> IS INVALID HTML, AND THE BROWSERS THAT
// TOLERATE IT STILL FOLLOW THE LINK ON THE WAY TO THE CLICK — so "Check
// now" would open the detail page instead of asking SAPS. The nesting is
// the assertion here, not the wording.
// ────────────────────────────────────────────────────────────────────

function tracker(over: Partial<TrackerView> = {}): TrackerView {
  return {
    id: 't1',
    kind: 'FIREARM_LICENCE',
    label: 'My first .308',
    reference: 'C10167347',
    serial: null,
    submittedOn: null,
    applicationType: null,
    applicationNumber: null,
    calibre: null,
    make: null,
    serialSeen: null,
    status: null,
    statusDate: null,
    sapsUpdatedOn: null,
    lastCheckedAt: null,
    lastOutcome: 'unknown',
    lastError: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    eventCount: 0,
    ...over,
  };
}

function renderCard(
  over: Partial<TrackerView> = {},
  handlers: Partial<{
    onCheck: (id: string) => void;
    onOpenHistory: (id: string) => void;
    onStop: (id: string) => void;
  }> = {},
) {
  const onCheck = handlers.onCheck ?? vi.fn();
  const onOpenHistory = handlers.onOpenHistory ?? vi.fn();
  const onStop = handlers.onStop ?? vi.fn();
  render(
    <ul>
      <TrackerCard
        tracker={tracker(over)}
        checking={false}
        notice={null}
        stopping={false}
        onCheck={onCheck}
        onOpenHistory={onOpenHistory}
        onStop={onStop}
      />
    </ul>,
  );
  return { onCheck, onOpenHistory, onStop };
}

describe('the two actions', () => {
  it('offers Check now and View history, in that order', () => {
    renderCard();
    const check = screen.getByRole('button', {
      name: 'Check My first .308 with SAPS now',
    });
    const history = screen.getByRole('button', {
      name: 'See the history of My first .308',
    });
    expect(check.compareDocumentPosition(history)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('⚠️ KEEPS BOTH BUTTONS OUT OF THE LINK', () => {
    // A click on a nested button still follows the anchor in the browsers
    // that tolerate the markup, so "View history" would open the detail page.
    renderCard();
    for (const name of [
      'Check My first .308 with SAPS now',
      'See the history of My first .308',
    ]) {
      expect(screen.getByRole('button', { name }).closest('a')).toBeNull();
    }
    // And the link itself is still there, pointing at the detail route.
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/licence-centre/tracking/t1',
    );
  });

  it('asks SAPS without opening the history', () => {
    const { onCheck, onOpenHistory } = renderCard();
    fireEvent.click(
      screen.getByRole('button', { name: 'Check My first .308 with SAPS now' }),
    );
    expect(onCheck).toHaveBeenCalledWith('t1');
    expect(onOpenHistory).not.toHaveBeenCalled();
  });

  it('opens the history without asking SAPS', () => {
    const { onCheck, onOpenHistory } = renderCard();
    fireEvent.click(
      screen.getByRole('button', { name: 'See the history of My first .308' }),
    );
    expect(onOpenHistory).toHaveBeenCalledWith('t1');
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('disables both while the row is being stopped', () => {
    render(
      <ul>
        <TrackerCard
          tracker={tracker()}
          checking={false}
          notice={null}
          stopping
          onCheck={vi.fn()}
          onOpenHistory={vi.fn()}
          onStop={vi.fn()}
        />
      </ul>,
    );
    expect(
      screen.getByRole('button', { name: 'Check My first .308 with SAPS now' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'See the history of My first .308' }),
    ).toBeDisabled();
  });
});

describe('how long it has been', () => {
  it('counts from the day the member lodged it', () => {
    renderCard({ submittedOn: '2020-09-01' });
    expect(screen.getByText(/days since you lodged it/)).toBeInTheDocument();
  });

  it('⚠️ PRINTS NOTHING AT ALL WHEN THE MEMBER NEVER SAID', () => {
    // The card has a `createdAt` of its own and could count from that, which
    // would print "1 067 days since you lodged it" over a tracker made last
    // week. A sentence that is simply false is worse than no sentence.
    renderCard({ submittedOn: null });
    expect(screen.queryByText(/since you lodged it/)).toBeNull();
  });
});

describe('what SAPS answered with', () => {
  it('shows the facts it was given and omits the grid when it has none', () => {
    renderCard({ applicationType: 'Licence to possess a firearm', calibre: '308' });
    expect(
      screen.getByText('Licence to possess a firearm'),
    ).toBeInTheDocument();
    expect(screen.getByText('308')).toBeInTheDocument();
    expect(screen.queryByText('Make')).toBeNull();
  });

  it('⚠️ CALLS OUT A SERIAL SAPS PRINTS DIFFERENTLY FROM THE ONE TYPED', () => {
    // A mis-typed serial is invisible on a card that only echoes back what
    // was typed, and it is the likeliest reason the enquiry returns nothing.
    renderCard({ serial: 'ZA1111111', serialSeen: 'ZA2226548' });
    expect(screen.getByText(/ZA2226548/)).toBeInTheDocument();
    expect(screen.getByText(/ZA1111111/)).toBeInTheDocument();
  });

  it('does not cry wolf when SAPS echoes the same serial back', () => {
    renderCard({ serial: 'ZA1111111', serialSeen: 'ZA1111111' });
    expect(screen.queryByText(/SAPS prints the serial as/)).toBeNull();
  });

  it('⚠️ DOES NOT SAY "NOT READ YET" WHILE IT IS BEING READ', () => {
    // Every card is asked about the moment it is added, so this line is only
    // ever seen in flight — where it read as "we looked and found nothing".
    render(
      <ul>
        <TrackerCard
          tracker={tracker()}
          checking
          notice={null}
          stopping={false}
          onCheck={vi.fn()}
          onOpenHistory={vi.fn()}
          onStop={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByText('Asking SAPS now…')).toBeInTheDocument();
    expect(screen.queryByText(/not read yet/)).toBeNull();
  });

  it('reads a no-records answer as normal rather than as a refusal', () => {
    renderCard({ lastOutcome: 'no_records', status: null });
    expect(
      screen.getByText(/SAPS holds no record against this reference yet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/it is not a refusal/)).toBeInTheDocument();
  });

  it('⚠️ SAYS OUR BLINDNESS IS NOT A MOVEMENT', () => {
    renderCard({ lastOutcome: 'error', lastError: 'Timed out' });
    expect(
      screen.getByText(/That does not mean the status moved/),
    ).toBeInTheDocument();
    expect(screen.getByText('Timed out')).toBeInTheDocument();
  });
});
