'use client';

import { useEffect, useRef, useState } from 'react';

// GG's adventure moments — four rare one-shot scenes (campfire, desert
// drive, tent pitch, clay shoot) that play in a small stage popping out
// of the launcher corner. Operator-approved from the live mockup
// (claude.ai artifact 89ae9ef5) 2026-07-18; the SVG + keyframes here are
// that mockup ported 1:1, including the pivot rule it settled on:
// transform-box:fill-box means transform-origin must be center/% —
// NEVER px viewBox coordinates (px origins are bbox-relative and send
// wheels/props orbiting).
//
// LAZY-LOADED: imported via next/dynamic from the launcher only when the
// first scene fires, so it costs nothing on initial page load. All
// styling lives in globals.css under `.gg-adv…` (same pattern as the
// gg-sk mascot rig). The stage is pointer-events:none and aria-hidden —
// pure theatre, never in anyone's way.

export type AdventureKind = 'campfire' | 'desert' | 'camp' | 'clays';

// One full choreography cycle per showing (the CSS loops; the stage
// unmounts at the end of the first pass).
export const ADVENTURE_DURATIONS: Record<AdventureKind, number> = {
  campfire: 8500,
  desert: 9000,
  camp: 9500,
  clays: 8500,
};

export function AdventureStage({
  scene,
  onDone,
  onOpen,
}: {
  scene: AdventureKind;
  onDone: () => void;
  /** Same action as tapping Sparkie — cancels the scene + opens the panel. */
  onOpen: () => void;
}) {
  const [closing, setClosing] = useState(false);
  // Keep the latest onDone without retiming the scene when the parent
  // re-renders (it passes an inline closure).
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    setClosing(false);
    const dur = ADVENTURE_DURATIONS[scene];
    const fade = window.setTimeout(() => setClosing(true), dur - 350);
    const end = window.setTimeout(() => onDoneRef.current(), dur);
    return () => {
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, [scene]);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open Ask GG — your Gun Galore assistant"
      className={[
        `gg-adv gg-adv-${scene}`,
        'app-chrome fixed z-[51]',
        // Sparkie's OWN corner slot (same offsets as #askgg-dock) — the
        // stage blooms out of exactly where he sits (transform-origin is
        // its bottom-right corner) and stands in for him while it plays.
        // The dock (z-52) stays above, so his hit area + mute button keep
        // working over the stage's corner.
        'right-4 bottom-[calc(12px+env(safe-area-inset-bottom))]',
        'md:right-6 md:bottom-5',
        'w-[240px] md:w-[300px]',
      ].join(' ')}
      style={{
        aspectRatio: '16 / 10',
        padding: 0,
        cursor: 'pointer',
        opacity: closing ? 0 : 1,
        transition: 'opacity 320ms ease',
      }}
    >
      {scene === 'campfire' && <CampfireScene />}
      {scene === 'desert' && <DesertScene />}
      {scene === 'camp' && <CampScene />}
      {scene === 'clays' && <ClaysScene />}
    </button>
  );
}

