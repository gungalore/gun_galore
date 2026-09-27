// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import UploadBatch, {
  containerLabel,
  placementLine,
  verdictLine,
  type BatchCard,
} from './upload-batch';
import type { IdentifyVerdict } from '@/lib/licence-centre-api';

// jsdom has no object-URL API; the strip's unmount revokes the URLs the caller
// owns, so the stub is what lets that cleanup path run rather than throwing.
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

// ────────────────────────────────────────────────────────────────────
// THE PER-FILE STRIP — one card per file, saying what the AI made of it.
//
// The Evidence panel is gone. It asked the member to type what a file showed
// BEFORE anything had looked at it, and when the classifier still could not
// decide it drew a "we could not decide" row. This strip replaces that
// surface: the server sorts the batch, and every file gets a card here — in
// the upload flow the member is already in.
//
// ⚠️ THE STRIP IS PRESENTATIONAL. It owns no state — the description, the
// verdict and the state of each card live with the caller, which is the only
// thing that can resend the words. These tests pin what it SHOWS and what it
// ASKS, not where the answer is kept.
//
// ⚠️ AN UNRESOLVED ITEM IS NOT AN ERROR. A missing container is the classifier
// being cautious — a wrong one moves the file's page and ticks a DFO row for
// something that does not answer it — so the strip asks for words rather than
// apologising. That distinction is the whole reason this component exists.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THE VERDICT IS THE SERVER'S, SO A FIXTURE HAS TO CARRY ALL OF IT.
 * `id`, `ocrChars` and `kind` are as much a part of what the strip is handed
 * as the role is — the id is the marriage key the caller sends back with the
 * upload, and the strip never invents one.
 */
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
  url: null,
  verdict: verdictOf(),
  state: 'done',
  err: null,
  prepared: null,
  previewUrl: null,
  description: '',
  rowId: 'row-1',
  placement: null,
  ...over,
});

const noop = () => undefined;

describe('the one-line verdict, in the member\u2019s words', () => {
  it('names the document kind it was filed as', () => {
    expect(verdictLine(verdictOf())).toBe('Filed as Firearm licence.');
  });

  it('⚠️ AN UNRESOLVED EVIDENCE ITEM IS NOT AN ERROR, AND DOES NOT APOLOGISE', () => {
    // It says what we think, not what we failed at.
    expect(
      verdictLine(verdictOf({ role: 'evidence', kind: null, container: null, confident: false })),
    ).toBe('We think this is evidence.');
  });

  it('names the container once the classifier is sure of one', () => {
    expect(
      verdictLine(
        verdictOf({
          role: 'evidence',
          kind: null,
          container: 'FARM_PERMISSION_LETTER',
          confident: true,
        }),
      ),
    ).toBe('Filed as evidence — Farm permission letter.');
  });

  it('spaces a container id out rather than showing the raw enum', () => {
    expect(containerLabel('HUNTING_PHOTO')).toBe('Hunting photo');
    expect(containerLabel(null)).toBeNull();
  });

  it('⚠️ SAYS WHERE EVIDENCE WILL PRINT BEFORE THE PACK IS BUILT', () => {
    // "Prints on its own page" and "prints on your Activities page" are the
    // two things a member is choosing between when they describe a photograph.
    expect(placementLine('annexure')).toBe('This will print on its own page in your pack.');
    expect(placementLine('body')).toBe('This will print on your Activities page.');
  });
});

