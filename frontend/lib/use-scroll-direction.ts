'use client';

// useScrollDirection — returns 'up' or 'down' based on the most
// recent scroll movement. Used by the bottom tab bar + sticky featured
// strip to auto-hide when the user is scrolling down (more reading
// room) and re-appear when they scroll back up (to act).
//
// Behaviour:
//   * Returns 'up' near the top of the page (Y < 80) so chrome is
//     always visible on the landing screen — hiding it before the
//     user has scrolled feels broken.
//   * Ignores micro-scrolls (Δ < 10px) so the hide/show doesn't
//     flicker when the user is just touching the screen.
//   * Throttles to one update per animation frame via rAF so we
//     don't thrash React on every scroll event.

import { useEffect, useState } from 'react';

export function useScrollDirection(): 'up' | 'down' {
  const [direction, setDirection] = useState<'up' | 'down'>('up');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastY = window.scrollY;
    let ticking = false;

    function update() {
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) < 10) {
        ticking = false;
        return;
      }
      // Always show chrome near the top of the page.
      if (y < 80) {
        setDirection('up');
      } else {
        setDirection(delta > 0 ? 'down' : 'up');
      }
      lastY = y;
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return direction;
}
