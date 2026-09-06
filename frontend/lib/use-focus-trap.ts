'use client';

import { useEffect, useRef } from 'react';

// ────────────────────────────────────────────────────────────────────
// KEEPING THE KEYBOARD INSIDE A DIALOG.
//
// Every `role="dialog" aria-modal="true"` on this site was a lie until this
// existed: the markup told a screen reader nothing outside mattered, and Tab
// walked straight out of the overlay into the page behind it — where the
// member could operate a delete button they could not see, on a document the
// dialog in front of them was asking about. Escape did nothing, and the page
// behind scrolled under the fingers of anybody trying to scroll the dialog.
//
// ⚠️ IT IS A PLAIN DOM FUNCTION WITH A HOOK AROUND IT, deliberately. The three
// things that go wrong here — the tab cycle, the restore, the scroll lock —
// are all DOM, and a React-only implementation could only be tested by
// rendering a component. `createFocusTrap` takes an element and returns a
// release function, so the spec drives it with two divs and no renderer.
//
// ⚠️ AND TRAPS NEST. The Document Centre's review screen opens a bottom sheet
// INSIDE its own overlay, so two traps are live at once; without the stack
// below, Escape would close both and Tab would be handled twice. Only the
// most recently activated trap listens.
// ────────────────────────────────────────────────────────────────────

export interface FocusTrapOptions {
  /** Escape, and a click on nothing, mean the same thing: put this away. */
  onClose?: () => void;
  /**
   * Stop the page behind scrolling while this is open. On by default — a
   * dialog whose backdrop scrolls is the commonest complaint about one.
   */
  lockScroll?: boolean;
  /** Where focus should land. Defaults to the first focusable inside. */
  initialFocus?: HTMLElement | null;
}

interface ActiveTrap {
  container: HTMLElement;
  onClose?: () => void;
}

/**
 * Live traps, innermost last.
 *
 * ⚠️ ONE LISTENER PER TRAP, GATED ON BEING TOP OF THE STACK, rather than one
 * shared listener. A trap that is torn down mid-keystroke must take its own
 * handler with it; a shared one would outlive it.
 */
const stack: ActiveTrap[] = [];

/** How many live traps asked for the scroll lock. */
let lockDepth = 0;
let restoreOverflow: string | null = null;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(',');

/**
 * Everything inside `root` a Tab can reach, in document order.
 *
 * ⚠️ NO VISIBILITY TEST. `offsetParent` and `getClientRects` are both always
 * empty under jsdom, so a filter written on either passes locally and returns
 * nothing in the spec — which is worse than a trap that occasionally includes
 * a hidden button. `hidden`, `aria-hidden` and a negative tabindex are all
 * readable from the markup and are what actually gets used here.
 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('hidden') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.getAttribute('tabindex') !== '-1' &&
      !el.closest('[hidden]'),
  );
}

/**
 * Trap the keyboard inside `container` until the returned function is called.
 *
 * Restores focus to whatever had it when the trap opened, provided that
 * element is still on the page — a dialog that returns focus to the body
 * dumps a keyboard user back at the top of a 3,000-line page.
 */
export function createFocusTrap(
  container: HTMLElement,
  opts: FocusTrapOptions = {},
): () => void {
  const { onClose, lockScroll = true, initialFocus } = opts;
  const doc = container.ownerDocument;
  const previouslyFocused = doc.activeElement as HTMLElement | null;

  const entry: ActiveTrap = { container, onClose };
  stack.push(entry);

  if (lockScroll) {
    if (lockDepth === 0) {
      restoreOverflow = doc.body.style.overflow;
      doc.body.style.overflow = 'hidden';
    }
    lockDepth += 1;
  }

  // Land somewhere inside, so the first Tab does not start from the page.
  const first = initialFocus ?? focusableWithin(container)[0] ?? container;
  if (!container.contains(doc.activeElement)) first.focus?.();

  function onKeyDown(e: KeyboardEvent) {
    // Only the innermost trap answers. See the note on the stack.
    if (stack[stack.length - 1] !== entry) return;

    if (e.key === 'Escape') {
      if (!onClose) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const items = focusableWithin(container);
    if (!items.length) {
      // Nothing to move to, but Tab must still not leave.
      e.preventDefault();
      return;
    }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    const active = doc.activeElement as HTMLElement | null;

    // Focus outside the container at all — a click on the page behind, or a
    // control that has just been removed — is pulled back to the edge.
    if (!active || !container.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? lastItem : firstItem).focus();
      return;
    }
    if (e.shiftKey && active === firstItem) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && active === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  }

  doc.addEventListener('keydown', onKeyDown, true);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    doc.removeEventListener('keydown', onKeyDown, true);
    const at = stack.indexOf(entry);
    if (at !== -1) stack.splice(at, 1);

    if (lockScroll) {
      lockDepth = Math.max(0, lockDepth - 1);
      if (lockDepth === 0) {
        doc.body.style.overflow = restoreOverflow ?? '';
        restoreOverflow = null;
      }
    }

    if (previouslyFocused && doc.contains(previouslyFocused)) {
      previouslyFocused.focus?.();
    }
  };
}

/**
 * The same thing as a ref to hang on a dialog.
 *
 * ```tsx
 * const ref = useFocusTrap<HTMLDivElement>({ onClose: () => setOpen(false) });
 * return <div ref={ref} role="dialog" aria-modal="true">…</div>;
 * ```
 *
 * `active` defaults to true, so a dialog that is only rendered while open
 * needs no flag at all.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  opts: FocusTrapOptions & { active?: boolean } = {},
) {
  const ref = useRef<T | null>(null);
  const { active = true, lockScroll = true, initialFocus } = opts;
  // ⚠️ THROUGH A REF, so a handler recreated on every render — which is every
  // inline arrow function in this codebase — does not tear the trap down and
  // rebuild it, stealing focus back to the top of the dialog each time.
  const onCloseRef = useRef(opts.onClose);
  onCloseRef.current = opts.onClose;

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    return createFocusTrap(el, {
      lockScroll,
      initialFocus,
      onClose: () => onCloseRef.current?.(),
    });
    // `initialFocus` is read once at open, deliberately: re-running on a new
    // element identity would re-open the trap and yank focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lockScroll]);

  return ref;
}
