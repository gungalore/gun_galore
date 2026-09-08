// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentShelf from './document-shelf';
import type { SheetDocument } from './contract';

// ────────────────────────────────────────────────────────────────────
// THE SHELF.
//
// ⚠️ THE EMPTY CASE IS NOT AN ERROR STATE, and that is the case worth pinning.
// A first-timer's shelf is empty and their page is otherwise identical — more
// rows are `needs_you`, and that is all. There is no separate onboarding
// wizard, and a shelf that apologised for being empty would be the beginning
// of one.
// ────────────────────────────────────────────────────────────────────

const doc = (over: Partial<SheetDocument> = {}): SheetDocument => ({
  id: 'u1',
  kind: 'IDENTITY_DOCUMENT',
  letter: 'A',
  label: 'Identity document',
  mime: 'image/jpeg',
  state: 'read',
  ...over,
});

describe('with documents', () => {
  it('shows the annexure letter, which is how a DFO finds the page', () => {
    render(<DocumentShelf documents={[doc()]} onAdd={vi.fn()} />);
    expect(screen.getByText('A')).toBeDefined();
    expect(screen.getByText('Identity document')).toBeDefined();
  });

  it('still shows a document that has no letter yet', () => {
    // Lettering happens when the pack is assembled. A document uploaded before
    // that must not vanish off the shelf while it waits.
    render(<DocumentShelf documents={[doc({ letter: null })]} onAdd={vi.fn()} />);
    expect(screen.getByText('Identity document')).toBeDefined();
  });

  it('⚠️ MARKS AN UNREAD DOCUMENT "check this", NOT AS A FAILURE', () => {
    // It is still attached and still goes in the pack. Colouring it as an
    // error teaches members to re-upload documents that were fine.
    render(<DocumentShelf documents={[doc({ state: 'check' })]} onAdd={vi.fn()} />);
    expect(screen.getByLabelText('Check this')).toBeDefined();
  });

  it('keeps one Add tile alongside them', async () => {
    const onAdd = vi.fn();
    render(<DocumentShelf documents={[doc()]} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('the empty shelf', () => {
  it('offers the wide tile, and says what will happen', () => {
    render(<DocumentShelf documents={[]} onAdd={vi.fn()} />);
    expect(
      screen.getByText('Add your ID, licences and certificates'),
    ).toBeDefined();
    expect(
      screen.getByText(/We read them and fill this page in/),
    ).toBeDefined();
  });

  it('⚠️ APOLOGISES FOR NOTHING — no error, no warning, no empty state copy', () => {
    render(<DocumentShelf documents={[]} onAdd={vi.fn()} />);
    const text = document.body.textContent ?? '';
    for (const word of ['no documents', 'nothing', 'missing', 'required']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('opens the same door as the small tile', async () => {
    const onAdd = vi.fn();
    render(<DocumentShelf documents={[]} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onAdd).toHaveBeenCalled();
  });
});
