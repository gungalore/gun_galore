// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttachedDocuments from './attached-documents';
import type { PickableKind, UploadRow } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// WHAT YOU ALREADY GAVE US, AND WHAT YOU MAY DO TO IT.
//
// The rebuilt wizard had no list of attached documents at all, so a member who
// photographed the wrong page could see nothing and undo nothing. These assert
// the four actions behave differently from each other, because the whole point
// is that they are not interchangeable.
// ────────────────────────────────────────────────────────────────────

const doc = (over: Partial<UploadRow> & { id: string }): UploadRow => ({
  kind: 'IDENTITY_DOCUMENT',
  label: 'A copy of your ID',
  annexure: 'A',
  byteSize: 1024,
  available: true,
  ...over,
});

const PICKABLE: PickableKind[] = [
  { kind: 'IDENTITY_DOCUMENT', label: 'A copy of your ID' },
  { kind: 'ADDRESS_CONFIRMATION', label: 'Proof of your address' },
] as PickableKind[];

const handlers = () => ({
  onView: vi.fn(),
  onRemove: vi.fn(),
  onReread: vi.fn(),
  onRefile: vi.fn(),
});

function show(documents: UploadRow[], kinds: string[], h = handlers()) {
  render(
    <AttachedDocuments
      documents={documents}
      kinds={kinds}
      pickable={PICKABLE}
      {...h}
    />,
  );
  return h;
}

describe('⚠️ a step shows only the documents it asked for', () => {
  it('leaves another step’s document to that step', () => {
    // The rebuilt design puts the question on the step that asks it. A proof
    // of address listed under "Your competency" is the old page's one-long-
    // list problem creeping back in.
    show(
      [
        doc({ id: '1' }),
        doc({ id: '2', kind: 'ADDRESS_CONFIRMATION', label: 'Proof of your address' }),
      ],
      ['IDENTITY_DOCUMENT'],
    );
    expect(screen.getByText('A copy of your ID')).toBeInTheDocument();
    expect(screen.queryByText('Proof of your address')).not.toBeInTheDocument();
  });

  it('renders nothing at all when this step has none', () => {
    const { container } = render(
      <AttachedDocuments
        documents={[doc({ id: '1' })]}
        kinds={['SAFE_PHOTOGRAPHS']}
        pickable={PICKABLE}
        {...handlers()}
      />,
    );
    // Not an empty card with a heading — nothing.
    expect(container).toBeEmptyDOMElement();
  });
});

describe('⚠️ a purged document still lists, and cannot be opened', () => {
  // The row can outlive the bytes: it is the record that a document was
  // submitted. Offering a View that fails after the member taps it would be
  // worse than not offering one.

  it('offers no View or Read again once the bytes are gone', () => {
    show([doc({ id: '1', available: false })], ['IDENTITY_DOCUMENT']);
    expect(screen.getByText(/no longer stored/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Read again' }),
    ).not.toBeInTheDocument();
  });

  it('still offers Remove, so the row can be cleared', () => {
    const h = show([doc({ id: '1', available: false })], ['IDENTITY_DOCUMENT']);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(h.onRemove).not.toHaveBeenCalled();
  });
});

describe('the four actions do four different things', () => {
  it('calls each one with the document id', async () => {
    const user = userEvent.setup();
    const h = show([doc({ id: 'up-1' })], ['IDENTITY_DOCUMENT']);

    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(h.onView).toHaveBeenCalledWith('up-1');

    await user.click(screen.getByRole('button', { name: 'Read again' }));
    expect(h.onReread).toHaveBeenCalledWith('up-1');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(h.onRemove).toHaveBeenCalledWith('up-1');
  });

  it('⚠️ REFILING AS THE SAME KIND DOES NOTHING', () => {
    // Refiling a document as what it already is costs a round trip and, on
    // the server, re-runs the extraction — a paid vision call to learn what
    // we already know.
    return (async () => {
      const user = userEvent.setup();
      const h = show([doc({ id: 'up-1' })], ['IDENTITY_DOCUMENT']);
      await user.click(screen.getByRole('button', { name: 'Change type' }));
      await user.selectOptions(
        screen.getByRole('combobox'),
        'IDENTITY_DOCUMENT',
      );
      expect(h.onRefile).not.toHaveBeenCalled();
    })();
  });

  it('refiles when the kind actually changes', async () => {
    const user = userEvent.setup();
    const h = show([doc({ id: 'up-1' })], ['IDENTITY_DOCUMENT']);
    await user.click(screen.getByRole('button', { name: 'Change type' }));
    await user.selectOptions(screen.getByRole('combobox'), 'ADDRESS_CONFIRMATION');
    expect(h.onRefile).toHaveBeenCalledWith('up-1', 'ADDRESS_CONFIRMATION');
  });
});

describe('⚠️ "we could not read this" is not a rejection', () => {
  it('says so, and points at the two things that fix it', () => {
    // The document may be perfectly good and simply hard to photograph, and
    // the member can still type the values. Amber, never red.
    show([doc({ id: '1', suspect: true })], ['IDENTITY_DOCUMENT']);
    const note = screen.getByText(/could not read/i);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/read it again/i);
    expect(note.textContent).toMatch(/change its type/i);
  });

  it('says nothing when the reading went fine', () => {
    show([doc({ id: '1' })], ['IDENTITY_DOCUMENT']);
    expect(screen.queryByText(/could not read/i)).not.toBeInTheDocument();
  });
});

