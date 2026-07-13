'use client';

import { useEffect, useId, useRef } from 'react';

// Sparkie v2 — the Ask GG mascot (operator pick 2026-07-12, brought to
// life 2026-07-13): the GG spark turned into a little living ember with a
// real face and two working hands. A glowing gradient body, big eyes with
// eyebrows, a mouth that changes shape (neutral / grin / "o"), two arms
// that wave / point / tap a chin / fly up to celebrate, orbiting sparkles
// and a soft halo.
//
//   • Idle LIFE (float / breathe / blink / glance / arm-sway / sparkle
//     orbit + twinkle + glow) is pure CSS via the `gg-sparkie-*` rules in
//     globals.css.
//   • MOODS drive sustained poses: `think` (knit brows, hand to chin,
//     thought dots) while a reply streams; `happy` (grin + squint) for a
//     beat when the answer lands.
//   • When `alive` is set (the launcher FAB) Sparkie also performs rare
//     one-shot moments on his own — wave / peek / point / celebrate — and
//     his eyes follow a nearby cursor.
//
// Everything animates the individual transform properties
// (translate / rotate / scale) so effects COMPOSE, and every motion sits
// behind prefers-reduced-motion: no-preference — reduced motion gets a
// calm Sparkie that still changes expression but never fidgets.
//
// Gradient / filter ids are per-instance (useId) so several Sparkies on
// one page (FAB + typing bubble) don't collide.
//
// ALWAYS-LOADED (imported by the launcher) — keep tiny + react-only.

export type SparkieMood = 'idle' | 'think' | 'happy';

// Autonomous one-shot performances + how long each runs (ms), so the class
// is stripped and the animation can re-fire next time.
const MOMENTS = {
  'gg-sparkie--wave': 1550,
  'gg-sparkie--peek': 950,
  'gg-sparkie--point': 1650,
  'gg-sparkie--celebrate': 1450,
} as const;
const MOMENT_KEYS = Object.keys(MOMENTS) as (keyof typeof MOMENTS)[];

