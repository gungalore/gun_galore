'use client';

import { useEffect, useRef } from 'react';

// Sparkie — the Ask GG mascot (operator pick 2026-07-12): the GG spark
// given a face. Idle life (blink / glance / bob) is pure CSS via the
// `gg-sparkie-*` rules in globals.css; JS only fires rare one-shot
// "moments" (wiggle / pop) when `alive` is set — the launcher's FAB.
// The panel drives `mood` instead: 'think' while a reply streams,
// 'happy' for a beat when the answer lands.
//
// All motion uses the individual transform properties
// (translate / rotate / scale) so bob + wiggle + blink compose instead
// of overriding each other, and every animation sits behind
// prefers-reduced-motion: no-preference (reduced motion = a still face).
//
// ALWAYS-LOADED when imported by the launcher — keep this file tiny and
// dependency-free (react only).

export type SparkieMood = 'idle' | 'think' | 'happy';

const MOMENTS = [
  'gg-sparkie-wiggle',
  'gg-sparkie-pop',
  'gg-sparkie-peek',
] as const;

// Cursor proximity inside which Sparkie's eyes track the pointer (px).
const TRACK_RADIUS = 340;
// Max pupil offset while tracking (SVG units ≈ px at 32 viewBox).
const TRACK_MAX = 1.6;

export function AskGgMascot({
  size = 24,
  mood = 'idle',
  alive = false,
}: {
  size?: number;
  mood?: SparkieMood;
  alive?: boolean;
}) {
  const ref = useRef<SVGSVGElement | null>(null);

  // Rare one-shot moments: an early hello wiggle ~2.5s after mount,
  // then one every 20-45s. Skipped entirely under reduced motion and
  // while the tab is hidden (the chain keeps ticking, cheap).
  useEffect(() => {
    if (!alive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: number;
    let unclass: number;
    const fire = () => {
      const el = ref.current;
      if (el && !document.hidden) {
        const cls = MOMENTS[Math.floor(Math.random() * MOMENTS.length)];
        el.classList.add(cls);
        unclass = window.setTimeout(() => el.classList.remove(cls), 1000);
      }
      timer = window.setTimeout(fire, 20_000 + Math.random() * 25_000);
    };
    timer = window.setTimeout(fire, 2500);
    return () => {
      clearTimeout(timer);
      clearTimeout(unclass);
    };
  }, [alive]);

  // Eyes follow the cursor when it comes near (W5.5 "more alive").
  // Pointer devices only, reduced-motion off. rAF-gated mousemove: the
  // pupils' translate is driven by CSS vars set directly on the svg —
  // zero React re-renders. Beyond the radius the idle glance resumes.
  useEffect(() => {
    if (!alive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = lastX - cx;
        const dy = lastY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < TRACK_RADIUS && dist > 1) {
          const pull = Math.min(1, dist / 80) * TRACK_MAX;
          el.classList.add('gg-sparkie-track');
          el.style.setProperty('--sx', `${((dx / dist) * pull).toFixed(2)}px`);
          el.style.setProperty('--sy', `${((dy / dist) * pull).toFixed(2)}px`);
        } else {
          el.classList.remove('gg-sparkie-track');
        }
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      ref.current?.classList.remove('gg-sparkie-track');
    };
  }, [alive]);

  return (
    <svg
      ref={ref}
      className={mood === 'idle' ? undefined : `gg-sparkie--${mood}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <g className="gg-sparkie">
        {/* Body — the GG four-point spark */}
        <path
          d="M16 2.5 C17.6 9.8 22.2 14.4 29.5 16 C22.2 17.6 17.6 22.2 16 29.5 C14.4 22.2 9.8 17.6 2.5 16 C9.8 14.4 14.4 9.8 16 2.5 Z"
          fill="currentColor"
        />
        {/* Eyes (blink squashes the group) → pupils (glance slides them) */}
        <g className="gg-sparkie-eyes">
          <g className="gg-sparkie-pupils">
            <circle cx="12.7" cy="14.6" r="1.9" fill="#151515" />
            <circle cx="19.3" cy="14.6" r="1.9" fill="#151515" />
            <circle cx="13.3" cy="14" r="0.55" fill="#fff" />
            <circle cx="19.9" cy="14" r="0.55" fill="#fff" />
          </g>
        </g>
        {/* Smile — the big one only shows in --happy */}
        <path
          className="gg-sparkie-smile"
          d="M13.4 19.2 Q16 21.4 18.6 19.2"
          stroke="#151515"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          className="gg-sparkie-smile-big"
          d="M12.7 18.9 Q16 22.6 19.3 18.9"
          stroke="#151515"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
