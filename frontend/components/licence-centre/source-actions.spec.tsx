// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceActions from './source-actions';

// ────────────────────────────────────────────────────────────────────
// THE APPLIED-FOR FIREARM'S ROW (2026-10-13).
//
// One upload control and one collapsed consent. The operator's complaints this
// answers: the consent was rendering fully open at the top of the firearm
// section ("this is then still there, why?"), and it had to sit "underneath a
// button alongside upload proof of applied for firearm".
// ────────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  sellerConsentStatus: vi.fn(),
  inviteSellerConsent: vi.fn(),
  deleteSellerConsent: vi.fn(),
  uploadBlobUrl: vi.fn(),
  sellerConsentLetterUrl: vi.fn(),
}));

vi.mock('@/lib/motivations-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  motivationsApi: api,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    getToken: async () => 't',
    isLoaded: true,
    isSignedIn: true,
  }),
}));

const base = {
  motivationId: 'mo-1',
  applicantName: 'Johan Pretorius',
  firearm: { make: 'CZ', model: 'Shadow 2', calibre: '9mm' },
  sourceValue: '',
  signed: false,
  generated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.sellerConsentStatus.mockResolvedValue({ status: 'NONE' });
  api.sellerConsentLetterUrl.mockResolvedValue('blob:letter');
  // jsdom has no createObjectURL.
  Object.defineProperty(global.URL, 'createObjectURL', {
    configurable: true,
    value: () => 'blob:letter',
  });
  Object.defineProperty(global.URL, 'revokeObjectURL', {
    configurable: true,
    value: () => undefined,
  });
});

describe('the upload control', () => {
  it('offers the applied-for firearm paperwork', () => {
    render(<SourceActions {...base} />);
    expect(
      screen.getByText(/Upload the applied-for firearm/i),
    ).toBeDefined();
  });
});

describe('the consent, collapsed behind a button', () => {
  it('hides the consent form until the button is pressed', async () => {
    render(<SourceActions {...base} />);
    // The invite form's own copy is not on screen yet.
    expect(screen.queryByText(/Buying from a private owner/i)).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: /Ask the current owner for consent/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Buying from a private owner/i)).toBeDefined(),
    );
  });

  it('⚠️ HIDES the consent on a known dealer sale', () => {
    render(<SourceActions {...base} sourceValue="From a dealer" />);
    expect(
      screen.queryByRole('button', {
        name: /Ask the current owner for consent/i,
      }),
    ).toBeNull();
    // The upload is still offered — a dealer's invoice is our source proof.
    expect(
      screen.getByText(/Upload the applied-for firearm/i),
    ).toBeDefined();
  });
});

describe('a filled-out consent', () => {
  it('shows the subscript and a View while not generated', () => {
    render(<SourceActions {...base} signed />);
    expect(screen.getByText(/Consent filled out/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /View/i })).toBeDefined();
  });

  it('shows neither before the owner has signed', () => {
    render(<SourceActions {...base} />);
    expect(screen.queryByText(/Consent filled out/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /View/i })).toBeNull();
  });

  it('opens the letter when View is pressed', async () => {
    render(<SourceActions {...base} signed />);
    await userEvent.click(screen.getByRole('button', { name: /View/i }));
    await waitFor(() =>
      expect(api.sellerConsentLetterUrl).toHaveBeenCalledWith(
        expect.any(Function),
        'mo-1',
      ),
    );
    expect(screen.getByText(/consent letter/i)).toBeDefined();
  });
});

describe('⚠️ nothing once the motivation is finalised', () => {
  it('renders nothing at all', () => {
    const { container } = render(<SourceActions {...base} signed generated />);
    expect(container.textContent).toBe('');
  });
});
