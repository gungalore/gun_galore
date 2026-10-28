// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnplacedUploadDialog, {
  type UnplacedUpload,
} from './unplaced-upload-dialog';

function item(overrides: Partial<UnplacedUpload> = {}): UnplacedUpload {
  return {
    file: new File(['x'], 'gate.pdf', { type: 'application/pdf' }),
    kind: '',
    reason: 'we could not place it in an evidence container',
    attempts: 1,
    ...overrides,
  };
}

describe('the unplaced upload dialog', () => {
  it('shows the file, the reason and a description box', () => {
    render(
      <UnplacedUploadDialog
        item={item()}
        busy={false}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('gate.pdf')).toBeDefined();
    expect(screen.getByText(/could not place it/i)).toBeDefined();
    expect(screen.getByLabelText('What is it?')).toBeDefined();
  });

  it('retries with the member’s words', async () => {
    const onRetry = vi.fn();
    render(
      <UnplacedUploadDialog
        item={item()}
        busy={false}
        onRetry={onRetry}
        onDiscard={vi.fn()}
      />,
    );
    await userEvent.type(
      screen.getByLabelText('What is it?'),
      'the broken gate after the break-in',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith('the broken gate after the break-in');
  });

  it('does not retry without words', () => {
    render(
      <UnplacedUploadDialog
        item={item()}
        busy={false}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('discards after the final refusal', async () => {
    const onDiscard = vi.fn();
    render(
      <UnplacedUploadDialog
        item={item({ attempts: 3 })}
        busy={false}
        onRetry={vi.fn()}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.queryByLabelText('What is it?')).toBeNull();
    expect(screen.getByText(/will not be saved/i)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    expect(onDiscard).toHaveBeenCalled();
  });
});
