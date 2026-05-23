'use client';

// iOS install-flow animation. 4 scenes × 4s = 16s loop.
//
// Recreates the design-tool prototype (gg-safari-homescreen) in pure
// React + raw DOM — no Babel UMD, no React-Three, no extra deps. The
// original prototype rendered at a fixed 1080×1920 stage and CSS-scaled
// it to fit the viewport; we do the same here so every pixel
// coordinate from the design lines up exactly. A ResizeObserver
// measures the wrapper and sets the inner stage's transform: scale().
//
// Used inside the iOS hint modal in install-prompt.tsx — replaces the
// previous text-only step list with a visual walkthrough.

import { useEffect, useMemo, useRef, useState } from 'react';

// ─── Stage layout (verbatim from the design) ───────────────────────
const STAGE_W = 1080;
const STAGE_H = 1920;
const PHONE_W = 660;                          // CSS width of phone screenshot
const SCREEN_SCALE = PHONE_W / 738;            // screenshots are 738×1600
const PHONE_X = (STAGE_W - PHONE_W) / 2 - 14;  // shift left so bezel centres
const PHONE_Y = 240;
const SCREEN_X = PHONE_X + 14;                 // bezel = 14
const SCREEN_Y = PHONE_Y + 14;

// Convert screenshot pixel → stage coord.
function T(ix: number, iy: number): [number, number] {
  return [SCREEN_X + ix * SCREEN_SCALE, SCREEN_Y + iy * SCREEN_SCALE];
}

// ─── Timing ────────────────────────────────────────────────────────
const SCENE_DUR = 4.0;
const TOTAL = SCENE_DUR * 4;

// Cursor + badge layout — constant across every scene so the pointer
// reads as the same physical object travelling between screens.
const FINGER_FROM: [number, number] = [1240, 1980];   // off-stage bottom-right
const BADGE_OFFSET: [number, number] = [-201, -115];   // from EDITMODE-saved tweak

// Per-scene fine-tune offsets (from EDITMODE-saved tweaks in the prototype).
const SCENE_OFFSETS: [number, number][] = [
  [5, 0],
  [14, 0],
  [0, 0],
  [0, 0],
];

// ─── Brand tokens ──────────────────────────────────────────────────
const GG = {
  red: '#E11D2A',
  redGlow: 'rgba(225, 29, 42, 0.55)',
  muted: '#9a9aa3',
};