// Cursor proximity inside which Sparkie's eyes track the pointer (px).
const TRACK_RADIUS = 340;
// Max pupil offset while tracking (viewBox units at the 120 box).
const TRACK_MAX = 3.4;

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
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `skEmber${uid}`;
  const softId = `skSoft${uid}`;

  // Rare one-shot moments: a hello wave ~2.2s after mount, then one every
  // 18-40s. Skipped under reduced motion, while the tab is hidden, or while
  // a mood pose (think/happy) is showing.
  useEffect(() => {
    if (!alive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: number;
    let unclass: number;
    const play = (cls: keyof typeof MOMENTS) => {
      const el = ref.current;
      if (!el || document.hidden) return;
      el.classList.add(cls);
      unclass = window.setTimeout(() => el.classList.remove(cls), MOMENTS[cls]);
    };
    const tick = () => {
      const el = ref.current;
      // don't stomp on a think/happy pose
      if (el && !el.className.baseVal?.includes('gg-sparkie--think')) {
        play(MOMENT_KEYS[Math.floor(Math.random() * MOMENT_KEYS.length)]);
      }
      timer = window.setTimeout(tick, 18_000 + Math.random() * 22_000);
    };
    const hello = window.setTimeout(() => play('gg-sparkie--wave'), 2200);
    timer = window.setTimeout(tick, 22_000);
    return () => {
      clearTimeout(hello);
      clearTimeout(timer);
      clearTimeout(unclass);
    };
  }, [alive]);

  // Eyes follow the cursor when it comes near. Pointer devices only,
  // reduced-motion off. rAF-gated; pupils driven by CSS vars on the svg —
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
          const pull = Math.min(1, dist / 90) * TRACK_MAX;
          el.classList.add('gg-sparkie--track');
          el.style.setProperty('--sx', `${((dx / dist) * pull).toFixed(2)}px`);
          el.style.setProperty('--sy', `${((dy / dist) * pull).toFixed(2)}px`);
        } else {
          el.classList.remove('gg-sparkie--track');
        }
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      ref.current?.classList.remove('gg-sparkie--track');
    };
  }, [alive]);

  const moodClass = mood === 'idle' ? '' : ` gg-sparkie--${mood}`;

  return (
    <svg
      ref={ref}
      className={`gg-sparkie${moodClass}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={gradId} cx="42%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#ffd08a" />
          <stop offset="34%" stopColor="#ff7a3d" />
          <stop offset="72%" stopColor="#d0122f" />
          <stop offset="100%" stopColor="#9c0a22" />
        </radialGradient>
        <filter id={softId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* ambient glow */}
      <g className="gg-sk-glow">
        <path
          filter={`url(#${softId})`}
          opacity="0.55"
          style={{ fill: '#c8102e' }}
          d="M60 16 C66 40 80 52 104 60 C80 68 66 80 60 104 C54 80 40 68 16 60 C40 52 54 40 60 16 Z"
        />
      </g>

      {/* orbiting sparkles */}
      <g className="gg-sk-sparkles">
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '-30px', ['--by' as string]: '-26px' }}
          d="M22 34 l2.2 4.6 4.6 2.2 -4.6 2.2 -2.2 4.6 -2.2 -4.6 -4.6 -2.2 4.6 -2.2 Z"
          fill="#ffc06a"
        />
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '32px', ['--by' as string]: '-22px' }}
          d="M98 30 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z"
          fill="#ff8a4a"
        />
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '30px', ['--by' as string]: '28px' }}
          d="M100 84 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 Z"
          fill="#ffd08a"
        />
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '-30px', ['--by' as string]: '26px' }}
          d="M20 86 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 Z"
          fill="#ff8a4a"
        />
      </g>

      <g className="gg-sk-float">
        {/* arms (behind body) */}
        <g className="gg-sk-arm-l">
          <path
            d="M34 74 C26 80 22 90 24 98"
            stroke="#b30d27"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="24" cy="99" r="6" fill="#d0122f" />
        </g>
        <g className="gg-sk-arm-r">
          <path
            d="M86 74 C94 80 98 90 96 98"
            stroke="#b30d27"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="96" cy="99" r="6" fill="#d0122f" />
        </g>

        {/* body */}
        <g className="gg-sk-body">
          <path
            style={{ fill: `url(#${gradId})` }}
            d="M60 16 C66 40 80 52 104 60 C80 68 66 80 60 104 C54 80 40 68 16 60 C40 52 54 40 60 16 Z"
          />
          <ellipse cx="46" cy="42" rx="15" ry="10" fill="#ffffff" opacity="0.14" />
        </g>

        {/* cheeks */}
        <g className="gg-sk-cheeks">
          <ellipse cx="40" cy="66" rx="6.5" ry="4.2" fill="#ff5a54" opacity="0.6" />
          <ellipse cx="80" cy="66" rx="6.5" ry="4.2" fill="#ff5a54" opacity="0.6" />
        </g>

        {/* eyebrows */}
        <g className="gg-sk-brow-l">
          <path
            d="M40 44 Q47 40 54 43"
            stroke="#3a0710"
            strokeWidth="3.2"
            strokeLinecap="round"
            fill="none"
          />
        </g>
        <g className="gg-sk-brow-r">
          <path
            d="M66 43 Q73 40 80 44"
            stroke="#3a0710"
            strokeWidth="3.2"
            strokeLinecap="round"
            fill="none"
          />
        </g>

        {/* eyes */}
        <g className="gg-sk-eyes">
          <ellipse cx="47" cy="56" rx="9" ry="11.5" fill="#fff" />
          <ellipse cx="73" cy="56" rx="9" ry="11.5" fill="#fff" />
          <g className="gg-sk-pupils">
            <circle cx="48" cy="58" r="4.6" fill="#241014" />
            <circle cx="72" cy="58" r="4.6" fill="#241014" />
            <circle cx="46.2" cy="55.6" r="1.5" fill="#fff" />
            <circle cx="70.2" cy="55.6" r="1.5" fill="#fff" />
          </g>
        </g>

        {/* mouths — one shown per state */}
        <path
          className="gg-sk-m-neutral"
          d="M52 74 Q60 79 68 74"
          stroke="#3a0710"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
        <path className="gg-sk-m-o" d="M60 72 a4 4.6 0 1 0 0.1 0 Z" fill="#3a0710" />
        <path
          className="gg-sk-m-grin"
          d="M49 71 Q60 84 71 71 Q60 76 49 71 Z"
          fill="#3a0710"
        />

        {/* thought dots (think state) */}
        <g className="gg-sk-dots">
          <circle cx="88" cy="30" r="2.4" fill="#ffc06a" />
          <circle cx="96" cy="24" r="3.1" fill="#ffb04a" />
          <circle cx="104" cy="16" r="4" fill="#ff8a4a" />
        </g>
      </g>
    </svg>
  );
}
