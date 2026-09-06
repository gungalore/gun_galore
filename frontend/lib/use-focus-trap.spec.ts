// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFocusTrap, focusableWithin } from './use-focus-trap';

// ────────────────────────────────────────────────────────────────────
// The keyboard half of a dialog. Every assertion here was a real hole in the
// Document Centre's review overlay: Tab walked out of it into the page behind,
// Escape did nothing, and the list under it scrolled while the dialog was up.
// ────────────────────────────────────────────────────────────────────

function scene() {
  document.body.innerHTML = `
    <button id="outside">Behind the dialog</button>
    <div id="dialog" role="dialog" aria-modal="true">
      <button id="a">First</button>
      <input id="b" />
      <button id="c" disabled>Cannot be reached</button>
      <button id="d">Last</button>
    </div>
  `;
  return {
    dialog: document.getElementById('dialog') as HTMLElement,
    outside: document.getElementById('outside') as HTMLButtonElement,
    a: document.getElementById('a') as HTMLButtonElement,
    b: document.getElementById('b') as HTMLInputElement,
    d: document.getElementById('d') as HTMLButtonElement,
  };
}

function tab(shift = false) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function escape() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('what a Tab can reach', () => {
  it('skips disabled controls and anything tabindex="-1"', () => {
    const { dialog } = scene();
    dialog.insertAdjacentHTML('beforeend', '<a href="#x" tabindex="-1">skip</a>');
    expect(focusableWithin(dialog).map((el) => el.id)).toEqual(['a', 'b', 'd']);
  });
});

describe('a focus trap', () => {
  it('focuses the first control inside when it opens', () => {
    const { dialog, a } = scene();
    const release = createFocusTrap(dialog);
    expect(document.activeElement).toBe(a);
    release();
  });

  it('wraps forward off the last control and back off the first', () => {
    const { dialog, a, d } = scene();
    const release = createFocusTrap(dialog);

    d.focus();
    tab();
    expect(document.activeElement).toBe(a);

    tab(true);
    expect(document.activeElement).toBe(d);
    release();
  });

  it('⚠️ pulls focus back when it has escaped to the page behind', () => {
    // The hole this exists for: aria-modal said nothing outside mattered
    // while Tab walked into a Delete button the member could not see.
    const { dialog, outside, a } = scene();
    const release = createFocusTrap(dialog);
    outside.focus();
    tab();
    expect(document.activeElement).toBe(a);
    release();
  });

  it('calls onClose on Escape, and only when one was given', () => {
    const { dialog } = scene();
    const onClose = vi.fn();
    const release = createFocusTrap(dialog, { onClose });
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
    release();

    const silent = createFocusTrap(dialog);
    escape(); // must not throw
    silent();
  });

  it('restores focus to whatever had it before', () => {
    const { dialog, outside } = scene();
    outside.focus();
    const release = createFocusTrap(dialog);
    expect(document.activeElement).not.toBe(outside);
    release();
    expect(document.activeElement).toBe(outside);
  });

  it('locks the page behind, and unlocks it only when the last trap goes', () => {
    const { dialog } = scene();
    const outer = createFocusTrap(dialog);
    expect(document.body.style.overflow).toBe('hidden');
    const inner = createFocusTrap(dialog);
    inner();
    expect(document.body.style.overflow).toBe('hidden');
    outer();
    expect(document.body.style.overflow).toBe('');
  });

  it('leaves the page alone when the caller opts out of the lock', () => {
    const { dialog } = scene();
    const release = createFocusTrap(dialog, { lockScroll: false });
    expect(document.body.style.overflow).toBe('');
    release();
  });
});

describe('a sheet opened inside a dialog', () => {
  it('⚠️ answers Escape once, innermost only', () => {
    // The review screen opens a bottom sheet inside its own overlay. Without
    // the stack both traps would answer, and one Escape would shut both.
    const { dialog } = scene();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="sheet"><button id="s1">Pick</button></div>',
    );
    const sheet = document.getElementById('sheet') as HTMLElement;
    const s1 = document.getElementById('s1') as HTMLButtonElement;

    const onOuter = vi.fn();
    const onInner = vi.fn();
    const releaseOuter = createFocusTrap(dialog, { onClose: onOuter });
    const releaseInner = createFocusTrap(sheet, { onClose: onInner });

    escape();
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();

    // Tab is the sheet's too, while it is up.
    s1.focus();
    tab();
    expect(document.activeElement).toBe(s1);

    releaseInner();
    escape();
    expect(onOuter).toHaveBeenCalledTimes(1);
    releaseOuter();
  });
});