// ─── Easing (subset from animations.jsx) ───────────────────────────
const ease = {
  outCubic: (t: number) => {
    const u = t - 1;
    return u * u * u + 1;
  },
  inCubic: (t: number) => t * t * t,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// ─── Scene data ────────────────────────────────────────────────────
type HaloShape = 'circle' | 'rounded' | 'pill';
interface SceneDef {
  n: number;
  label: string;
  img: string;
  target: [number, number];
  haloW: number;
  haloH: number;
  haloShape: HaloShape;
}

const SCENES: SceneDef[] = [
  {
    n: 1,
    label: 'Tap the more menu',
    img: '/install-steps/step1-safari.jpeg',
    target: T(658, 1490),
    haloW: 130, haloH: 130, haloShape: 'circle',
  },
  {
    n: 2,
    label: 'Tap Share',
    img: '/install-steps/step2-menu.jpeg',
    target: T(450, 843),
    haloW: 480, haloH: 110, haloShape: 'rounded',
  },
  {
    n: 3,
    label: 'Tap Add to Home Screen',
    img: '/install-steps/step3-sharesheet.jpeg',
    target: T(370, 1458),
    haloW: 660, haloH: 110, haloShape: 'rounded',
  },
  {
    n: 4,
    label: "Tap Add — you're done",
    img: '/install-steps/step4-addhome.jpeg',
    target: T(635, 202),
    haloW: 170, haloH: 110, haloShape: 'pill',
  },
];

// ─── Pixel-art Windows pointing-hand cursor ────────────────────────
// 32×28 grid. 'B' = black outline, 'W' = white fill, '.' = transparent.
// Fingertip is at grid col 12-13 — we offset the viewBox so the tip
// lands at (0,0). Identical to the design source.
const CURSOR_GRID = [
  '............BB..................',
  '...........B..B.................',
  '...........BWWB.................',
  '...........BWWB.................',
  '...........BWWB.................',
  '...........BWWB.................',
  '...........BWWB.................',
  '...........BWWBBB...............',
  '...........BWWBWWBBB............',
  '...........BWWBWWBWWBB..........',
  '...........BWWBWWBWWBWWB........',
  '....BBB....BWWBWWBWWBWWBWB......',
  '...BWWWBB..BWWWWWWWWWWWWWWB.....',
  '...BWWWWWBBBWWWWWWWWWWWWWWB.....',
  '....BWWWWWWWWWWWWWWWWWWWWWB.....',
  '.....BWWWWWWWWWWWWWWWWWWWB......',
  '......BWWWWWWWWWWWWWWWWWWB......',
  '......BWWWWWWWWWWWWWWWWWB.......',
  '.......BWWWWWWWWWWWWWWWWB.......',
  '.......BWWWWWWWWWWWWWWWB........',
  '........BWWWWWWWWWWWWWWB........',
  '........BWWWWWWWWWWWWWB.........',
  '.........BWWWWWWWWWWWB..........',
  '.........BWWWWWWWWWWB...........',
  '..........BWWWWWWWWB............',
  '..........BWWWWWWWB.............',
  '...........BWWWWWB..............',
  '...........BBBBBB...............',
];

// Rasterise the grid to <rect>s, collapsing horizontal runs of the
// same colour. Memoised once — no per-frame cost.
function rasteriseCursor() {
  const rects: { key: string; x: number; y: number; w: number; fill: string }[] = [];
  for (let y = 0; y < CURSOR_GRID.length; y++) {
    const row = CURSOR_GRID[y];
    let runStart = -1;
    let runColor: string | null = null;
    for (let x = 0; x <= row.length; x++) {
      const ch = row[x];
      const color = ch === 'B' ? '#000' : ch === 'W' ? '#fff' : null;
      if (color !== runColor) {
        if (runColor) {
          rects.push({
            key: `${y}-${runStart}`,
            x: runStart,
            y,
            w: x - runStart,
            fill: runColor,
          });
        }
        runStart = x;
        runColor = color;
      }
    }
  }
  return rects;
}

const CURSOR_RECTS = rasteriseCursor();
const CURSOR_TIP_X = 12.5;
const CURSOR_TIP_Y = 0.5;
const CURSOR_GRID_W = 32;
const CURSOR_GRID_H = CURSOR_GRID.length;

function FingerPointer({ size = 170 }: { size?: number }) {
  const aspect = CURSOR_GRID_H / CURSOR_GRID_W;
  return (
    <svg
      width={size}
      height={size * aspect}
      viewBox={`${-CURSOR_TIP_X} ${-CURSOR_TIP_Y} ${CURSOR_GRID_W} ${CURSOR_GRID_H}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        filter:
          'drop-shadow(0 4px 0 rgba(0,0,0,0.35)) drop-shadow(0 12px 18px rgba(0,0,0,0.45))',
      }}
    >
      {CURSOR_RECTS.map((r) => (
        <rect
          key={r.key}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={r.fill}
          shapeRendering="crispEdges"
        />
      ))}
    </svg>
  );
}

// ─── Step badge — red circle with white number ─────────────────────
function StepBadge({ n, size = 104 }: { n: number; size?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        background: GG.red,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 800,
        fontSize: size * 0.5,
        letterSpacing: '-0.02em',
        boxShadow: `0 0 0 6px #0a0a0c, 0 0 0 10px ${GG.red}, 0 18px 40px rgba(225,29,42,0.45)`,
      }}
    >
      {n}
    </div>
  );
}

