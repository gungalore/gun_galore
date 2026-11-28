// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GateConsent } from './gate-consent';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const apiMock = vi.mocked(apiFetch);

describe('GateConsent', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders Enter, tied to the age declaration', () => {
    render(<GateConsent next="/" describedBy="gate-age" />);

    const button = screen.getByRole('button', { name: 'Enter' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-describedby', 'gate-age');
    expect(
      screen.getByText(/you confirm you are 18 or older/i),
    ).toBeInTheDocument();
  });

  it('posts the declaration and full-navigates to the selected next path', async () => {
    apiMock.mockResolvedValue({} as never);
    const accepted = vi.fn();
    render(
      <GateConsent next="/intro?from=gate" onAccepted={accepted} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/auth/catalogue-declare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept: true }),
      }),
    );
    await waitFor(() =>
      expect(accepted).toHaveBeenCalledWith('/intro?from=gate'),
    );
  });

  it('shows a retry error and re-enables Enter when the POST fails', async () => {
    apiMock.mockRejectedValue(new Error('offline'));
    const accepted = vi.fn();
    render(<GateConsent next="/" onAccepted={accepted} />);

    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not save your confirmation/i,
    );
    expect(screen.getByRole('button', { name: 'Enter' })).toBeEnabled();
    expect(accepted).not.toHaveBeenCalled();
  });
});