// Shared gradients. Only one scene mounts at a time, so static ids are
// safe (and distinct from the mascot's per-instance useId gradients).
function Defs() {
  return (
    <defs>
      <linearGradient id="ggadvHat" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#dcc084" />
        <stop offset="1" stopColor="#b7994f" />
      </linearGradient>
      <linearGradient id="ggadvSkin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f0c095" />
        <stop offset="1" stopColor="#dca071" />
      </linearGradient>
      <linearGradient id="ggadvShirt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#cdb887" />
        <stop offset="1" stopColor="#a68b52" />
      </linearGradient>
      <linearGradient id="ggadvTent" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c9b47c" />
        <stop offset="1" stopColor="#8f7139" />
      </linearGradient>
      <radialGradient id="ggadvFireGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#ffbf5a" stopOpacity=".5" />
        <stop offset=".6" stopColor="#ff9a3a" stopOpacity=".16" />
        <stop offset="1" stopColor="#ff9a3a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="ggadvSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#171009" />
        <stop offset=".5" stopColor="#33200f" />
        <stop offset=".78" stopColor="#5c3517" />
        <stop offset="1" stopColor="#754424" />
      </linearGradient>
      <radialGradient id="ggadvSun" cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#ffbf5a" stopOpacity=".5" />
        <stop offset="1" stopColor="#ffbf5a" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

// The character pieces below are the production Sparkie paths from
// ask-gg-mascot.tsx, posed per scene (arms are DRAWN per pose — the
// chibi proportions can't take big arm rotations without crossing the
// face, so scenes crossfade or micro-rotate instead).

function CampfireScene() {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <Defs />
      <ellipse cx="160" cy="184" rx="130" ry="9" fill="#000" opacity=".28" />
      <ellipse className="glow" cx="106" cy="150" rx="88" ry="62" fill="url(#ggadvFireGlow)" />
      <g>
        <circle className="smk" cx="106" cy="116" r="7" fill="#8b857c" />
        <circle className="smk smk2" cx="112" cy="118" r="5.5" fill="#79746c" />
        <circle className="smk smk3" cx="101" cy="119" r="6" fill="#8b857c" />
      </g>
      <g fill="#4a4640" stroke="#26231f" strokeWidth="1.4">
        <ellipse cx="70" cy="172" rx="9" ry="6" />
        <ellipse cx="90" cy="177" rx="10" ry="6.5" />
        <ellipse cx="114" cy="178" rx="10" ry="6.5" />
        <ellipse cx="137" cy="174" rx="9" ry="6" />
      </g>
      <rect x="78" y="160" width="52" height="10" rx="5" fill="#6b4a2a" stroke="#3d2a17" strokeWidth="1.4" transform="rotate(-14 104 165)" />
      <rect x="80" y="158" width="52" height="10" rx="5" fill="#7a5632" stroke="#3d2a17" strokeWidth="1.4" transform="rotate(15 106 163)" />
      <g className="flame fl-o"><path d="M106 166 C90 150 96 132 106 118 C109 132 118 134 120 144 C123 156 118 164 106 166 Z" fill="#ff9a3a" /></g>
      <g className="flame fl-m"><path d="M106 165 C96 152 100 138 106 128 C108 138 114 140 116 148 C118 157 114 163 106 165 Z" fill="#ffbf5a" /></g>
      <g className="flame fl-i"><path d="M106 163 C101 155 103 146 106 140 C107 146 111 148 112 152 C113 158 110 162 106 163 Z" fill="#ffd98a" /></g>
      <path className="strike" d="M112 150 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4 Z" fill="#ffd98a" />
      <g transform="translate(162 58) scale(1.02)">
        <g className="gg-f">
          <g>
            <path d="M38 84 Q60 78 82 84 L86 105 Q60 111 34 105 Z" fill="url(#ggadvShirt)" />
            <rect x="41" y="93" width="10" height="9" rx="1.5" stroke="#8f7139" strokeWidth="1.3" />
            <rect x="69" y="93" width="10" height="9" rx="1.5" stroke="#8f7139" strokeWidth="1.3" />
            <path d="M52 83 L60 91 L68 83" stroke="#8f7139" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M54 74 h12 v6 q-6 3 -12 0 Z" fill="#dca071" />
            <path d="M52 83 L60 97 L68 83 Q60 87 52 83 Z" fill="#c8102e" />
            <ellipse cx="60" cy="56" rx="24" ry="23" fill="url(#ggadvSkin)" />
            <ellipse cx="37" cy="59" rx="4" ry="5.5" fill="#dca071" />
            <ellipse cx="83" cy="59" rx="4" ry="5.5" fill="#dca071" />
            <ellipse cx="60" cy="50" rx="20" ry="4.5" fill="#000" opacity=".1" />
            <path d="M24 41 Q60 30 96 41 Q60 50 24 41 Z" fill="#a98a4d" />
            <path d="M41 41 Q40 20 60 18 Q80 20 79 41 Q60 45 41 41 Z" fill="url(#ggadvHat)" />
            <path d="M41 40 Q60 44 79 40 Q60 45.5 41 40 Z" fill="#c8102e" />
          </g>
          <g className="warm-l">
            <path d="M42 88 C34 90 26 92 19 92" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="18" cy="92" r="5.5" fill="#e7b48c" />
          </g>
          <g className="warm-r">
            <path d="M56 92 C46 96 36 98 28 100" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="27" cy="100" r="5.5" fill="#e7b48c" />
          </g>
          <ellipse cx="44" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <ellipse cx="76" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <path d="M40 46 Q47 42 54 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M66 46 Q73 42 80 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="47" cy="56" rx="6" ry="7.6" fill="#fff" />
          <ellipse cx="73" cy="56" rx="6" ry="7.6" fill="#fff" />
          <g className="pupils">
            <circle cx="48" cy="58" r="3.6" fill="#241014" />
            <circle cx="72" cy="58" r="3.6" fill="#241014" />
            <circle cx="46.4" cy="55.8" r="1.2" fill="#fff" />
            <circle cx="70.4" cy="55.8" r="1.2" fill="#fff" />
          </g>
          <path className="m-neutral" d="M53 70 Q60 75 67 70" stroke="#7a3f1e" strokeWidth="2.4" strokeLinecap="round" />
          <path className="m-grin" d="M51 68 Q60 80 69 68 Q60 73 51 68 Z" fill="#7a3f1e" />
        </g>
      </g>
    </svg>
  );
}

function DesertScene() {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <Defs />
      <rect x="0" y="0" width="320" height="200" fill="url(#ggadvSky)" />
      <circle cx="236" cy="112" r="42" fill="url(#ggadvSun)" />
      <circle cx="236" cy="112" r="19" fill="#ffbf5a" opacity=".92" />
      <g className="dunes-far" fill="#4a2c15">
        <path d="M0 150 Q40 128 90 142 Q140 156 190 138 Q250 118 320 144 L360 144 L360 200 L0 200 Z" />
        <path d="M360 150 Q400 128 450 142 Q500 156 550 138 Q610 118 680 144 L720 144 L720 200 L360 200 Z" />
      </g>
      <g className="dunes-near" fill="#5f3a1d">
        <path d="M0 166 Q60 148 120 160 Q190 172 250 156 Q290 148 320 160 L360 160 L360 200 L0 200 Z" />
        <path d="M360 166 Q420 148 480 160 Q550 172 610 156 Q650 148 680 160 L720 160 L720 200 L360 200 Z" />
      </g>
      <rect x="0" y="172" width="320" height="28" fill="#7a5230" />
      <g className="scenery">
        <g fill="#2a1a0c">
          <path d="M52 172 l3 -26 q6 -1 8 -8 l-7 2 l2 -9 l-5 4 l-2 -7 l-2 7 l-5 -4 l2 9 l-7 -2 q2 7 8 8 l3 26 Z" />
          <path d="M226 172 l2.4 -20 q5 -1 6.5 -6.5 l-5.6 1.6 l1.6 -7.2 l-4 3.2 l-1.6 -5.6 l-1.6 5.6 l-4 -3.2 l1.6 7.2 l-5.6 -1.6 q1.5 5.5 6.5 6.5 l2.4 20 Z" />
          <ellipse cx="130" cy="170" rx="10" ry="4" />
          <ellipse cx="298" cy="171" rx="7" ry="3" />
          <path d="M412 172 l3 -26 q6 -1 8 -8 l-7 2 l2 -9 l-5 4 l-2 -7 l-2 7 l-5 -4 l2 9 l-7 -2 q2 7 8 8 l3 26 Z" />
          <path d="M586 172 l2.4 -20 q5 -1 6.5 -6.5 l-5.6 1.6 l1.6 -7.2 l-4 3.2 l-1.6 -5.6 l-1.6 5.6 l-4 -3.2 l1.6 7.2 l-5.6 -1.6 q1.5 5.5 6.5 6.5 l2.4 20 Z" />
          <ellipse cx="490" cy="170" rx="10" ry="4" />
          <ellipse cx="658" cy="171" rx="7" ry="3" />
        </g>
      </g>
      <line className="ground-dash" x1="0" y1="183" x2="320" y2="183" stroke="#4f3016" strokeWidth="2.4" opacity=".8" />
      <line className="ground-dash" x1="0" y1="191" x2="320" y2="191" stroke="#4f3016" strokeWidth="3" />
      <ellipse cx="160" cy="195" rx="150" ry="4" fill="#000" opacity=".22" />
      <ellipse className="heat" cx="160" cy="176" rx="150" ry="5" fill="#ffbf5a" />
      <g fill="#c49764">
        <circle className="dust" cx="62" cy="178" r="7" />
        <circle className="dust dust2" cx="66" cy="182" r="5.5" />
        <circle className="dust dust3" cx="58" cy="184" r="6" />
      </g>
      <g className="truck">
        <circle cx="86" cy="128" r="13" fill="#241f1a" stroke="#191512" strokeWidth="2" />
        <circle cx="86" cy="128" r="6.5" fill="#3a332b" />
        <path d="M130 144 v-52 h54 v52" stroke="#3a352d" strokeWidth="5.5" strokeLinejoin="round" />
        <g className="rider" transform="translate(128 76) scale(.72)">
          <g className="hat-lift">
            <path d="M24 41 Q60 30 96 41 Q60 50 24 41 Z" fill="#a98a4d" />
            <path d="M41 41 Q40 20 60 18 Q80 20 79 41 Q60 45 41 41 Z" fill="url(#ggadvHat)" />
            <path d="M41 40 Q60 44 79 40 Q60 45.5 41 40 Z" fill="#c8102e" />
          </g>
          <ellipse cx="60" cy="58" rx="24" ry="23" fill="url(#ggadvSkin)" />
          <ellipse cx="60" cy="51" rx="20" ry="4.5" fill="#000" opacity=".1" />
          <ellipse cx="47" cy="58" rx="6" ry="7.6" fill="#fff" />
          <ellipse cx="73" cy="58" rx="6" ry="7.6" fill="#fff" />
          <circle cx="48" cy="60" r="3.6" fill="#241014" />
          <circle cx="72" cy="60" r="3.6" fill="#241014" />
          <circle cx="46.4" cy="57.8" r="1.2" fill="#fff" />
          <circle cx="70.4" cy="57.8" r="1.2" fill="#fff" />
          <ellipse cx="44" cy="65" rx="5" ry="3.2" fill="#ff8a5a" />
          <ellipse cx="76" cy="65" rx="5" ry="3.2" fill="#ff8a5a" />
          <path d="M40 48 Q47 44 54 48" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M66 48 Q73 44 80 48" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <path className="m-grin" d="M51 70 Q60 82 69 70 Q60 75 51 70 Z" fill="#7a3f1e" />
          <path d="M38 86 Q60 80 82 86 L84 106 Q60 112 36 106 Z" fill="url(#ggadvShirt)" />
          <path d="M52 85 L60 97 L68 85 Q60 89 52 85 Z" fill="#c8102e" />
          <path d="M74 90 C86 92 96 88 102 85" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
          <circle cx="103" cy="85" r="5.5" fill="#e7b48c" />
        </g>
        <circle cx="206" cy="138" r="8" stroke="#241f1a" strokeWidth="3.4" fill="none" />
        <path d="M212 144 L222 106" stroke="#3a352d" strokeWidth="5" strokeLinecap="round" />
        <path d="M214 142 L223 108 L230 110 L230 142 Z" fill="#1a222c" opacity=".85" stroke="#23231c" strokeWidth="1.6" />
        <rect x="56" y="142" width="176" height="32" rx="6" fill="#77874f" stroke="#23231c" strokeWidth="2" />
        <path d="M232 142 h26 q10 0 13 10 l2 8 q2 12 -9 12 h-32 Z" fill="#6b7a4f" stroke="#23231c" strokeWidth="2" />
        <circle cx="264" cy="154" r="4.2" fill="#ffd98a" stroke="#23231c" strokeWidth="1.5" />
        <rect x="270" y="160" width="7" height="12" rx="2.5" fill="#3a352d" />
        <path d="M188 144 v28" stroke="#5c6a3e" strokeWidth="2" />
        <rect x="176" y="150" width="9" height="3" rx="1.5" fill="#3a352d" />
        <path d="M56 156 h176" stroke="#c8102e" strokeWidth="4" />
        <rect x="196" y="162" width="28" height="9" rx="2" fill="#e8e2d6" />
        <text x="210" y="169" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#241f1a">GG</text>
        <path d="M82 174 a22 22 0 0 1 44 0" stroke="#23231c" strokeWidth="6" fill="none" />
        <path d="M216 174 a22 22 0 0 1 44 0" stroke="#23231c" strokeWidth="6" fill="none" />
        <g className="wheel">
          <circle cx="104" cy="174" r="16" fill="#241f1a" stroke="#191512" strokeWidth="2" />
          <g fill="#191512">
            <rect x="102" y="156.5" width="4" height="4" rx="1" />
            <rect x="102" y="189.5" width="4" height="4" rx="1" />
            <rect x="85.5" y="172" width="4" height="4" rx="1" />
            <rect x="118.5" y="172" width="4" height="4" rx="1" />
          </g>
          <circle cx="104" cy="174" r="7.5" fill="#4a4438" />
          <path d="M104 167.5 v13 M97.5 174 h13" stroke="#6b6355" strokeWidth="2.4" />
        </g>
        <g className="wheel">
          <circle cx="238" cy="174" r="16" fill="#241f1a" stroke="#191512" strokeWidth="2" />
          <g fill="#191512">
            <rect x="236" y="156.5" width="4" height="4" rx="1" />
            <rect x="236" y="189.5" width="4" height="4" rx="1" />
            <rect x="219.5" y="172" width="4" height="4" rx="1" />
            <rect x="252.5" y="172" width="4" height="4" rx="1" />
          </g>
          <circle cx="238" cy="174" r="7.5" fill="#4a4438" />
          <path d="M238 167.5 v13 M231.5 174 h13" stroke="#6b6355" strokeWidth="2.4" />
        </g>
      </g>
    </svg>
  );
}