// ─── Tap ring — expanding ripple at moment of tap ──────────────────
function TapRing({ x, y, tapAt, time }: { x: number; y: number; tapAt: number; time: number }) {
  const local = time - tapAt;
  if (local < 0 || local > 0.55) return null;
  const p = local / 0.55;
  const r = 30 + p * 110;
  const opacity = 1 - p;
  return (
    <svg
      width={320}
      height={320}
      style={{ position: 'absolute', left: x - 160, top: y - 160, pointerEvents: 'none' }}
    >
      <circle
        cx="160" cy="160" r={r}
        fill="none"
        stroke={GG.red}
        strokeWidth={6 - 4 * p}
        opacity={opacity}
      />
      <circle
        cx="160" cy="160" r={r * 0.6}
        fill="none"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="2"
        opacity={opacity * 0.7}
      />
    </svg>
  );
}

// ─── Spotlight halo behind target ─────────────────────────────────
function TargetHalo({
  x, y, w, h, shape, start, end, time,
}: {
  x: number; y: number; w: number; h: number;
  shape: HaloShape; start: number; end: number; time: number;
}) {
  if (time < start || time > end) return null;
  const local = time - start;
  const fade = Math.min(1, local / 0.4) * Math.min(1, (end - time) / 0.4);
  const pulse = 0.85 + 0.15 * Math.sin(local * 6);
  const radius =
    shape === 'circle' ? '50%' : shape === 'pill' ? 999 : 22;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        borderRadius: radius,
        boxShadow: `0 0 0 3px ${GG.red}, 0 0 60px 6px ${GG.redGlow}`,
        opacity: fade * pulse,
        background: 'rgba(225,29,42,0.08)',
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── Phone shell — frames a screenshot in a bezel + animates in/out ─
function PhoneShell({
  x, y, width, sceneStart, sceneEnd, time, children,
}: {
  x: number; y: number; width: number;
  sceneStart: number; sceneEnd: number; time: number;
  children: React.ReactNode;
}) {
  const local = time - sceneStart;
  const entryDur = 0.45;
  const exitDur = 0.35;
  const sinceExit = time - (sceneEnd - exitDur);

  let opacity = 1, dx = 0, scale = 1;
  if (local < entryDur) {
    const p = ease.outCubic(Math.max(0, local) / entryDur);
    opacity = p;
    scale = 0.96 + 0.04 * p;
    dx = (1 - p) * 80;
  } else if (sinceExit > 0) {
    const p = ease.inCubic(Math.min(1, sinceExit / exitDur));
    opacity = 1 - p;
    dx = -p * 80;
    scale = 1 - 0.02 * p;
  }

  const screenW = width;
  const screenH = (width * 1600) / 738;
  const bezel = 14;
  const radius = 64;

  return (
    <div
      style={{
        position: 'absolute',
        left: x + dx,
        top: y,
        width: screenW + bezel * 2,
        height: screenH + bezel * 2,
        background: '#000',
        borderRadius: radius + bezel,
        padding: bezel,
        boxShadow:
          '0 40px 80px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(255,255,255,0.06)',
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: screenW,
          height: screenH,
          borderRadius: radius,
          overflow: 'hidden',
          position: 'relative',
          background: '#000',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Animated finger that moves to a target then taps ──────────────
function FingerToTarget({
  fromX, fromY, targetX, targetY,
  enterAt, settleAt, tapAt, leaveAt,
  badgeN, badgeOffset, time,
}: {
  fromX: number; fromY: number;
  targetX: number; targetY: number;
  enterAt: number; settleAt: number; tapAt: number; leaveAt: number;
  badgeN: number; badgeOffset: [number, number]; time: number;
}) {
  if (time < enterAt - 0.05 || time > leaveAt + 0.05) return null;

  let x: number, y: number, scale = 1, opacity = 1;

  if (time < settleAt) {
    const p = ease.outCubic(Math.min(1, Math.max(0, (time - enterAt) / (settleAt - enterAt))));
    x = fromX + (targetX - fromX) * p;
    y = fromY + (targetY - fromY) * p;
    opacity = Math.min(1, (time - enterAt) / 0.25);
  } else if (time < tapAt) {
    const phase = (time - settleAt) * 4;
    x = targetX + Math.sin(phase) * 1.5;
    y = targetY + Math.cos(phase) * 1.5;
  } else if (time < tapAt + 0.18) {
    const p = (time - tapAt) / 0.18;
    const pressP = p < 0.5 ? p * 2 : (1 - p) * 2;
    x = targetX;
    y = targetY + pressP * 14;
    scale = 1 - pressP * 0.08;
  } else if (time < leaveAt - 0.25) {
    x = targetX;
    y = targetY;
  } else {
    const p = ease.inCubic(Math.min(1, (time - (leaveAt - 0.25)) / 0.25));
    x = targetX + 30 * p;
    y = targetY + 60 * p;
    opacity = 1 - p;
    scale = 1 - 0.1 * p;
  }

  const [bx, by] = badgeOffset;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
      }}
    >
      <FingerPointer size={170} />
      <div style={{ position: 'absolute', left: bx, top: by }}>
        <StepBadge n={badgeN} size={104} />
      </div>
    </div>
  );
}

// ─── Caption strip ─────────────────────────────────────────────────
function Caption({
  step, label, start, end, time,
}: {
  step: number; label: string; start: number; end: number; time: number;
}) {
  if (time < start - 0.1 || time > end + 0.1) return null;
  const local = time - start;
  const sinceExit = time - (end - 0.3);
  let opacity = 1, dy = 0;
  if (local < 0.4) {
    const p = ease.outCubic(Math.max(0, local) / 0.4);
    opacity = p;
    dy = (1 - p) * 24;
  } else if (sinceExit > 0) {
    const p = Math.min(1, sinceExit / 0.3);
    opacity = 1 - p;
    dy = -p * 16;
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: 70,
        textAlign: 'center',
        opacity,
        transform: `translateY(${dy}px)`,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 18,
          padding: '20px 38px 20px 22px',
          background: 'rgba(20,20,24,0.92)',
          border: '1.5px solid rgba(255,255,255,0.08)',
          borderRadius: 999,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div
          style={{
            width: 56, height: 56,
            borderRadius: '50%',
            background: GG.red,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 28,
            fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '-0.02em',
          }}
        >
          {step}
        </div>
        <div
          style={{
            color: '#fff',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 600,
            fontSize: 36,
            letterSpacing: '-0.01em',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

// ─── Header chrome ─────────────────────────────────────────────────
function Header() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        top: 48,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 22,
          letterSpacing: '0.32em',
          fontWeight: 700,
          color: GG.red,
        }}
      >
        HOW TO INSTALL
      </div>
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 56,
          fontWeight: 800,
          color: '#fff',
          letterSpacing: '-0.025em',
        }}
      >
        Gun Galore{' '}
        <span style={{ color: GG.muted, fontWeight: 500 }}>on iPhone</span>
      </div>
    </div>
  );
}

