'use client';

/**
 * THE DESK — the undo engine.
 *
 * The mechanic the whole pile rests on: a non-money action applies instantly
 * in the UI, the card leaves, and NOTHING IS SENT for ten seconds. Undo is
 * therefore free and instant — there is no server state to roll back, because
 * the server has not been told yet.
 *
 * ⚠️ THIS IS A CLIENT DELAY, NOT A SERVER ROLLBACK, AND THAT IS WHY IT MUST
 * NEVER WRAP A MONEY ACTION. A refund that "undoes" would have to be a second
 * transfer, and a payout that has left cannot be recalled at all. Money uses
 * the confirm dialog instead, and the dialog says so in words.
 *
 * ⚠️ ONE PENDING ACTION AT A TIME. If the operator approves a second listing
 * while the first is still counting, the first COMMITS IMMEDIATELY rather
 * than being dropped or queued. Two live countdowns would mean two cards in
 * an ambiguous state and an Undo button that no longer says what it undoes.
 */
import * as React from 'react';

export const UNDO_SECONDS = 10;

export interface UndoableAction {
  /** The card this hides while the window runs. */
  cardId: string;
  /** Toast copy — "Approved UM000598". Past tense: it already happened. */
  message: string;
  /**
   * Fires when the window closes. Anything thrown here surfaces to onError;
   * the card does NOT come back, because by then the operator has moved on
   * and a card reappearing minutes later is worse than a reported failure.
   */
  commit: () => Promise<unknown>;
  /**
   * How to commit this action from a page that is being torn down.
   *
   * ⚠️ fetch() DOES NOT SURVIVE A CLOSING TAB. A normal request is cancelled
   * when the document goes away, so without this an operator who approves a
   * listing and immediately closes the tab silently loses the approval — the
   * card is gone from their screen and untouched on the server. sendBeacon is
   * the only transport the browser promises to deliver during unload.
   */
  beacon?: { url: string; body: string };
}

export interface UndoState {
  /** The action currently counting down, if any. */
  pending: UndoableAction | null;
  /** Seconds left on the ring. */
  seconds: number;
  /** Start an action: applies optimistically and begins the countdown. */
  run: (action: UndoableAction) => void;
  /** Cancel the pending action and put its card back. */
  undo: () => void;
  /** True while this card is hidden by a pending action. */
  isPending: (cardId: string) => boolean;
}

export function useUndo(options: { onError?: (err: unknown, action: UndoableAction) => void } = {}): UndoState {
  const { onError } = options;
  const [pending, setPending] = React.useState<UndoableAction | null>(null);
  const [seconds, setSeconds] = React.useState(UNDO_SECONDS);

  // The live action in a ref as well as state: the unload handler and the
  // "commit the previous one" path both need to read it synchronously, and a
  // stale closure over state would commit the wrong thing.
  const pendingRef = React.useRef<UndoableAction | null>(null);
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  const commitNow = React.useCallback(() => {
    const action = pendingRef.current;
    if (!action) return;
    pendingRef.current = null;
    setPending(null);
    void action.commit().catch((err) => onErrorRef.current?.(err, action));
  }, []);

  const run = React.useCallback(
    (action: UndoableAction) => {
      // A second action ends the first one's window immediately. See the note
      // at the top: never two countdowns.
      commitNow();
      pendingRef.current = action;
      setPending(action);
      setSeconds(UNDO_SECONDS);
    },
    [commitNow],
  );

  const undo = React.useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  // The countdown. Runs only while something is pending, so an idle Desk is
  // not ticking a timer for nothing.
  React.useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          commitNow();
          return UNDO_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [pending, commitNow]);

  // Leaving the page closes the window early rather than losing the action.
  // pagehide fires on tab close, navigation and bfcache eviction alike;
  // visibilitychange alone misses a straight close on some browsers.
  React.useEffect(() => {
    function flush() {
      const action = pendingRef.current;
      if (!action) return;
      pendingRef.current = null;
      if (action.beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(
          action.beacon.url,
          new Blob([action.beacon.body], { type: 'application/json' }),
        );
      } else {
        // No beacon supplied: try anyway. On a real unload this may not
        // arrive, which is exactly why beacon exists on the action.
        void action.commit().catch(() => undefined);
      }
    }
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      // Unmounting the Desk (a tab change inside the app) is a navigation
      // too — commit rather than silently dropping the action.
      flush();
    };
  }, []);

  const isPending = React.useCallback((cardId: string) => pendingRef.current?.cardId === cardId, []);

  return { pending, seconds, run, undo, isPending };
}
