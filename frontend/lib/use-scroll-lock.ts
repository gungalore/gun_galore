'use client';

// One scroll lock, for whichever element is actually scrolling.
//
// ⚠️ THIS REPLACES FIFTEEN HAND-ROLLED COPIES OF `document.body.style.overflow
// = 'hidden'`, AND THEY WERE ALL ABOUT TO BREAK AT ONCE. In the installed app
// the shell pane owns the scroll and `body` never scrolls, so every one of
// those lines would have become a no-op — silently. Not a crash, not a warning:
// every sheet, drawer, lightbox and consent modal in the app would simply stop
// trapping the background, and the page would keep scrolling under the user's
// thumb while they were reading a modal. Among them are the SAP 534 document
// scanner and the vault consent modal, which are the two places where scrolling
// the page out from under someone matters most.
//
// Two further things the hand-rolled version got wrong, which are fixed here:
//
//   * NESTING. The old pattern restores `overflow` to '' on cleanup. Open a
//     sheet, open a modal from inside it, close the modal — the sheet's lock is
//     gone even though the sheet is still open. Locks are reference-counted per
//     element, so the background stays locked until the last holder releases.
//
//   * WHAT WAS THERE BEFORE. Restoring to '' assumes the element had no inline
//     overflow to begin with. Restoring the captured value is correct whether
//     it was empty or not.

import { useEffect } from 'react';
import { useShellScroller } from '@/components/shell/shell-scroll';

type LockState = { count: number; prevOverflow: string; prevOverscroll: string };

// Module-level so two components locking the same element share one count.
const locks = new WeakMap<HTMLElement, LockState>();
let documentLock: LockState | null = null;

function lockDocument(): void {
  if (documentLock) {
    documentLock.count += 1;
    return;
  }
  documentLock = {
    count: 1,
    prevOverflow: document.body.style.overflow,
    prevOverscroll: document.body.style.overscrollBehavior,
  };
  document.body.style.overflow = 'hidden';
  document.body.style.overscrollBehavior = 'contain';
}

function unlockDocument(): void {
  if (!documentLock) return;
  documentLock.count -= 1;
  if (documentLock.count > 0) return;
  document.body.style.overflow = documentLock.prevOverflow;
  document.body.style.overscrollBehavior = documentLock.prevOverscroll;
  documentLock = null;
}

function lockElement(el: HTMLElement): void {
  const existing = locks.get(el);
  if (existing) {
    existing.count += 1;
    return;
  }
  locks.set(el, {
    count: 1,
    prevOverflow: el.style.overflow,
    prevOverscroll: el.style.overscrollBehavior,
  });
  el.style.overflow = 'hidden';
  el.style.overscrollBehavior = 'contain';
}

function unlockElement(el: HTMLElement): void {
  const state = locks.get(el);
  if (!state) return;
  state.count -= 1;
  if (state.count > 0) return;
  el.style.overflow = state.prevOverflow;
  el.style.overscrollBehavior = state.prevOverscroll;
  locks.delete(el);
}

/**
 * Freeze the page behind an overlay while `locked` is true.
 *
 * Locks the shell pane in the installed app and the document everywhere else,
 * decided at effect time so it stays correct if the display mode changes.
 */
export function useScrollLock(locked: boolean): void {
  const getScroller = useShellScroller();

  useEffect(() => {
    if (!locked) return;

    // Captured once per lock so cleanup releases exactly what it took, even if
    // the shell's mode flips while the overlay is open.
    const scroller = getScroller();
    const el = scroller === window ? null : (scroller as HTMLElement);

    if (el) lockElement(el);
    else lockDocument();

    return () => {
      if (el) unlockElement(el);
      else unlockDocument();
    };
  }, [locked, getScroller]);
}