describe('the cards', () => {
  it('renders nothing at all when there is nothing to show', () => {
    const { container } = render(
      <UploadBatch
        cards={[]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('says what a filed document was filed as', () => {
    render(
      <UploadBatch
        cards={[card()]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.getByText('Filed as Firearm licence.')).toBeTruthy();
  });

  it('⚠️ GIVES A CARD STILL WAITING AN ACTION, NOT JUST A SENTENCE', () => {
    // A card an earlier file is queued behind renders 'waiting'. It used to
    // offer NOTHING — no button, no way to drop a photograph the member had
    // changed their mind about — so a stalled batch left them stuck looking
    // at it. See the note in Card's waiting branch.
    const onRemove = vi.fn();
    render(
      <UploadBatch
        cards={[card({ state: 'waiting', rowId: null })]}
        busy={false}
        onDescribe={noop}
        onRemove={onRemove}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.getByText('Waiting to be filed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('id-1');
  });

  it('⚠️ ASKS FOR WORDS ON AN UNRESOLVED EVIDENCE ITEM', () => {
    render(
      <UploadBatch
        cards={[
          card({
            verdict: verdictOf({ role: 'evidence', kind: null, container: null, confident: false }),
            state: 'waiting',
          }),
        ]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.getByText('What does it show?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'File it' })).toBeTruthy();
  });

  it('⚠️ DOES NOT ASK FOR WORDS ONCE A CONTAINER IS DECIDED', () => {
    render(
      <UploadBatch
        cards={[
          card({
            verdict: verdictOf({
              role: 'evidence',
              kind: null,
              container: 'HUNTING_PHOTO',
              confident: true,
            }),
            placement: 'body',
          }),
        ]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.queryByText('What does it show?')).toBeNull();
  });

  it('does not ask for words on an ordinary document', () => {
    render(
      <UploadBatch
        cards={[card()]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.queryByText('What does it show?')).toBeNull();
  });

  it('shows where an evidence item will print once it is filed', () => {
    render(
      <UploadBatch
        cards={[
          card({
            verdict: verdictOf({
              role: 'evidence',
              kind: null,
              container: 'FARM_PERMISSION_LETTER',
              confident: true,
            }),
            placement: 'annexure',
          }),
        ]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(
      screen.getByText(/This will print on its own page in your pack\./),
    ).toBeTruthy();
  });

  it('sends the trimmed words to the caller when the member files it', () => {
    const onDescribe = vi.fn();
    render(
      <UploadBatch
        cards={[
          card({
            verdict: verdictOf({ role: 'evidence', kind: null, container: null, confident: false }),
            state: 'waiting',
            description: '  me and my son on a hunt  ',
          }),
        ]}
        busy={false}
        onDescribe={onDescribe}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'File it' }));
    expect(onDescribe).toHaveBeenCalledWith('id-1', 'me and my son on a hunt');
  });

  it('⚠️ STANDS DOWN WHILE ANY CARD IS BEING FILED', () => {
    render(
      <UploadBatch
        cards={[
          card({
            verdict: verdictOf({ role: 'evidence', kind: null, container: null, confident: false }),
            state: 'waiting',
            description: 'a hunt',
          }),
        ]}
        busy
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'File it' })).toBeDisabled();
  });

  it('lets the member describe a card the caller is holding the words for', () => {
    const onDescriptionChange = vi.fn();
    render(
      <UploadBatch
        cards={[
          card({
            verdict: verdictOf({ role: 'evidence', kind: null, container: null, confident: false }),
            state: 'waiting',
          }),
        ]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={onDescriptionChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/a hunt in Limpopo/i), {
      target: { value: 'a farm letter' },
    });
    expect(onDescriptionChange).toHaveBeenCalledWith('id-1', 'a farm letter');
  });

  it('drops a card the member no longer wants filed', () => {
    const onRemove = vi.fn();
    render(
      <UploadBatch
        cards={[card()]}
        busy={false}
        onDescribe={noop}
        onRemove={onRemove}
        onDescriptionChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRemove).toHaveBeenCalledWith('id-1');
  });

  it('⚠️ ADMITS A FILE IT COULD NOT FILE RATHER THAN SAYING NOTHING', () => {
    render(
      <UploadBatch
        cards={[card({ state: 'failed', err: 'We could not file that one.', rowId: null })]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.getByText('We could not file that one.')).toBeTruthy();
  });

  it('opens a picture full size when the member taps the thumbnail', () => {
    const onOpen = vi.fn();
    render(
      <UploadBatch
        cards={[card({ url: 'blob:one' })]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View photo.jpg' }));
    expect(onOpen).toHaveBeenCalledWith('blob:one', 'photo.jpg');
  });

  it('⚠️ SHOWS A PDF AS A PDF — THERE IS NO PICTURE TO DRAW', () => {
    render(
      <UploadBatch
        cards={[
          card({
            file: new File(['%PDF'], 'licence.pdf', { type: 'application/pdf' }),
            url: null,
          }),
        ]}
        busy={false}
        onDescribe={noop}
        onRemove={noop}
        onDescriptionChange={noop}
      />,
    );
    expect(screen.getByText('PDF')).toBeTruthy();
  });
});
