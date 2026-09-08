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
    render(<DocumentShelf documents={[doc()]} onAdd={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getByText('A')).toBeDefined();
    expect(screen.getByText('Identity document')).toBeDefined();
  });

  it('still shows a document that has no letter yet', () => {
    // Lettering happens when the pack is assembled. A document uploaded before
    // that must not vanish off the shelf while it waits.
    render(<DocumentShelf documents={[doc({ letter: null })]} onAdd={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getByText('Identity document')).toBeDefined();
  });

  it('⚠️ MARKS AN UNREAD DOCUMENT "check this", NOT AS A FAILURE', () => {
    // It is still attached and still goes in the pack. Colouring it as an
    // error teaches members to re-upload documents that were fine.
    render(<DocumentShelf documents={[doc({ state: 'check' })]} onAdd={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getByLabelText('Check this')).toBeDefined();
  });

  it('⚠️ KEEPS A SCAN TILE AND AN ADD TILE, BOTH VISIBLE', async () => {
    // Operator, on the Document Centre's equivalent: "replace the Add button
    // with two buttons, Upload and Scan with phone." Behind one generic "+"
    // the camera is invisible — and most of what belongs on this shelf is a
    // card the member is holding.
    const onAdd = vi.fn();
    const onScan = vi.fn();
    render(<DocumentShelf documents={[doc()]} onAdd={onAdd} onScan={onScan} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Scan a document with your phone' }),
    );
    expect(onScan).toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Upload a file from this device' }),
    );
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('the empty shelf', () => {
  it('offers the wide tile, and says what will happen', () => {
    render(<DocumentShelf documents={[]} onAdd={vi.fn()} onScan={vi.fn()} />);
    expect(
      screen.getByText('Add your ID, licences and certificates'),
    ).toBeDefined();
    expect(
      screen.getByText(/We read them and fill this page in/),
    ).toBeDefined();
  });

  it('⚠️ APOLOGISES FOR NOTHING — no error, no warning, no empty state copy', () => {
    render(<DocumentShelf documents={[]} onAdd={vi.fn()} onScan={vi.fn()} />);
    const text = document.body.textContent ?? '';
    for (const word of ['no documents', 'nothing', 'missing', 'required']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('⚠️ THE WIDE TILE OPENS THE SCANNER, BECAUSE ITS COPY PROMISES ONE', async () => {
    // It reads "Scan with your phone or choose files". It shipped opening only
    // the picker — the kind of gap nobody reports as a bug; they just conclude
    // the product cannot do it.
    const onAdd = vi.fn();
    const onScan = vi.fn();
    render(<DocumentShelf documents={[]} onAdd={onAdd} onScan={onScan} />);

    await userEvent.click(
      screen.getByText('Add your ID, licences and certificates'),
    );
    expect(onScan).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('still offers the picker for somebody with files already', async () => {
    const onAdd = vi.fn();
    render(<DocumentShelf documents={[]} onAdd={onAdd} onScan={vi.fn()} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Upload from this device' }),
    );
    expect(onAdd).toHaveBeenCalled();
  });
});
