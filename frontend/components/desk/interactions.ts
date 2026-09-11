'use client';

/**
 * THE DESK — how the operator drives the pile: keyboard at the desk, thumb on
 * the phone.
 *
 * Both exist for the same reason. Clearing a morning's moderation is forty
 * decisions, and forty round trips between a card and a mouse is what makes
 * an admin panel feel like work. J, K, A. Or swipe, swipe, swipe.
 */
import * as React from 'react';

/* ────────────────────────────────────────────────────────────────────────
 * Keyboard
 * ──────────────────────────────────────────────────────────────────────── */

export interface PileKeyHandlers {
  /** Move the cursor. */
  onMove: (delta: 1 | -1) => void;
  /** Enter — open the selected card's drawer. */
  onOpen: () => void;
  /** A — fire the selected card's primary action. */
  onPrimary: () => void;
  /** L — sink the selected card. */
  onLater: () => void;
  /** Ctrl/Cmd K — the search palette. */
  onSearch: () => void;
  /** Escape — close whatever is open. */
  onEscape: () => void;
  /**
   * True while a drawer, dialog or the palette is open.
   *
   * ⚠️ EVERY SHORTCUT EXCEPT ESCAPE IS SUSPENDED WHILE AN OVERLAY IS OPEN.
   * Otherwise "A" typed into a rejection note fires the primary action on the
   * card behind the dialog — which, on a firearm transfer, releases money.
   *
   * ⚠️ THIS FLAG IS A HINT, NOT THE WHOLE ANSWER — see anOverlayIsOpen(). A
   * board can only report the overlays IT owns, and not every overlay belongs
   * to a board.
   */
  overlayOpen?: boolean;
}

/**
 * Is ANY Desk overlay on screen, whoever opened it?
 *
 * 🚨 THE BOARD-LOCAL FLAG WAS NOT ENOUGH, AND THE GAP WAS THE DANGEROUS KIND.
 * The pile passes `overlayOpen: stack.length > 0` — its own drawer stack — but
 * DeskShell mounts drawers of its own (Account, Services) that the stack knows
 * nothing about. Drawer focuses its panel's first focusable element on mount,
 * which is the header's Close button, and isTyping() returns false for a
 * BUTTON — so with the Account drawer open, a stray "a" fell straight through
 * to the pile's primary action on the card behind it. On a firearm transfer
 * that releases money, and the drawer this shipped alongside is the one that
 * displays the ten recovery codes.
 *
 * Asking the DOM cannot go stale the way a prop can: a new shell-level overlay
 * inherits the suspension by wearing the class every overlay already wears.
 * use-desk-search.ts has always gated the palette this way; this is the same
 * question asked in the same place.
 */
function anOverlayIsOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('.dk-drawer, .dk-dialog') !== null;
}

/** Fields where a keystroke is text, not a command. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
}

/**
 * Is the keystroke aimed at a control that Enter already activates?
 *
 * ⚠️ ENTER BELONGS TO WHATEVER HAS FOCUS, AND TAKING IT BREAKS THE CARD'S OWN
 * BUTTONS. This listener sits on `document`, so it also hears Enter pressed on
 * the Approve, Reject and Later buttons INSIDE a card — and `preventDefault()`
 * on the keydown cancels the button's activation before it happens. The result
 * was that Approve could not be pressed by keyboard at all (Space still worked,
 * Enter did nothing), and the swallowed press was re-routed to `onOpen` on the
 * card at the CURSOR, which is not necessarily the card the operator has
 * focused. Tabbing to the fourth card's Reject and pressing Enter opened the
 * first card's drawer.
 *
 * Only Enter is deferred. J, K, A and L are not activation keys for anything,
 * so a focused button has no claim on them.
 */
function isActivatable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.('button, a[href], summary, [role="button"], [role="link"]'));
}

export function usePileKeys({
  onMove,
  onOpen,
  onPrimary,
  onLater,
  onSearch,
  onEscape,
  overlayOpen = false,
}: PileKeyHandlers): void {
  // Handlers in a ref so the listener is attached once and never re-bound on
  // every render — re-binding a document-level listener each keystroke is how
  // a pile of forty cards starts dropping keys.
  const h = React.useRef({ onMove, onOpen, onPrimary, onLater, onSearch, onEscape, overlayOpen });
  h.current = { onMove, onOpen, onPrimary, onLater, onSearch, onEscape, overlayOpen };

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const c = h.current;

      // Escape is the one key that works everywhere, including inside an
      // overlay and inside a text field: it is how you get out.
      if (e.key === 'Escape') {
        c.onEscape();
        return;
      }

      // Ctrl/Cmd K opens search from anywhere except an overlay — the
      // browser's own find-in-page is Ctrl F, so this does not collide.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        if (c.overlayOpen || anOverlayIsOpen()) return;
        e.preventDefault();
        c.onSearch();
        return;
      }

      if (c.overlayOpen || anOverlayIsOpen() || isTyping(e.target)) return;
      // A modifier means the operator is talking to the browser, not the pile.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault();
          c.onMove(1);
          break;
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault();
          c.onMove(-1);
          break;
        case 'Enter':
          // See isActivatable: a focused button keeps its own Enter.
          if (isActivatable(e.target)) return;
          e.preventDefault();
          c.onOpen();
          break;
        case 'a':
        case 'A':
          e.preventDefault();
          c.onPrimary();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          c.onLater();
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/* ────────────────────────────────────────────────────────────────────────
 * Swipe
 * ──────────────────────────────────────────────────────────────────────── */