function CampScene() {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <Defs />
      <ellipse cx="160" cy="184" rx="130" ry="9" fill="#000" opacity=".28" />
      <g className="bag">
        <rect x="76" y="158" width="64" height="22" rx="11" fill="#8f7139" stroke="#4a3c1e" strokeWidth="1.6" />
        <rect x="98" y="156" width="6" height="26" rx="3" fill="#c8102e" />
        <path d="M100 154 q8 -10 16 0" stroke="#5a4a26" strokeWidth="3" fill="none" />
      </g>
      <g className="tent">
        <path d="M60 178 L108 108 L156 178 Z" fill="url(#ggadvTent)" stroke="#4a3c1e" strokeWidth="2" />
        <path d="M108 108 L108 178" stroke="#6d5528" strokeWidth="2" />
        <path d="M92 178 L108 178 L108 132 Z" fill="#6d5528" />
        <line x1="108" y1="108" x2="108" y2="92" stroke="#6d5528" strokeWidth="2.4" />
        <path className="pennant" d="M108 92 l20 5 -20 5 Z" fill="#c8102e" />
      </g>
      <path className="guy" d="M62 176 L44 186" stroke="#d8cba4" strokeWidth="1.6" />
      <path className="guy" d="M154 176 L172 186" stroke="#d8cba4" strokeWidth="1.6" />
      <rect x="168" y="176" width="4" height="12" rx="2" fill="#8b6a34" stroke="#4a3c1e" strokeWidth="1" transform="rotate(18 170 182)" />
      <g fill="#ffd98a">
        <path className="tink" d="M172 168 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z" />
        <path className="tink tink2" d="M180 172 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 Z" />
        <path className="tink tink3" d="M166 174 l1.2 2.6 2.6 1.2 -2.6 1.2 -1.2 2.6 -1.2 -2.6 -2.6 -1.2 2.6 -1.2 Z" />
      </g>
      <g fill="#ffcf7a">
        <path className="spark" d="M200 62 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z" />
        <path className="spark spark2" d="M262 56 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 Z" />
        <path className="spark spark3" d="M288 92 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 Z" />
      </g>
      <g transform="translate(178 62) scale(1.0)">
        <g className="gg-f">
          <g>
            <path d="M38 84 Q60 78 82 84 L86 105 Q60 111 34 105 Z" fill="url(#ggadvShirt)" />
            <rect x="41" y="93" width="10" height="9" rx="1.5" stroke="#8f7139" strokeWidth="1.3" />
            <rect x="69" y="93" width="10" height="9" rx="1.5" stroke="#8f7139" strokeWidth="1.3" />
            <path d="M52 83 L60 91 L68 83" stroke="#8f7139" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M54 74 h12 v6 q-6 3 -12 0 Z" fill="#dca071" />
            <path d="M52 83 L60 97 L68 83 Q60 87 52 83 Z" fill="#c8102e" />
            <ellipse cx="60" cy="56" rx="24" ry="23" fill="url(#ggadvSkin)" />
            <ellipse cx="37" cy="59" rx="4" ry="5.5" fill="#dca071" />
            <ellipse cx="83" cy="59" rx="4" ry="5.5" fill="#dca071" />
            <ellipse cx="60" cy="50" rx="20" ry="4.5" fill="#000" opacity=".1" />
            <path d="M24 41 Q60 30 96 41 Q60 50 24 41 Z" fill="#a98a4d" />
            <path d="M41 41 Q40 20 60 18 Q80 20 79 41 Q60 45 41 41 Z" fill="url(#ggadvHat)" />
            <path d="M41 40 Q60 44 79 40 Q60 45.5 41 40 Z" fill="#c8102e" />
          </g>
          <g className="work-arms">
            <path d="M44 88 C38 92 34 96 33 100" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="33" cy="100" r="5.5" fill="#e7b48c" />
            <path d="M78 88 C86 92 92 96 95 100" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="96" cy="101" r="5.5" fill="#e7b48c" />
            <g transform="rotate(50 96 101)">
              <g className="mallet-tap">
                <rect x="94.4" y="84" width="3.6" height="18" rx="1.8" fill="#8b6a34" stroke="#4a3c1e" strokeWidth="1" />
                <rect x="88.5" y="76" width="15" height="9" rx="3" fill="#575046" stroke="#33302a" strokeWidth="1" />
              </g>
            </g>
          </g>
          <g className="cele-arms">
            <path d="M44 86 C36 78 31 68 31 58" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="31" cy="56" r="5.5" fill="#e7b48c" />
            <path d="M76 86 C84 78 89 68 89 58" stroke="url(#ggadvShirt)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="89" cy="56" r="5.5" fill="#e7b48c" />
          </g>
          <ellipse cx="44" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <ellipse cx="76" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <path d="M40 46 Q47 42 54 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M66 46 Q73 42 80 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="47" cy="56" rx="6" ry="7.6" fill="#fff" />
          <ellipse cx="73" cy="56" rx="6" ry="7.6" fill="#fff" />
          <g className="pupils">
            <circle cx="48" cy="58" r="3.6" fill="#241014" />
            <circle cx="72" cy="58" r="3.6" fill="#241014" />
            <circle cx="46.4" cy="55.8" r="1.2" fill="#fff" />
            <circle cx="70.4" cy="55.8" r="1.2" fill="#fff" />
          </g>
          <path className="m-neutral" d="M53 70 Q60 75 67 70" stroke="#7a3f1e" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse className="m-o" cx="60" cy="71" rx="3.4" ry="4" fill="#7a3f1e" />
          <path className="m-grin" d="M51 68 Q60 80 69 68 Q60 73 51 68 Z" fill="#7a3f1e" />
        </g>
      </g>
    </svg>
  );
}

