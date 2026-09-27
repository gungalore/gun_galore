// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TrackerHistorySheet from './TrackerHistorySheet';

// ────────────────────────────────────────────────────────────────────
// A WINDOW THAT IS HARD TO CLOSE BY ACCIDENT, AND IMPOSSIBLE TO BE
// CONFUSED BY.
//
// The member is reading dates off a government enquiry. Two failures
// matter here and nothing else does: closing the sheet because their
// thumb twitched mid-scroll, and putting a drag strip on screen that
// does not say what dragging it will do.
// ────────────────────────────────────────────────────────────────────

function renderSheet(onClose = vi.fn()) {
  render(
    <TrackerHistorySheet
      title="My first .308"
      subtitle="C10167347 · Firearm licence"
      onClose={onClose}
    >
      <p>The usual path</p>
    </TrackerHistorySheet>,
  );
  return onClose;
}

/** The strip that owns the drag — the only element in here that does. */
function banner(): HTMLElement {
  return screen
    .getByText('Drag down to close')
    .closest('.cursor-grab') as HTMLElement;
}

function drag(from: number, to: number, step = to) {
  fireEvent.pointerDown(banner(), { clientY: from, pointerId: 1 });
  fireEvent.pointerMove(banner(), { clientY: step, pointerId: 1 });
  fireEvent.pointerUp(banner(), { clientY: step, pointerId: 1 });
}

describe('the window itself', () => {
  it('is a labelled modal, so a screen reader knows what is outside it', () => {
    renderSheet();
    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const labelledBy = panel.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)?.textContent).toBe(
      'My first .308',
    );
  });

  it('stands the Ask Boet dock down, being a full-screen overlay', () => {
    // Both are z-60 and the dock wins the tie on DOM order, so without this
    // the dock sits on top of a sheet that is meant to be the whole screen.
    renderSheet();
    expect(
      screen.getByRole('dialog').getAttribute('data-blocking-overlay'),
    ).toBe('true');
  });

  it('names the application and says what kind it is', () => {
    renderSheet();
    expect(screen.getByText('My first .308')).toBeInTheDocument();
    expect(
      screen.getByText('C10167347 · Firearm licence'),
    ).toBeInTheDocument();
  });

  it('renders the journey it was given', () => {
    renderSheet();
    expect(screen.getByText('The usual path')).toBeInTheDocument();
  });

  it('⚠️ SAYS IN WORDS WHAT DRAGGING THE STRIP WILL DO', () => {
    // A grey pill with no label is a guess: half the people who see one try
    // to scroll the page with it.
    renderSheet();
    expect(screen.getByText('Drag down to close')).toBeInTheDocument();
  });
});

describe('the ways out', () => {
  it('closes on Escape', () => {
    const onClose = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the × in the corner', () => {
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close the history' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a tap on the backdrop', () => {
    const onClose = renderSheet();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on a tap inside the panel', () => {
    // The backdrop handler fires on the way up from every element inside it;
    // without the target check, reading the journey would dismiss it.
    const onClose = renderSheet();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the drag', () => {
  it('⚠️ SPRINGS BACK ON A SMALL DRAG, AND DOES NOT CLOSE', () => {
    // The failure this threshold exists for: a member scrolling with a
    // thumb that twitches, and losing the history they were reading.
    const onClose = renderSheet();
    drag(100, 150);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').style.transform).toBe('translateY(0px)');
  });

  it('closes once the drag passes the threshold', () => {
    const onClose = renderSheet();
    drag(100, 300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('follows the finger while it is down', () => {
    const onClose = renderSheet();
    fireEvent.pointerDown(banner(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(banner(), { clientY: 160, pointerId: 1 });
    expect(screen.getByRole('dialog').style.transform).toBe(
      'translateY(60px)',
    );
    fireEvent.pointerUp(banner(), { clientY: 160, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⚠️ IGNORES AN UPWARD DRAG RATHER THAN LIFTING THE PANEL', () => {
    // Dragging up must do nothing at all — a sheet that rises off the top of
    // its own backdrop reads as broken, not as interactive.
    const onClose = renderSheet();
    fireEvent.pointerDown(banner(), { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(banner(), { clientY: 120, pointerId: 1 });
    expect(screen.getByRole('dialog').style.transform).toBe('translateY(0px)');
    fireEvent.pointerUp(banner(), { clientY: 120, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⚠️ DOES NOT TREAT A DRAG THAT STARTED ON THE × AS A DRAG', () => {
    // Otherwise the press and the drag both land, and the sheet closes on the
    // way to closing.
    const onClose = renderSheet();
    const close = screen.getByRole('button', { name: 'Close the history' });
    fireEvent.pointerDown(close, { clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(banner(), { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(banner(), { clientY: 400, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⚠️ NO TRANSITION WHILE A FINGER IS DOWN', () => {
    // A transitioned transform lags the drag by the length of the animation,
    // which reads as the panel fighting the thumb.
    const onClose = renderSheet();
    fireEvent.pointerDown(banner(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(banner(), { clientY: 140, pointerId: 1 });
    expect(screen.getByRole('dialog').style.transition).toBe('none');
    fireEvent.pointerUp(banner(), { clientY: 140, pointerId: 1 });
    expect(screen.getByRole('dialog').style.transition).toContain('200ms');
    expect(onClose).not.toHaveBeenCalled();
  });
});
