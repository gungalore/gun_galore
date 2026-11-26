'use client';

// 1-Hz countdown hook. Returns the milliseconds-remaining until the
// given endTime, ticking every second. Returns 0 once the target is
// in the past. SSR-safe — initial render computes once from the
// passed-in endTime (the server snapshot), then the client tick
// kicks in.
//
// Used on listing-card AuctionTimeChip + featured-rail + sticky
// strip to give a live "Ends in 1h 27m 42s" indicator instead of
// the static server-snapshot value that goes stale on long pages.
//
// Implementation notes:
//   - Single setInterval per hook instance. The cost of 1 timer per
//     card is negligible (5-25 cards on a grid).
//   - We don't synchronise the tick across cards. Tiny visual jitter
//     between cards is fine and the alternative (a shared store +
//     subscriptions) is overkill for this read pattern.
//   - When the target passes, we keep returning 0 and the consumer
//     hides the chip — no re-render storm.

import { useEffect, useState } from 'react';

function msLeft(
  endTime: string | Date | null | undefined,
  clockOffsetMs = 0,
): number {
  if (!endTime) return 0;
  const end =
    typeof endTime === 'string' ? new Date(endTime).getTime() : endTime.getTime();
  // clockOffsetMs is (device clock − server clock). The remaining time against
  // the SERVER clock is end − (now − offset), i.e. end − now + offset. An
  // offset of 0 (every caller that does not pass one) is the old behaviour.
  const left = end - Date.now() + clockOffsetMs;
  return left > 0 ? left : 0;
}

export function useCountdown(
  endTime: string | Date | null | undefined,
  /**
   * Optional server-clock correction: (device clock − server clock) in ms.
   * Passed by the auction odometer so a mis-set device clock cannot show the
   * wrong remaining time on a live auction (audit L14).
   */
  clockOffsetMs = 0,
): number {
  const [ms, setMs] = useState(() => msLeft(endTime, clockOffsetMs));

  useEffect(() => {
    // Recompute on endTime change (snipe protection can push it back) and when
    // the measured server offset changes.
    setMs(msLeft(endTime, clockOffsetMs));
    if (!endTime) return;
    const t = window.setInterval(() => {
      const left = msLeft(endTime, clockOffsetMs);
      setMs(left);
      if (left <= 0) {
        // Auto-stop once the target passes — no point ticking forever.
        window.clearInterval(t);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [endTime, clockOffsetMs]);

  return ms;
}

/** Format a "Ends in 2d / 3h 14m / 47s" label appropriate for the
 * given milliseconds-left value. Mirrors the existing AuctionTimeChip
 * formatting so the live-tick version reads the same as the previous
 * static version. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Ended';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days}d`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  if (minutes >= 1) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