function ClaysScene() {
  return (
    <svg viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <Defs />
      <ellipse cx="160" cy="184" rx="130" ry="9" fill="#000" opacity=".28" />
      <g className="trap">
        <path d="M248 176 h30 l-6 -14 h-18 Z" fill="#3a352d" stroke="#23211c" strokeWidth="1.6" />
        <rect x="252" y="154" width="24" height="8" rx="3" fill="#4a4438" stroke="#23211c" strokeWidth="1.6" transform="rotate(-24 264 158)" />
      </g>
      <rect x="246" y="176" width="36" height="6" rx="3" fill="#241f1a" />
      <g className="clay">
        <g transform="translate(262 148)">
          <ellipse cx="0" cy="0" rx="10" ry="4.5" fill="#ff7a2a" stroke="#a34a12" strokeWidth="1.4" />
          <ellipse cx="0" cy="-1.6" rx="6.5" ry="2.4" fill="#ffbf5a" />
        </g>
      </g>
      <g>
        <polygon className="shard shard1" points="196,100 204,96 201,106" fill="#ff7a2a" />
        <polygon className="shard shard2" points="196,100 188,97 191,107" fill="#ff9a3a" />
        <polygon className="shard shard3" points="196,100 200,92 192,94" fill="#ffbf5a" />
        <polygon className="shard shard4" points="196,100 203,102 198,108" fill="#ff7a2a" />
        <circle className="poof" cx="196" cy="100" r="12" fill="#d8cba4" />
      </g>
      <g className="rig" transform="translate(34 58) scale(1.0)">
        <g className="gg-f">
          <g>
            <path d="M38 84 Q60 78 82 84 L86 105 Q60 111 34 105 Z" fill="url(#ggadvShirt)" />
            <rect x="41" y="93" width="10" height="9" rx="1.5" stroke="#8f7139" strokeWidth="1.3" />
            <rect x="69" y="93" width="10" height="9" rx="1.5" stroke="#8f7139" strokeWidth="1.3" />
            <path d="M52 83 L60 91 L68 83" stroke="#8f7139" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M54 74 h12 v6 q-6 3 -12 0 Z" fill="#dca071" />
            <path d="M52 83 L60 97 L68 83 Q60 87 52 83 Z" fill="#c8102e" />
            <ellipse cx="60" cy="56" rx="24" ry="23" fill="url(#ggadvSkin)" />
            <ellipse cx="37" cy="59" rx="4" ry="5.5" fill="#dca071" />
            <ellipse cx="83" cy="59" rx="4" ry="5.5" fill="#dca071" />
            <ellipse cx="60" cy="50" rx="20" ry="4.5" fill="#000" opacity=".1" />
            <path d="M24 41 Q60 30 96 41 Q60 50 24 41 Z" fill="#a98a4d" />
            <path d="M41 41 Q40 20 60 18 Q80 20 79 41 Q60 45 41 41 Z" fill="url(#ggadvHat)" />
            <path d="M41 40 Q60 44 79 40 Q60 45.5 41 40 Z" fill="#c8102e" />
          </g>
          <ellipse cx="44" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <ellipse cx="76" cy="63" rx="5" ry="3.2" fill="#ff8a5a" />
          <path d="M40 46 Q47 42 54 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M66 46 Q73 42 80 46" stroke="#5a3a1e" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="47" cy="56" rx="6" ry="7.6" fill="#fff" />
          <ellipse cx="73" cy="56" rx="6" ry="7.6" fill="#fff" />
          <g className="pupils">
            <circle cx="48" cy="58" r="3.6" fill="#241014" />
            <circle cx="72" cy="58" r="3.6" fill="#241014" />
            <circle cx="46.4" cy="55.8" r="1.2" fill="#fff" />
            <circle cx="70.4" cy="55.8" r="1.2" fill="#fff" />
          </g>
          <path className="m-neutral" d="M53 70 Q60 75 67 70" stroke="#7a3f1e" strokeWidth="2.4" strokeLinecap="round" />
          <path className="m-grin" d="M51 68 Q60 80 69 68 Q60 73 51 68 Z" fill="#7a3f1e" />
          <g className="gun-grp" transform="translate(52 88) rotate(-14)">
            <path d="M2 6 q-10 2 -15 9 l7 4 q5 -7 12 -8 Z" fill="#5a3a1e" stroke="#33261c" strokeWidth="1.2" />
            <rect x="0" y="-.5" width="62" height="5" rx="2.5" fill="#33261c" />
            <rect x="0" y="-5.5" width="62" height="5" rx="2.5" fill="#443327" />
            <rect x="16" y="-6.5" width="17" height="12" rx="5" fill="#6b4a2a" stroke="#33261c" strokeWidth="1.2" />
            <circle cx="24" cy="0" r="5.5" fill="#e7b48c" />
            <circle cx="4" cy="6" r="5" fill="#e7b48c" />
            <path className="flash" d="M64 -4 l8 -5 -4 6.5 9 .7 -9 3 4.6 6 -8.6 -4.2 Z" fill="#ffd98a" />
            <circle className="wisp" cx="63" cy="-6" r="3.6" fill="#b5aea3" />
          </g>
        </g>
      </g>
    </svg>
  );
}
