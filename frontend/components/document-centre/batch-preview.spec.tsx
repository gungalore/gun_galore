// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import BatchPreview from './batch-preview';
import { type BatchCard } from './upload-batch';
import type { IdentifyVerdict } from '@/lib/licence-centre-api';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

// ────────────────────────────────────────────────────────────────────
// THE LOOK-BEFORE-IT-IS-KEPT STEP.
//
// Operator's flow: read files, sort documents from evidence, enhance the
// documents, then "open preview for user to look at documents so they can
// make sure they have been correctly identified". These tests pin the two
// things that make that a confirm step and not a decoration:
//
//   1. the ENHANCED image is what is shown — the crop is what is being
//      approved, so the crop is what must be drawn; and
//   2. nothing is filed until "File these" — the button is the only path to
//      the caller's confirm, and a card with no bytes cannot be filed at all.
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

describe('the preview', () => {
  it('renders nothing when there is nothing to show', () => {
    const { container } = render(
      <BatchPreview cards={[]} busy={false} onRemove={noop} onConfirm={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('says what we made of each file, in the member\u2019s words', () => {
    render(
      <BatchPreview
        cards={[card()]}
        busy={false}
        onRemove={noop}
        onConfirm={noop}
      />,
    );
    expect(screen.getByText('Filed as Firearm licence.')).toBeTruthy();
  });

  it('⚠️ TELLS THEM NOTHING IS SAVED YET', () => {
    render(
      <BatchPreview
        cards={[card()]}
        busy={false}
        onRemove={noop}
        onConfirm={noop}
      />,
    );
    expect(screen.getByText(/Nothing has been saved yet/)).toBeTruthy();
  });

  it('⚠️ DRAWS THE ENHANCED IMAGE, NOT THE RAW PICK', () => {
    // The crop is what is being confirmed, so the crop is what is shown.
    render(
      <BatchPreview
        cards={[card({ url: 'blob:raw', previewUrl: 'blob:enhanced' })]}
        busy={false}
        onRemove={noop}
        onConfirm={noop}
      />,
    );
    expect(screen.getByRole('img', { name: 'photo.jpg' }).getAttribute('src')).toBe(
      'blob:enhanced',
    );
  });

  it('files nothing until the member presses the button', () => {
    const onConfirm = vi.fn();
    render(
      <BatchPreview
        cards={[card()]}
        busy={false}
        onRemove={noop}
        onConfirm={onConfirm}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'File these' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('files nothing when no card has bytes ready', () => {
    const onConfirm = vi.fn();
    render(
      <BatchPreview
        cards={[card({ state: 'waiting', prepared: null, previewUrl: null })]}
        busy={false}
        onRemove={noop}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: 'File these' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('⚠️ ADMITS A CARD WITH NOTHING TO FILE RATHER THAN SHOWING A DEAD X', () => {
    render(
      <BatchPreview
        cards={[card({ state: 'waiting', prepared: null, previewUrl: null })]}
        busy={false}
        onRemove={noop}
        onConfirm={noop}
      />,
    );
    expect(screen.getByText(/nothing to file for this one/)).toBeTruthy();
  });

  it('counts only the cards that are actually ready', () => {
    render(
      <BatchPreview
        cards={[card(), card({ id: 'id-2', state: 'waiting', prepared: null })]}
        busy={false}
        onRemove={noop}
        onConfirm={noop}
      />,
    );
    expect(screen.getByText('1 document ready')).toBeTruthy();
  });

  it('removes a card by id', () => {
    const onRemove = vi.fn();
    render(
      <BatchPreview
        cards={[card()]}
        busy={false}
        onRemove={onRemove}
        onConfirm={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('id-1');
  });

  it('⚠️ STANDS DOWN WHILE THE BATCH IS BEING FILED', () => {
    render(
      <BatchPreview cards={[card()]} busy onRemove={noop} onConfirm={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Filing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('opens a picture full size from the enhanced preview URL', () => {
    const onOpen = vi.fn();
    render(
      <BatchPreview
        cards={[card({ previewUrl: 'blob:enhanced' })]}
        busy={false}
        onRemove={noop}
        onConfirm={noop}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View photo.jpg' }));
    expect(onOpen).toHaveBeenCalledWith('blob:enhanced', 'photo.jpg');
  });
});
