// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import BatchReview from './batch-preview';
import { type BatchCard } from './upload-batch';
import type { IdentifyVerdict } from '@/lib/licence-centre-api';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

// ────────────────────────────────────────────────────────────────────
// THE ONE SCREEN — DOCUMENTS SORTED, EVIDENCE SORTED, ONE CONFIRM.
//
// Operator, 2026-09-28: "the next screen they see is documents sorted and
// evidence sorted, everything is identified and they can just confirm that
// it's right and it goes into the vault."
//
// What must hold:
//   1. the two groups are actually separate, and each row shows what we made
//      of the file;
//   2. an evidence item cannot be filed without a description — the words are
//      what place it, so the confirm is dead until every one has some;
//   3. the enhanced crop is what is drawn for a document (that is what is
//      being confirmed), and the magnifier opens it at full size.
// ────────────────────────────────────────────────────────────────────

const verdictOf = (over: Partial<IdentifyVerdict> = {}): IdentifyVerdict => ({
  id: 'v-1',
  role: 'document',
  kind: 'FIREARM_LICENCE',
  container: null,
  confident: true,
  ocrChars: 0,
  ...over,
});

const card = (over: Partial<BatchCard> = {}): BatchCard => ({
  id: 'id-1',
  file: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
  url: 'blob:raw',
  verdict: verdictOf(),
  state: 'ready',
  err: null,
  prepared: new File(['y'], 'photo.jpg', { type: 'image/jpeg' }),
  previewUrl: 'blob:enhanced',
  description: '',
  rowId: null,
  placement: null,
  ...over,
});

const noop = () => undefined;

function renderReview(
  cards: BatchCard[],
  over: Partial<React.ComponentProps<typeof BatchReview>> = {},
) {
  return render(
    <BatchReview
      cards={cards}
      busy={false}
      onRemove={noop}
      onDescriptionChange={noop}
      onConfirm={noop}
      {...over}
    />,
  );
}

describe('the sorted review', () => {
  it('renders nothing when there is nothing to show', () => {
    const { container } = renderReview([]);
    expect(container.firstChild).toBeNull();
  });

  it('⚠️ SORTS DOCUMENTS FROM EVIDENCE UNDER THEIR OWN LABELS', () => {
    renderReview([
      card({ id: 'd1' }),
      card({
        id: 'e1',
        verdict: verdictOf({ role: 'evidence', kind: null, container: 'HUNTING_PHOTO' }),
        description: 'a hunt',
      }),
    ]);
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.getByText('Evidence')).toBeTruthy();
    expect(screen.getByText('Filed as Firearm licence.')).toBeTruthy();
    expect(screen.getByText('Evidence — Hunting photo.')).toBeTruthy();
  });

  it('\u26a0\ufe0f DRAWS THE ENHANCED CROP, AND THE MAGNIFIER OPENS IT', () => {
    const onOpen = vi.fn();
    renderReview([card({ url: 'blob:raw', previewUrl: 'blob:enhanced' })], {
      onOpen,
    });
    expect(screen.getByRole('img', { name: 'photo.jpg' }).getAttribute('src')).toBe(
      'blob:enhanced',
    );
    fireEvent.click(screen.getByRole('button', { name: 'View photo.jpg' }));
    expect(onOpen).toHaveBeenCalledWith('blob:enhanced', 'photo.jpg');
  });

  it('\u26a0\ufe0f WILL NOT FILE AN UNDESCRIBED EVIDENCE ITEM', () => {
    const onConfirm = vi.fn();
    renderReview(
      [
        card({
          id: 'e1',
          verdict: verdictOf({ role: 'evidence', kind: null, container: null }),
          description: '',
        }),
      ],
      { onConfirm },
    );
    expect(screen.getByRole('button', { name: 'Confirm and file' })).toBeDisabled();
    expect(screen.getByText(/Describe the photograph below/)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('enables the confirm once every evidence item is described', () => {
    const onConfirm = vi.fn();
    renderReview(
      [
        card({
          id: 'e1',
          verdict: verdictOf({ role: 'evidence', kind: null, container: null }),
          description: 'me and my son on a hunt',
        }),
      ],
      { onConfirm },
    );
    const button = screen.getByRole('button', { name: 'Confirm and file' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reports edits to an evidence description back to the caller', () => {
    const onDescriptionChange = vi.fn();
    renderReview(
      [
        card({
          id: 'e1',
          verdict: verdictOf({ role: 'evidence', kind: null, container: null }),
        }),
      ],
      { onDescriptionChange },
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'my reloading bench' },
    });
    expect(onDescriptionChange).toHaveBeenCalledWith('e1', 'my reloading bench');
  });

  it('does not require a description on a document', () => {
    renderReview([card()]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Confirm and file' }),
    ).not.toBeDisabled();
  });

  it('offers Fix crop for a document and Remove for both', () => {
    const onFix = vi.fn();
    const onRemove = vi.fn();
    renderReview(
      [
        card({ id: 'd1' }),
        card({
          id: 'e1',
          verdict: verdictOf({ role: 'evidence', kind: null, container: 'RANGE' }),
          description: 'at the range',
        }),
      ],
      { onFix, onRemove },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix crop' }));
    expect(onFix).toHaveBeenCalledWith('d1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(onRemove).toHaveBeenCalledWith('d1');
  });

  it('\u26a0\ufe0f STANDS DOWN WHILE THE BATCH IS BEING FILED', () => {
    renderReview([card()], { busy: true });
    expect(screen.getByRole('button', { name: 'Filing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