/** Past this fraction of the card's width, releasing fires. */
export const SWIPE_FIRE_FRACTION = 0.4;

export interface SwipeState {
  /** Live horizontal offset in px. Bind to the card's transform. */
  dx: number;
  /** True while a finger is down — suppresses the transition. */
  dragging: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

/**
 * ⚠️ ONLY ON CARDS WHOSE PRIMARY ACTION IS UNDOABLE. A swipe is a gesture
 * made with a thumb while walking; it must never be the last thing standing
 * between a pocket and a released payment. Money is a deliberate confirm on
 * a screen the operator is looking at.
 */
export function useSwipe({
  onSwipeRight,
  onSwipeLeft,
  enabled = true,
}: {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  enabled?: boolean;
}): SwipeState {
  const [dx, setDx] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const start = React.useRef<{ x: number; y: number; w: number } | null>(null);
  // Set once per gesture: a vertical drag is the page scrolling, and stealing
  // it turns the pile into a surface you cannot scroll.
  const axis = React.useRef<'none' | 'x' | 'y'>('none');

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      const w = (e.currentTarget as HTMLElement).offsetWidth;
      start.current = { x: e.clientX, y: e.clientY, w };
      axis.current = 'none';
      setDragging(true);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!enabled || !s) return;
      const mx = e.clientX - s.x;
      const my = e.clientY - s.y;

      if (axis.current === 'none') {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (axis.current === 'x') {
          // Take the pointer so the browser stops trying to scroll with it.
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }
      }
      if (axis.current !== 'x') return;

      // No reveal in a direction with nothing behind it.
      if ((mx > 0 && !onSwipeRight) || (mx < 0 && !onSwipeLeft)) return;
      setDx(mx);
    },
    onPointerUp: () => {
      const s = start.current;
      start.current = null;
      setDragging(false);
      if (!s) return;
      const threshold = s.w * SWIPE_FIRE_FRACTION;
      if (dx > threshold) onSwipeRight?.();
      else if (dx < -threshold) onSwipeLeft?.();
      // Either way the card springs back; if the action fired, the card is
      // about to leave anyway and the spring is never seen.
      setDx(0);
    },
    onPointerCancel: () => {
      start.current = null;
      setDragging(false);
      setDx(0);
    },
  };

  return { dx, dragging, handlers };
}

/**
 * Desktop or phone. One breakpoint, matching tokens.css.
 *
 * 🚨 A LAST RESORT. REACH FOR `.dk-phone-only` / `.dk-desk-only`, OR A CUSTOM
 * PROPERTY WITH TWO MEDIA SCOPES, FIRST.
 *
 * This hook is `useState(false)` corrected inside an effect. It therefore
 * reports DESKTOP on the server and on the FIRST CLIENT RENDER — always, on
 * every cold load, on every board. So `phone ? A : B` does not choose between
 * A and B; it paints B, then repaints A a frame later. Thirteen branches did
 * that, and the drawer and the dialog held twelve of them: a phone opening an
 * order drawer got a 480px right-hand sheet with a 30px close X for one frame
 * before it snapped to a full-screen push with a 44px back chevron, and a
 * phone confirming a payout got a centred card that scaled in from the middle
 * of the screen before jumping to the bottom edge.
 *
 * A media query is correct in frame one and costs nothing. Use this ONLY for
 * the things CSS genuinely cannot express, and say which in a comment:
 *
 *   · an accessible NAME that differs by breakpoint (`aria-label` — see
 *     DrawerBody's close button, the last use of this hook in overlays.tsx);
 *   · a subtree that changes PARENT, or that fetches or holds state — CSS
 *     would have to render both copies and hide one, which doubles the
 *     fetches (see the rail in shell.tsx);
 *   · handlers bound only on one breakpoint, such as the swipe above.
 *
 * Anything that is purely a VALUE — a padding, a width, a size, an animation —
 * belongs in tokens.css, not here.
 */
export function useIsPhone(): boolean {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return phone;
}
