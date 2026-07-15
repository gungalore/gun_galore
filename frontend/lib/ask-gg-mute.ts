import { useEffect, useState } from 'react';

// GG mute switch — the operator asked for "a clear way to shut him up".
// PERMANENT until unmuted (localStorage), so it survives reloads and new
// sessions. When muted, GG stops all PROACTIVE speech (greeting, contextual
// coaching) but stays fully tappable — he's silenced, not removed.
//
// React-only + tiny, so the always-loaded launcher may import it (bundle rule).

const MUTE_KEY = 'gg_muted';
// Fired on toggle so every mounted GG surface (launcher button, panel toggle)
// re-reads the flag without a page reload.
const MUTE_EVENT = 'gg:mute-changed';

export function isGgMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGgMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, '1');
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    /* private mode / quota — mute just won't persist */
  }
  try {
    window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: muted }));
  } catch {
    /* ignore */
  }
}

/**
 * Reactive mute state + setter. Re-renders on toggle (same tab via the
 * custom event) and cross-tab (via the storage event).
 */
export function useGgMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(isGgMuted());
    const sync = () => setMuted(isGgMuted());
    window.addEventListener(MUTE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MUTE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const set = (m: boolean) => {
    setGgMuted(m);
    setMuted(m);
  };

  return [muted, set];
}
