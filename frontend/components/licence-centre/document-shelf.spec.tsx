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
  origin: 'member',
  ...over,
});

const file = (name: string) =>
  new File(['x'], name, { type: 'application/pdf' });

describe('with documents', () => {
  it('shows the annexure letter, which is how a DFO finds the page', () => {
    render(<DocumentShelf documents={[doc()]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getByText('A')).toBeDefined();
    expect(screen.getByText('Identity document')).toBeDefined();
  });

  it('still shows a document that has no letter yet', () => {
    // Lettering happens when the pack is assembled. A document uploaded before
    // that must not vanish off the shelf while it waits.
    render(<DocumentShelf documents={[doc({ letter: null })]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getByText('Identity document')).toBeDefined();
  });

  it('⚠️ MARKS AN UNREAD DOCUMENT "check this", NOT AS A FAILURE', () => {
    // It is still attached and still goes in the pack. Colouring it as an
    // error teaches members to re-upload documents that were fine.
    render(<DocumentShelf documents={[doc({ state: 'check' })]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getByLabelText('Check this')).toBeDefined();
  });

  it('⚠️ KEEPS A SCAN TILE AND AN ADD TILE, BOTH VISIBLE', async () => {
    // Operator, on the Document Centre's equivalent: "replace the Add button
    // with two buttons, Upload and Scan with phone." Behind one generic "+"
    // the camera is invisible — and most of what belongs on this shelf is a
    // card the member is holding.
    const onUpload = vi.fn();
    const onScan = vi.fn();
    render(<DocumentShelf documents={[doc()]} onUpload={onUpload} onScan={onScan} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Scan a document with your phone' }),
    );
    expect(onScan).toHaveBeenCalled();

    // ⚠️ THE UPLOAD TILE IS A PICKER, NOT A BUTTON THAT OPENS A SCREEN. It
    // used to open the Add panel, which mounted a second scanner and a second
    // picker underneath the shelf. Operator: "this is double."
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, file('id.pdf'));
    expect(onUpload).toHaveBeenCalledWith([expect.objectContaining({ name: 'id.pdf' })]);
  });

  it('⚠️ OFFERS EXACTLY ONE SCANNER AND EXACTLY ONE PICKER', () => {
    render(<DocumentShelf documents={[doc()]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(
      screen.getAllByRole('button', { name: /scan/i }).length,
    ).toBe(1);
    expect(document.querySelectorAll('input[type="file"]').length).toBe(1);
  });
});

describe('the empty shelf', () => {
  it('offers the wide tile, and says what will happen', () => {
    render(<DocumentShelf documents={[]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(
      screen.getByText('Add your ID, licences and certificates'),
    ).toBeDefined();
    expect(
      screen.getByText(/We read them and fill this page in/),
    ).toBeDefined();
  });

  it('⚠️ APOLOGISES FOR NOTHING — no error, no warning, no empty state copy', () => {
    render(<DocumentShelf documents={[]} onUpload={vi.fn()} onScan={vi.fn()} />);
    const text = document.body.textContent ?? '';
    for (const word of ['no documents', 'nothing', 'missing', 'required']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('⚠️ THE WIDE TILE OPENS THE SCANNER, BECAUSE ITS COPY PROMISES ONE', async () => {
    // It reads "Scan with your phone or choose files". It shipped opening only
    // the picker — the kind of gap nobody reports as a bug; they just conclude
    // the product cannot do it.
    const onUpload = vi.fn();
    const onScan = vi.fn();
    render(<DocumentShelf documents={[]} onUpload={onUpload} onScan={onScan} />);

    await userEvent.click(
      screen.getByText('Add your ID, licences and certificates'),
    );
    expect(onScan).toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('⚠️ THE SECOND BOX IS A PICKER, IN THE SAME STYLE, BESIDE IT', async () => {
    // Operator, 2026-09-08: "add the upload files next to the Add your ID,
    // licences and certificates in the same style of box."
    const onUpload = vi.fn();
    const onScan = vi.fn();
    render(<DocumentShelf documents={[]} onUpload={onUpload} onScan={onScan} />);

    expect(screen.getByText('Upload from this device')).toBeDefined();
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, file('id.pdf'));
    expect(onUpload).toHaveBeenCalledWith([expect.objectContaining({ name: 'id.pdf' })]);
    // Choosing a file must not also open the scanner.
    expect(onScan).not.toHaveBeenCalled();
  });

  it('⚠️ SAYS "or choose files" NOWHERE, because that box no longer does', () => {
    // One box per route: the copy on each says only what that box does.
    render(<DocumentShelf documents={[]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(document.body.textContent).not.toContain('or choose files');
  });

  it('⚠️ OFFERS EXACTLY ONE SCANNER AND EXACTLY ONE PICKER', () => {
    render(<DocumentShelf documents={[]} onUpload={vi.fn()} onScan={vi.fn()} />);
    expect(screen.getAllByRole('button').length).toBe(1);
    expect(document.querySelectorAll('input[type="file"]').length).toBe(1);
  });
});


describe('where each page came from', () => {
  // ⚠️ A LETTER, NOT A COLOUR. The shelf already spends colour on the READ
  // state — green for read cleanly, gold for check this — and a second colour
  // code on the same 72px tile would be two things to learn and one to confuse.
  it('marks a Licence Centre page and a member-added one differently', () => {
    render(
      <DocumentShelf
        documents={[
          doc({ id: 'a', origin: 'vault' }),
          doc({ id: 'b', origin: 'member' }),
        ]}
        onUpload={vi.fn()}
        onScan={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Added by the Licence Centre')).toBeDefined();
    expect(screen.getByLabelText('You added this')).toBeDefined();
  });

  it('⚠️ EXPLAINS THE MARKS, because two letters are not self-evident', () => {
    render(
      <DocumentShelf
        documents={[doc({ origin: 'vault' })]}
        onUpload={vi.fn()}
        onScan={vi.fn()}
      />,
    );
    // The legend line, not the tile's own aria-label.
    expect(
      screen.getAllByText('Added by the Licence Centre').length,
    ).toBeGreaterThan(0);
  });

  it('shows only the half of the legend that applies', () => {
    render(
      <DocumentShelf
        documents={[doc({ origin: 'vault' })]}
        onUpload={vi.fn()}
        onScan={vi.fn()}
      />,
    );
    expect(screen.queryByText('You added this')).toBeNull();
  });
});
