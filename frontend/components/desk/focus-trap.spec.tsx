// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DialogFrame, Drawer } from './overlays';

/**
 * ⚠️ THE BUG THIS FILE EXISTS FOR MADE THE DEALER FORM UNUSABLE.
 *
 * `DialogFrame`'s focus effect had a dep list of `[onClose]`, and every call
 * site passes an inline arrow — `people/page.tsx` passes
 * `() => { if (!busy) onClose(); }`. So the handler's identity changed on
 * every render, the form re-rendered on every keystroke, and the effect
 * re-ran: cleanup restored focus, setup focused the panel's FIRST focusable
 * element. Typing one character into Suburb threw the cursor to Dealer name.
 *
 * `Drawer` had the same shape with `[open, onClose]`. It self-healed only
 * where the first focusable happened to be the field being typed into.
 *
 * The test therefore types into the SECOND field and asserts the cursor did
 * not move. Asserting "focus works on open" would have passed throughout the
 * entire life of the bug.
 */

/** A parent that re-renders on every keystroke, as the real dialogs do. */
function Harness({
  kind,
  onClose,
}: {
  kind: 'dialog' | 'drawer';
  onClose?: () => void;
}) {
  const [value, setValue] = React.useState('');
  // ⚠️ Inline arrow, deliberately — recreating the exact call-site shape.
  const close = () => onClose?.();
  const body = (
    <>
      <input data-testid="first" placeholder="Dealer name" />
      <input
        data-testid="second"
        placeholder="Suburb"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={close}>Cancel</button>
    </>
  );
  return kind === 'dialog' ? (
    <DialogFrame
      onClose={close}
      label="DEALER"
      title="Dealer"
      footer={<button onClick={close}>Save</button>}
    >
      {body}
    </DialogFrame>
  ) : (
    <Drawer open onClose={close} typeLabel="DEALER" title="Dealer">
      {body}
    </Drawer>
  );
}

describe.each(['dialog', 'drawer'] as const)('%s focus trap', (kind) => {
  it('does not steal focus while typing into a later field', () => {
    render(<Harness kind={kind} />);
    const second = screen.getByTestId('second') as HTMLInputElement;

    second.focus();
    expect(document.activeElement).toBe(second);

    for (const ch of 'Parkhurst') {
      fireEvent.change(second, { target: { value: second.value + ch } });
      // The assertion, on EVERY keystroke — the old code moved it on the first.
      expect(document.activeElement).toBe(second);
    }
    expect(second.value).toBe('Parkhurst');
  });

  it('still moves focus into the panel when it opens', () => {
    // The fix must not trade the bug for a dialog that focuses nothing.
    //
    // Asserted as "inside the panel", not "the first input": both overlays
    // render a close control in their header, so the first focusable in DOM
    // order is that button. Pinning the exact element would make this spec
    // fail the day someone adds a header action — which is a layout change,
    // not a focus regression.
    render(<Harness kind={kind} />);
    // Drawer is role="dialog"; DialogFrame is role="alertdialog", because it
    // guards the irreversible actions and the distinction is the point.
    const panel = document.querySelector(
      '[role="dialog"], [role="alertdialog"]',
    );
    expect(panel).toBeTruthy();
    expect(document.activeElement).not.toBe(document.body);
    expect(panel!.contains(document.activeElement)).toBe(true);
  });

  it('still closes on Escape, using the LATEST handler', () => {
    // A handler read from a ref must not go stale — that is the failure mode
    // a ref introduces, and it is the one worth asserting.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness kind={kind} onClose={first} />);
    rerender(<Harness kind={kind} onClose={second} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('restores focus to what had it before, on unmount', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const { unmount } = render(<Harness kind={kind} />);
    expect(document.activeElement).not.toBe(outside);

    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe('Drawer open/closed', () => {
  it('renders nothing when closed, and mounts nothing to trap', () => {
    // `open` is the wrapper's whole job now — it must not reach the body and
    // find its way back into a dep list.
    const { container } = render(
      <Drawer open={false} onClose={() => {}} typeLabel="X" title="X">
        <input data-testid="first" />
      </Drawer>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByTestId('first')).toBeNull();
  });
});