// ─── Decorative red-glow backdrop ──────────────────────────────────
function Backdrop({ time }: { time: number }) {
  const drift = Math.sin(time * 0.5) * 30;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(225,29,42,0.16), transparent 70%), radial-gradient(ellipse 70% 50% at 50% 100%, rgba(225,29,42,0.10), transparent 70%), #0a0a0c',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 540 + drift,
          top: 960,
          width: 1200,
          height: 1200,
          transform: 'translate(-50%,-50%)',
          background:
            'radial-gradient(circle, rgba(225,29,42,0.10), transparent 60%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

// ─── Progress dots ─────────────────────────────────────────────────
function ProgressDots({ time }: { time: number }) {
  const active = Math.min(3, Math.floor(time / SCENE_DUR));
  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: 195,
        display: 'flex',
        justifyContent: 'center',
        gap: 18,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: i === active ? 80 : 18,
            height: 12,
            borderRadius: 6,
            background:
              i === active
                ? GG.red
                : i < active
                  ? 'rgba(225,29,42,0.45)'
                  : 'rgba(255,255,255,0.18)',
            transition: 'all 0.35s cubic-bezier(.4,0,.2,1)',
          }}
        />
      ))}
    </div>
  );
}

// ─── One scene wrapper ─────────────────────────────────────────────
function Scene({
  scene, index, offset, badgeOffset, time,
}: {
  scene: SceneDef; index: number;
  offset: [number, number];
  badgeOffset: [number, number];
  time: number;
}) {
  const start = index * SCENE_DUR;
  const end = start + SCENE_DUR;
  // Slight padding either side so the scene's exit/entry transitions
  // can run without flickering.
  if (time < start - 0.05 || time > end + 0.05) return null;

  const enterAt = start + 0.55;
  const settleAt = start + 1.55;
  const tapAt = start + 2.55;
  const leaveAt = end - 0.05;

  const tx = scene.target[0] + offset[0];
  const ty = scene.target[1] + offset[1];
  const [fx, fy] = FINGER_FROM;

  return (
    <>
      <PhoneShell
        x={PHONE_X} y={PHONE_Y} width={PHONE_W}
        sceneStart={start} sceneEnd={end} time={time}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={scene.img}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
          }}
        />
      </PhoneShell>

      <TargetHalo
        x={tx} y={ty}
        w={scene.haloW} h={scene.haloH}
        shape={scene.haloShape}
        start={settleAt - 0.3} end={leaveAt - 0.1}
        time={time}
      />

      <FingerToTarget
        fromX={fx} fromY={fy}
        targetX={tx} targetY={ty}
        enterAt={enterAt}
        settleAt={settleAt}
        tapAt={tapAt}
        leaveAt={leaveAt}
        badgeN={scene.n}
        badgeOffset={badgeOffset}
        time={time}
      />

      <TapRing x={tx} y={ty} tapAt={tapAt + 0.05} time={time} />

      <Caption
        step={scene.n}
        label={scene.label}
        start={start + 0.35}
        end={end - 0.25}
        time={time}
      />
    </>
  );
}

