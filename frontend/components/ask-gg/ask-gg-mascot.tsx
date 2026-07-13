'use client';

import { useEffect, useId, useRef } from 'react';

// Sparkie — the Ask GG mascot (safari edition, operator pick 2026-07-13):
// a little safari ranger in a khaki bush hat with a real face and two working
// hands. GG red rides on his hatband + neckerchief. A round friendly head, big
// eyes with eyebrows, a mouth that changes shape (neutral / grin / "o"), two
// arms that wave / point / tap along / fly up to celebrate, a warm halo and a
// few adventure sparkles.
//
//   • Idle LIFE (float / breathe / blink / glance / arm-sway / sparkle orbit +
//     twinkle + glow) is pure CSS via the `gg-sk-*` rules in globals.css.
//   • MOODS drive sustained poses: `think` (knit brows, hand to chin, thought
//     dots) while a reply streams; `happy` (grin + squint) when the answer
//     lands.
//   • When `alive` is set (the launcher FAB) Sparkie also performs rare
//     one-shot moments on his own — wave / peek / point / celebrate — and his
//     eyes follow a nearby cursor.
//
// The character is built on the SAME animation rig as the previous mascot —
// identical `gg-sk-*` class names and viewBox coordinates (arm pivots 34/86,74;
// brow pivots 47/73,45; eyes 47/73,56; pupils 48/72,58; mouths ~y70) — so the
// globals.css rig drives it unchanged. Everything animates the individual
// transform properties (translate / rotate / scale) so effects COMPOSE, and
// every motion sits behind prefers-reduced-motion: no-preference.
//
// Gradient ids are per-instance (useId) so several Sparkies on one page
// (FAB + typing bubble) don't collide.
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
  fill = false,
}: {
  size?: number;
  mood?: SparkieMood;
  alive?: boolean;
  /** When true, the SVG fills its parent box (width/height 100%) instead of a
   *  fixed `size`. Lets the launcher scale Sparkie responsively (80px mobile,
   *  160px desktop) from CSS without re-rendering. */
  fill?: boolean;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');
  const haloId = `skHalo${uid}`;
  const hatId = `skHat${uid}`;
  const skinId = `skSkin${uid}`;
  const shirtId = `skShirt${uid}`;

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
      width={fill ? '100%' : size}
      height={fill ? '100%' : size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={haloId} cx="50%" cy="46%" r="55%">
          <stop offset="0%" stopColor="#ffcf7a" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#e8952f" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#e8952f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={hatId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dcc084" />
          <stop offset="1" stopColor="#b7994f" />
        </linearGradient>
        <linearGradient id={skinId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0c095" />
          <stop offset="1" stopColor="#dca071" />
        </linearGradient>
        <linearGradient id={shirtId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cdb887" />
          <stop offset="1" stopColor="#a68b52" />
        </linearGradient>
      </defs>

      {/* warm halo */}
      <ellipse className="gg-sk-glow" cx="60" cy="56" rx="50" ry="50" fill={`url(#${haloId})`} />

      {/* orbiting adventure sparkles */}
      <g className="gg-sk-sparkles">
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '-30px', ['--by' as string]: '-26px' }}
          d="M20 32 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z"
          fill="#ffd98a"
        />
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '32px', ['--by' as string]: '-22px' }}
          d="M100 30 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 Z"
          fill="#ffcf7a"
        />
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '30px', ['--by' as string]: '28px' }}
          d="M101 86 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 Z"
          fill="#ffbf5a"
        />
        <path
          className="gg-sk-spk"
          style={{ ['--bx' as string]: '-30px', ['--by' as string]: '26px' }}
          d="M19 88 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 Z"
          fill="#ffcf7a"
        />
      </g>

      <g className="gg-sk-float">
        {/* arms (behind body) — sleeves in shirt khaki, skin hands */}
        <g className="gg-sk-arm-l">
          <path
            d="M40 76 C31 80 27 88 28 96"
            stroke={`url(#${shirtId})`}
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="28" cy="97" r="5.5" fill="#e7b48c" />
        </g>
        <g className="gg-sk-arm-r">
          <path
            d="M80 76 C89 80 93 88 92 96"
            stroke={`url(#${shirtId})`}
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="92" cy="97" r="5.5" fill="#e7b48c" />
        </g>

        {/* body — safari shirt torso + head + bush hat (one breathing mass) */}
        <g className="gg-sk-body">
          <path d="M38 84 Q60 78 82 84 L86 105 Q60 111 34 105 Z" fill={`url(#${shirtId})`} />
          <rect x="41" y="93" width="10" height="9" rx="1.5" fill="none" stroke="#8f7139" strokeWidth="1.3" />
          <rect x="69" y="93" width="10" height="9" rx="1.5" fill="none" stroke="#8f7139" strokeWidth="1.3" />
          <path d="M52 83 L60 91 L68 83" fill="none" stroke="#8f7139" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M54 74 h12 v6 q-6 3 -12 0 Z" fill="#dca071" />
          {/* red neckerchief — the GG accent */}
          <path d="M52 83 L60 97 L68 83 Q60 87 52 83 Z" fill="#c8102e" />
          {/* head */}
          <ellipse cx="60" cy="56" rx="24" ry="23" fill={`url(#${skinId})`} />
          <ellipse cx="37" cy="59" rx="4" ry="5.5" fill="#dca071" />
          <ellipse cx="83" cy="59" rx="4" ry="5.5" fill="#dca071" />
          <path d="M60 60 q -2.6 4 0 5.4 q 2.6 -1.4 0 -5.4 Z" fill="#cf936a" />
          {/* soft hat-brim shadow across the forehead */}
          <ellipse cx="60" cy="50" rx="20" ry="4.5" fill="#000" opacity="0.10" />
          {/* bush hat — brim, crown, red band */}
          <path d="M24 41 Q60 30 96 41 Q60 50 24 41 Z" fill="#a98a4d" />
          <path d="M41 41 Q40 20 60 18 Q80 20 79 41 Q60 45 41 41 Z" fill={`url(#${hatId})`} />
          <path d="M60 20 L60 40" stroke="#a98a4d" strokeWidth="1.2" opacity="0.5" />
          <path d="M41 40 Q60 44 79 40 Q60 45.5 41 40 Z" fill="#c8102e" />
        </g>

        {/* cheeks */}
        <g className="gg-sk-cheeks">
          <ellipse cx="44" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <ellipse cx="76" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
        </g>

        {/* eyebrows */}
        <g className="gg-sk-brow-l">
          <path d="M40 46 Q47 42 54 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </g>
        <g className="gg-sk-brow-r">
          <path d="M66 46 Q73 42 80 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </g>

        {/* eyes */}
        <g className="gg-sk-eyes">
          <ellipse cx="47" cy="56" rx="6" ry="7.6" fill="#fff" />
          <ellipse cx="73" cy="56" rx="6" ry="7.6" fill="#fff" />
          <g className="gg-sk-pupils">
            <circle cx="48" cy="58" r="3.6" fill="#241014" />
            <circle cx="72" cy="58" r="3.6" fill="#241014" />
            <circle cx="46.4" cy="55.8" r="1.2" fill="#fff" />
            <circle cx="70.4" cy="55.8" r="1.2" fill="#fff" />
          </g>
        </g>

        {/* mouths — one shown per state */}
        <path
          className="gg-sk-m-neutral"
          d="M53 70 Q60 75 67 70"
          stroke="#7a3f1e"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <ellipse className="gg-sk-m-o" cx="60" cy="71" rx="3.4" ry="4" fill="#7a3f1e" />
        <path className="gg-sk-m-grin" d="M51 68 Q60 80 69 68 Q60 73 51 68 Z" fill="#7a3f1e" />

        {/* thought dots (think state) */}
        <g className="gg-sk-dots">
          <circle cx="90" cy="30" r="2.2" fill="#ffcf7a" />
          <circle cx="98" cy="24" r="2.9" fill="#ffbf5a" />
          <circle cx="106" cy="17" r="3.6" fill="#ff9a3a" />
        </g>
      </g>
    </svg>
  );
}
