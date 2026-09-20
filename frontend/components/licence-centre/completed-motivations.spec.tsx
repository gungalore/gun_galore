// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompletedMotivations from './completed-motivations';
import type { MotivationSummary } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE VAULT'S OWN SECTION FOR FINISHED MOTIVATIONS.
// ────────────────────────────────────────────────────────────────────

const row = (over: Partial<MotivationSummary> = {}): MotivationSummary => ({
  id: 'mo-1',
  referenceNumber: 'MO000074',
  licenceType: 'S16_DEDICATED_SPORT',
  status: 'COMPLETED',
  createdAt: '2026-09-09T00:00:00.000Z',
  ...over,
});

describe('CompletedMotivations', () => {
  it('renders nothing when there is nothing finished', () => {
    const { container } = render(<CompletedMotivations rows={[]} />);
    expect(container.textContent).toBe('');
  });

  it('names the firearm and section, and opens the pack', () => {
    render(
      <CompletedMotivations
        rows={[row({ title: 'Glock 19 9mm — Section 13' })]}
      />,
    );
    expect(screen.getByText('Glock 19 9mm — Section 13')).toBeTruthy();
    expect(screen.getByText('MO000074')).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/licence-centre/mo-1/pack');
  });

  it('falls back to the licence label for a row with no title', () => {
    render(<CompletedMotivations rows={[row()]} />);
    expect(screen.getByText('Dedicated sports shooter')).toBeTruthy();
  });
});
