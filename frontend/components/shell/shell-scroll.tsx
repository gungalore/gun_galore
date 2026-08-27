'use client';

// Who is actually scrolling?
//
// Until the app shell existed there was one answer everywhere: the document.
// Now there are two, and which one is live depends on the display mode rather
// than on anything a component can see locally:
//
//   mobile web / desktop — the document scrolls, exactly as before. The shell
//                          wrapper is `display: contents`, so it is not even a
//                          box, let alone a scroll container.
//   installed PWA        — the shell is a locked 100dvh flex column and the
//                          middle pane scrolls. `window.scrollY` never moves
//                          again for as long as the app is open.
//
// Anything that reads or writes scroll position, or freezes it behind a modal,
// has to ask which one it is talking to. Getting this wrong is silent in both
// directions: a scroll lock that locks the wrong element does nothing at all
// and the page keeps scrolling under the sheet, while a `window.scrollTo(0,0)`
// in the installed app simply does not move.
//
// ⚠️ RESOLVED AT CALL TIME, NOT AT MOUNT. The pane element exists in the DOM in
// every mode — only its CSS differs — and `data-standalone` is set pre-paint
// but can flip afterwards when the user installs or switches window modes.
// Asking the live computed style is the only answer that stays correct; caching
// the decision in state gives you a stale scroller after a mode change.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

type PaneRef = RefObject<HTMLElement | null> | null;

const ShellScrollContext = createContext<PaneRef>(null);

export function ShellScrollProvider({
  paneRef,
  children,
}: {
  paneRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <ShellScrollContext.Provider value={paneRef}>
      {children}
    </ShellScrollContext.Provider>
  );
}

/** True when this element is a live vertical scroll container. */
function isScroller(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const o = getComputedStyle(el).overflowY;
  return o === 'auto' || o === 'scroll';
}

/**
 * The element that actually scrolls this page: the shell pane in the installed
 * app, `window` everywhere else. Returns a getter rather than a value because
 * the answer depends on live computed style — see the note above.
 */
export function useShellScroller(): () => Window | HTMLElement {
  const paneRef = useContext(ShellScrollContext);
  // A ref, so the returned getter is stable across renders and safe to put in
  // an effect's dependency array without re-running it every render.
  const ref = useRef(paneRef);
  ref.current = paneRef;

  return useCallback(() => {
    const el = ref.current?.current ?? null;
    return isScroller(el) ? el : window;
  }, []);
}

/**
 * Scroll the live scroller to the top. The one-liner that replaces
 * `window.scrollTo({ top: 0 })` at every call site that needs to work in the
 * installed app too.
 */
export function useScrollToTop(): (behavior?: ScrollBehavior) => void {
  const getScroller = useShellScroller();
  return useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const s = getScroller();
      s.scrollTo({ top: 0, behavior });
    },
    [getScroller],
  );
}

/** Current scroll offset of the live scroller. */
export function useScrollOffset(): () => number {
  const getScroller = useShellScroller();
  return useCallback(() => {
    const s = getScroller();
    return s === window ? window.scrollY : (s as HTMLElement).scrollTop;
  }, [getScroller]);
}

export type { PaneRef };