// ─── Top-level component ───────────────────────────────────────────
//
// Renders the fixed 1080×1920 stage and CSS-scales it down so the
// outer container can be any size. Pre-loads the 4 step screenshots
// up-front (so they don't pop in mid-scene), drives the playhead via
// requestAnimationFrame, and pauses the loop when the document is
// hidden (saves battery while the modal is offscreen).

export function InstallAnimation() {
  const [time, setTime] = useState(0);
  const [scale, setScale] = useState(0.3);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  // Auto-fit scaling — keeps the 1080×1920 stage perfectly contained.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      setScale(Math.min(w / STAGE_W, h / STAGE_H));
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pre-warm the screenshots so they don't blank-flash mid-loop.
  useEffect(() => {
    SCENES.forEach((s) => {
      const img = new Image();
      img.src = s.img;
    });
  }, []);

  // Playhead loop.
  useEffect(() => {
    function step(ts: number) {
      if (document.hidden) {
        // Reset the timestamp so dt doesn't jump when the tab returns.
        lastTsRef.current = null;
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        const next = t + dt;
        return next >= TOTAL ? next - TOTAL : next;
      });
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const sceneNodes = useMemo(
    () =>
      SCENES.map((s, i) => (
        <Scene
          key={i}
          scene={s}
          index={i}
          offset={SCENE_OFFSETS[i]}
          badgeOffset={BADGE_OFFSET}
          time={time}
        />
      )),
    [time],
  );

  return (
    <div
      ref={wrapperRef}
      aria-hidden  // decorative animation; the surrounding modal has the a11y text
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 16,
        background: '#0a0a0c',
        contain: 'strict' as const,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <Backdrop time={time} />
        <Header />
        {sceneNodes}
        <ProgressDots time={time} />
      </div>
    </div>
  );
}
