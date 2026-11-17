// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ⚠️ THE SCANNER ITSELF IS NOT UNDER TEST. What matters here is that a phone
// hand-off delivery runs the same apply-and-review path the Upload button does;
// the mock lets a test stand in for the phone.
vi.mock('@/components/scan/scan-button', () => ({
  default: (props: { onHandoffArrived?: (count: number) => void }) => (
    <button
      type="button"
      onClick={() => props.onHandoffArrived?.(1)}
    >
      mock-phone-sent
    </button>
  ),
}));

import DocumentAddButtons from './document-add-buttons';

const OUTCOMES = [
  {
    file: 'Scan 1',
    label: 'Dealer invoice',
    kind: 'FIREARM_SOURCE_PROOF',
    uploadId: 'u1',
    fields: [
      { key: 'firearm_make', label: 'Make', value: 'Tikka' },
      { key: 'firearm_calibre', label: 'Calibre', value: '.30-06' },
    ],
  },
];

function panel(over: Partial<Parameters<typeof DocumentAddButtons>[0]> = {}) {
  return (
    <DocumentAddButtons
      motivationId="mo-1"
      busy={false}
      onFiles={async () => []}
      onHandoffArrived={async () => OUTCOMES}
      onPreview={async () => {
        throw new Error('no preview in this test');
      }}
      onApply={async () => undefined}
      {...over}
    />
  );
}

describe('the document door', () => {
  it('opens the review sheet for a phone hand-off, like an upload', async () => {
    const user = userEvent.setup();
    render(panel());

    // Open the scanner, then let the phone deliver.
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await user.click(screen.getByRole('button', { name: 'mock-phone-sent' }));

    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: 'Review the document you uploaded' }),
      ).toBeDefined(),
    );
    expect(screen.getByText('Make')).toBeDefined();
    expect(screen.getByDisplayValue('Tikka')).toBeDefined();
    expect(screen.getByText('Calibre')).toBeDefined();
  });

  it('saves the reviewed hand-off values when Done is pressed', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(panel({ onApply }));

    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await user.click(screen.getByRole('button', { name: 'mock-phone-sent' }));
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: 'Review the document you uploaded' }),
      ).toBeDefined(),
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onApply).toHaveBeenCalledWith({
      firearm_make: 'Tikka',
      firearm_calibre: '.30-06',
    });
  });
});
