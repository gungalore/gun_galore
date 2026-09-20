// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ApplicationRow from './application-row';
import type { MotivationSummary } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// AN APPLICATION ROW IS A NAME, A REFERENCE, A STATE AND A DELETE.
//
// Operator, 2026-09-20: "Remove every SAPS 271 control" and "the name of the
// motivation should change to the Make and calibre of the firearm followed by
// which section it is."
//
// ⚠️ THE TITLE IS THE SERVER'S. Deriving it here would be a second reader of
// the same answers; motivation-title.ts owns it, the list/detail/sheet all
// send it, and this row just renders it. The licence label is the last-resort
// fallback for a row from an older client that did not send one.
// ────────────────────────────────────────────────────────────────────

vi.mock('@/components/licence-pack/delete-application', () => ({
  default: ({ label }: { label: string }) => <button>{label}</button>,
}));

const row = (over: Partial<MotivationSummary> = {}): MotivationSummary => ({
  id: 'mo-1',
  referenceNumber: 'MO000074',
  licenceType: 'S16_DEDICATED_SPORT',
  status: 'COMPLETED',
  createdAt: '2026-09-09T00:00:00.000Z',
  ...over,
});

const token = async () => 'tok';

describe('an application row', () => {
  it('carries its reference, its state and a delete', () => {
    render(<ApplicationRow row={row()} token={token} onChanged={() => {}} />);
    expect(screen.getByText('MO000074')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('renders the firearm-and-section title the server derived', () => {
    render(
      <ApplicationRow
        row={row({ title: 'Glock 19 9mm — Section 13' })}
        token={token}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText('Glock 19 9mm — Section 13')).toBeTruthy();
  });

  it('falls back to the licence label when no title was sent', () => {
    render(<ApplicationRow row={row()} token={token} onChanged={() => {}} />);
    expect(screen.getByText('Dedicated sports shooter')).toBeTruthy();
  });

  it('⚠️ OFFERS NO SAPS 271 CONTROL AT ALL', () => {
    // It ships with the pack and comes down with the pack's Download.
    render(<ApplicationRow row={row()} token={token} onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: /saps 271/i })).toBeNull();
    expect(screen.queryByText(/518\(a\)/)).toBeNull();
  });
});