describe('⚠️ the date a DFO checks first', () => {
  // The server has always sent `expiresOn`, `caution` and `sourceRemovedAt` on
  // the row. This list rendered the kind and the annexure letter and nothing
  // else — so a step that looked complete could be a letter of good standing
  // that lapsed in March, and the member found out at the counter.

  it('renders the caution the server sent', () => {
    show(
      [
        doc({
          id: '1',
          caution: { tone: 'red', text: 'Expired 3 March 2026' },
        }),
      ],
      ['IDENTITY_DOCUMENT'],
    );
    expect(screen.getByText(/expired 3 march 2026/i)).toBeInTheDocument();
  });

  it('⚠️ SAYS WHEN A ROW CANNOT ANSWER ITS REQUIREMENT', () => {
    // A checklist that goes green over an expired certificate is worse than
    // one that stays amber: it stops the member looking.
    show(
      [doc({ id: '1', caution: { tone: 'red', text: 'Expired' } })],
      ['IDENTITY_DOCUMENT'],
    );
    expect(screen.getByText(/cannot answer its row/i)).toBeInTheDocument();
  });

  it('counts an amber row as usable — it is a warning, not a block', () => {
    show(
      [doc({ id: '1', caution: { tone: 'amber', text: 'Expires soon' } })],
      ['IDENTITY_DOCUMENT'],
    );
    expect(screen.getByText(/expires soon/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot answer/i)).not.toBeInTheDocument();
  });

  it('⚠️ THE SOURCE CAN BE GONE WHILE THE FILE IS STILL HERE', async () => {
    // The bytes on this application may survive, but the Document Centre copy
    // behind them has been deleted — so nothing can be re-read or renewed from
    // it, and the member needs somewhere to put a fresh one.
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <AttachedDocuments
        documents={[doc({ id: '1', sourceRemovedAt: '2026-09-01' })]}
        kinds={['IDENTITY_DOCUMENT']}
        pickable={PICKABLE}
        onReplace={onReplace}
        {...handlers()}
      />,
    );
    expect(screen.getByText(/deleted from your document centre/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /replace it/i }));
    expect(onReplace).toHaveBeenCalledWith('IDENTITY_DOCUMENT');
  });

  it('says nothing at all about a row with no date and no caution', () => {
    show([doc({ id: '1' })], ['IDENTITY_DOCUMENT']);
    expect(screen.queryByText(/expire/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deleted from/i)).not.toBeInTheDocument();
  });
});

describe('a document being worked on', () => {
  it('disables its own controls', async () => {
    const h = handlers();
    render(
      <AttachedDocuments
        documents={[doc({ id: 'busy-1' })]}
        kinds={['IDENTITY_DOCUMENT']}
        pickable={PICKABLE}
        busyId="busy-1"
        {...h}
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View' })).toBeDisabled();
  });
});
