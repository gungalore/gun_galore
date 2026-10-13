// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CredentialCard from './credential-card';
import {
  licenceCentreApi,
  type CredentialRow,
} from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// TURNING A DOCUMENT FROM THE CARD.
//
// ⚠️ THE BUTTON EXISTS BECAUSE THE SCANNER GOT IT WRONG. Operator,
// 2026-10-13: "my ID scan is on its side." A turn rewrites the file, so the
// card must call the endpoint and reload — and the preview is what lets the
// member see that it worked, rather than reopening the View tab to check.
// ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

function row(over: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: 'c1',
    kind: 'IDENTITY_DOCUMENT',
    title: 'My ID',
    issuedOn: null,
    expiresOn: null,
    confirmed: false,
    neverExpires: false,
    issuedOnUnknown: false,
    coversKinds: [],
    remindersMuted: false,
    state: 'valid',
    renewalDue: false,
    details: {},
    derivedExpiry: null,
    available: true,
    mimeType: 'image/jpeg',
    byteSize: 1234,
    createdAt: '2026-10-01T00:00:00.000Z',
    autoFiled: false,
    namedConfident: true,
    readUncertain: [],
    readNotes: [],
    attention: [],
    duplicateOf: null,
    otherSide: null,
    dateSource: null,
    dateSourceNote: null,
    ...over,
  } as unknown as CredentialRow;
}

function renderCard(over: Partial<CredentialRow> = {}) {
  const onChanged = vi.fn(async () => undefined);
  const onError = vi.fn();
  render(
    <CredentialCard
      row={row(over)}
      usedIn={[]}
      token={async () => 't'}
      onChanged={onChanged}
      onError={onError}
    />,
  );
  return { onChanged, onError };
}

beforeEach(() => {
  vi.spyOn(licenceCentreApi, 'rotate').mockResolvedValue({ rotated: true });
  vi.spyOn(licenceCentreApi, 'fileBlobUrl').mockResolvedValue('blob:mock');
  // jsdom has no object-URL implementation; the preview cleanup calls revoke.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(
    () => 'blob:mock',
  );
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rotating a document from the card', () => {
  it('sends the direction the member chose and reloads the list', async () => {
    const { onChanged } = renderCard();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rotate right' }));

    expect(licenceCentreApi.rotate).toHaveBeenCalledWith(
      expect.any(Function),
      'c1',
      'right',
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('turns left when the member asks', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Rotate left' }));
    expect(licenceCentreApi.rotate).toHaveBeenCalledWith(
      expect.any(Function),
      'c1',
      'left',
    );
  });

  it('says so at the card when the turn fails', async () => {
    vi.mocked(licenceCentreApi.rotate).mockRejectedValueOnce(
      new Error('nope'),
    );
    const { onError } = renderCard();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rotate right' }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.stringMatching(/could not rotate/i),
      ),
    );
  });

  it('offers no turn on a document with no file behind it', () => {
    renderCard({ available: false });
    expect(
      screen.queryByRole('button', { name: 'Rotate right' }),
    ).toBeNull();
  });

  it('shows the page itself, so the turn can be seen', async () => {
    renderCard();
    expect(await screen.findByAltText('Preview of My ID')).toBeDefined();
  });

  it('leaves a PDF to the View button rather than a broken image', () => {
    renderCard({ mimeType: 'application/pdf' });
    expect(screen.queryByAltText('Preview of My ID')).toBeNull();
  });
});
