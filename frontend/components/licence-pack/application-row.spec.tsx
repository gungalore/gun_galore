// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApplicationRow from './application-row';
import type { MotivationSummary } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// AN APPLICATION ROW OPENS ITS OWN 271.
//
// Operator, 2026-09-09: "give each a deletion option. they must open with
// their corresponding 271 form."
//
// ⚠️ EXCEPT A SECTION 24, which is lodged on the SAPS 518(a). The server
// refuses that one by name, so the row must not offer a button that cannot
// work — a member who taps it and gets a 409 has learnt nothing.
// ────────────────────────────────────────────────────────────────────

const saps271BlobUrl = vi.fn();

vi.mock('@/lib/motivations-api', () => ({
  motivationsApi: {
    saps271BlobUrl: (...a: unknown[]) => saps271BlobUrl(...a),
  },
}));

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

beforeEach(() => {
  saps271BlobUrl.mockReset();
  vi.stubGlobal(
    'open',
    vi.fn(() => ({ opener: {} })),
  );
  // jsdom has no blob-URL plumbing; the component only needs them to exist.
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('an application row', () => {
  it('carries its reference, its state and a delete', () => {
    render(<ApplicationRow row={row()} token={token} onChanged={() => {}} />);
    expect(screen.getByText('MO000074')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('opens the SAPS 271 with the member’s token, not a bare link', async () => {
    // ⚠️ A plain <a href> is a guaranteed 401: every motivation endpoint sits
    // behind the Clerk guard and an anchor carries no Authorization header.
    saps271BlobUrl.mockResolvedValue('blob:271');
    render(<ApplicationRow row={row()} token={token} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open SAPS 271' }));
    await waitFor(() => expect(saps271BlobUrl).toHaveBeenCalledTimes(1));
    expect(saps271BlobUrl.mock.calls[0][1]).toBe('mo-1');
  });

  it('⚠️ OFFERS NO 271 ON A RENEWAL, and says why', () => {
    render(
      <ApplicationRow
        row={row({ licenceType: 'S24_RENEWAL' })}
        token={token}
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Open SAPS 271' })).toBeNull();
    expect(screen.getByText(/518\(a\)/)).toBeTruthy();
  });

  it('shows the server’s own words when the form will not open', async () => {
    saps271BlobUrl.mockRejectedValue(new Error('We could not open the form.'));
    render(<ApplicationRow row={row()} token={token} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open SAPS 271' }));
    await waitFor(() =>
      expect(screen.getByText('We could not open the form.')).toBeTruthy(),
    );
  });
});
