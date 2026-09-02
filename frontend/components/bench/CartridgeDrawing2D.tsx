'use client';

/**
 * THE BENCH — the 2D cartridge drawing.
 *
 * A scale side view built entirely from the thirteen figures in `Dims`:
 * silhouette, centre axis, four stacked length dimensions below, five
 * diameter dimensions above on three levels, and the shoulder arc. Nothing
 * here is drawn by eye and nothing is tuned per cartridge — the same code
 * draws a 223 Rem. and a 6,5 Creedmoor correctly because the frame is a pure
 * function of the figures.
 *
 * ⚠️ THE LAYOUT ARITHMETIC IS PORTED, NOT RE-DERIVED. The pitches, gaps,
 * anchor nudges and the three-level stack below come straight from the design
 * prototype. Re-deriving them by eye produces labels that look fine on the
 * one cartridge you tested and collide on the next: the levels exist because
 * P1, P2 and H1 crowd together on a short case, and the R1 nudge exists
 * because a centred label at the case head runs off the left of the frame.
 *
 * Hovering (or focusing, or tapping) a dimension calls `onHotChange`; the
 * page hands the letter back as `hot`, which lights it here AND highlights
 * the matching row in the Dimensions table. Both directions run through the
 * page — this component never holds the hot letter itself, so the drawing and
 * the table can never disagree about which one is lit.
 */

import { useId, useMemo } from 'react';
import { canDraw, paths, type Dims, type Paths, fmtLength, type Units } from '@/lib/bench/geometry';
import { BULLET_FILL, BULLET_STROKE, CASE_FILL, CASE_STROKE } from './CartridgeThumb';
import type { CartridgeDrawing2DProps } from './contract';

/* ── The frame ───────────────────────────────────────────────────────
   Ported verbatim: a 560×250 viewBox at 6.2 px per millimetre, case head
   at x = 52, centre axis at y = 118. Every coordinate below is in that
   frame and never in rendered pixels, so the drawing survives being laid
   out at any width. */
const VIEW_W = 560;
const VIEW_H = 250;
const X0 = 52;
const Y0 = 118;

/**
 * The prototype's scale, and the most the drawing will ever use.
 *
 * ⚠️ 6.2 px/mm IS NOT SAFE FOR EVERY CARTRIDGE, WHICH THE PROTOTYPE COULD NOT
 * SHOW: it only ever drew 6,5 Creedmoor. At this scale the frame runs out at
 * L6 ≈ 80.6 mm, so .30-06, .300 Win Mag, 7mm Rem Mag, .375 H&H and .338 Lapua
 * all draw their bullet past x = 560 and are silently clipped — no error, just
 * a cartridge with no tip. These are ordinary cartridges, not exotics.
 *
 * So the scale is derived per cartridge and only ever shrinks. Anything that
 * already fits keeps 6.2 exactly, which is why 6,5 Creedmoor still renders
 * pixel-for-pixel as the prototype drew it.
 */
const S_MAX = 6.2;
/** Room for the tip's stroke and the L6 witness line at the right edge. */
const RIGHT_PAD = 12;

function scaleFor(l6: number): number {
  if (!(l6 > 0)) return S_MAX;
  return Math.min(S_MAX, (VIEW_W - X0 - RIGHT_PAD) / l6);
}

/** Pitch of the length ladder stacked below the drawing. */
const LEN_PITCH = 17;
/** Clearance from the widest point of the rim down to the first length line. */
const LEN_GAP = 30;
/** Clearance from the rim up to the first diameter label. */
const DIA_GAP = 14;
/** Rise per level in the three-level diameter stack. */
const DIA_LEVEL = 15;

/** SPEC §5.3: there is no `--font-mono` token and this file may not add one
    to globals.css, so the stack is repeated inline exactly as Load Lab does.
    Set once on the <svg> so every label inherits it. */
const MONO = "ui-monospace, 'Cascadia Mono', Consolas, monospace";

const GREY = 'var(--text-tertiary)';
const HOT = 'var(--red)';

type Anchor = 'start' | 'middle';

interface DimRow {
  /** The dimension letter — the shared key between drawing and table. */
  k: string;
  /** Extension line from the feature out to the dimension line. */
  e1: readonly [number, number, number, number];
  /** Second extension line. Degenerate on the diameters (the arrowed line
      already touches both walls); kept so the drawing emits the same nine
      groups the prototype does and a diff between them stays readable. */
  e2: readonly [number, number, number, number];
  /** The arrowed dimension line. */
  m: readonly [number, number, number, number];
  tx: number;
  ty: number;
  ta: Anchor;
  text: string;
}

/**
 * ⚠️ MILLIMETRES, ALWAYS.
 *
 * `CartridgeDrawing2DProps` carries no `units`, so the drawing cannot follow
 * the card's mm/inch control and shows the metric figure the backend stores.
 * That is the site's primary unit, so it is the right thing to be stuck on —
 * but it IS stuck. See the handoff note: the fix is one word,
 * `extends UnitProps` on the interface.
 */
// Follows the spec card's mm/inch toggle; fmtLength shows one unit only,
// because two per callout is what makes a drawing unreadable.
const label = (v: number, units: Units) => fmtLength(v, units);

/** The nine dimension annotations, in the order the drawing stacks them. */
function buildRows(D: Dims, px: Paths['px'], py: Paths['py'], s: number, units: Units): DimRow[] {
  const rows: DimRow[] = [];

  /* Lengths, below. All four are measured from the case head, so they read
     as one ladder growing downward rather than four unrelated spans. */
  const lengths: [string, number][] = [
    ['L1', D.L1],
    ['L2', D.L2],
    ['L3', D.L3],
    ['L6', D.L6],
  ];
  lengths.forEach(([k, v], i) => {
    const y = Y0 + (D.R1 / 2) * s + LEN_GAP + i * LEN_PITCH;
    rows.push({
      k,
      e1: [px(0), py(-D.R1 / 2) + 2, px(0), y + 4],
      e2: [px(v), Y0 + 2, px(v), y + 4],
      m: [px(0), y, px(v), y],
      tx: px(v / 2),
      ty: y - 3,
      ta: 'middle',
      text: `${k} = ${label(v, units)}`,
    });
  });

  /* Diameters, above. The second number is where along the axis the callipers
     would sit to read that diameter — offset off the feature itself (P1 at
     E + 3, H1 at L2 + 3.5) so the line crosses solid wall rather than the
     transition it names. `level` staggers the labels over three heights. */
  const diameters: [string, number, number][] = [
    ['R1', 0.6, D.R1],
    ['P1', D.E + 3, D.P1],
    ['P2', D.L1, D.P2],
    ['H1', D.L2 + 3.5, D.H1],
    ['G1', D.L3 + 3, D.G1],
  ];
  const level = [0, 1, 2, 0, 1];
  diameters.forEach(([k, at, d], i) => {
    const xx = px(at);
    const top = py(d / 2);
    const bot = py(-d / 2);
    const ty = py(D.R1 / 2) - DIA_GAP - level[i] * DIA_LEVEL;
    rows.push({
      k,
      e1: [xx, top, xx, ty + 3],
      e2: [xx, top, xx, top],
      m: [xx, top, xx, bot],
      /* R1 alone is left-anchored and nudged 3 px clear: it sits at the very
         head of the case, where a centred label overhangs the frame. */
      tx: xx + (i === 0 ? 3 : 0),
      ty,
      ta: i === 0 ? 'start' : 'middle',
      text: `${k} = ${label(d, units)}`,
    });
  });

  return rows;
}

interface Shoulder {
  d: string;
  x: number;
  y: number;
  text: string;
}

/**
 * The shoulder arc and its leader letter.
 *
 * ⚠️ THE ARC IS DRAWN, THE ANGLE IS NOT PRINTED. `Dims` carries thirteen
 * figures and α is not one of them, so no angle reaches this component — and
 * the props may not be widened to fetch one. An earlier draft derived a
 * figure from the drawn profile (the included angle of the run from
 * (L1, P2/2) to (L2, H1/2)) and printed it as `α = 46°`. That is a shoulder
 * angle a reloader sets dies by, and it was computed here rather than read
 * from the sheet: on a neck diameter taken at a slightly different station it
 * lands a degree or two off, and it sat on the same screen as the Dimensions
 * table's α row, which prints the real figure. Two numbers for one quantity,
 * one of them invented.
 *
 * So the arc carries the LETTER only. It points at the shoulder and lights
 * with the α row (SpecCard passes `hot`); the value belongs to that row,
 * which has it from the data.
 */
function shoulderOf(D: Dims, px: Paths['px'], py: Paths['py']): Shoulder | null {
  const run = D.L2 - D.L1;
  const rise = (D.P2 - D.H1) / 2;
  /* A straight-walled case has no shoulder, and without this guard the arc
     still draws, pointing at a vertex that does not exist. */
  if (!(run > 0) || !(rise > 0)) return null;

  return {
    d:
      `M ${px(D.L1 + 8).toFixed(1)} ${py(-D.P2 / 2 - 4).toFixed(1)}` +
      ` A 16 16 0 0 1 ${px(D.L1 + 1.5).toFixed(1)} ${py(-D.P2 / 2 - 0.8).toFixed(1)}`,
    x: px(D.L1 + 10),
    y: py(-D.P2 / 2 - 3),
    text: 'α',
  };
}

/* Named and default, for the same reason as CartridgeThumb: the spec card is
   being written alongside this file and either import style has to compile. */
export function CartridgeDrawing2D({
  dims,
  units,
  hot,
  onHotChange,
  animate,
}: CartridgeDrawing2DProps) {
  /* Two instances can share a page (the spec card over a results list that
     already shows a thumbnail, and the phase-2 overlay comparison), so the
     arrowhead markers are namespaced. React's ids contain colons, which are
     legal in a URL fragment but trip anything that later treats the
     reference as a selector — strip them rather than find out. */
  const raw = useId();
  const uid = raw.replace(/[^A-Za-z0-9_-]/g, '');
  const arrow = `bench-ar-${uid}`;
  const arrowHot = `bench-arh-${uid}`;

  const model = useMemo(() => {
    /* ⚠️ ALL THIRTEEN OR NOTHING — see CartridgeThumb. The prop is typed
       `Dims`, but these figures reach the page as a loose record from the
       API, so a hole here is a runtime possibility rather than a compile
       one. A partial set renders a plausible, wrong cartridge; the spec
       card's text fallback is the correct outcome instead. */
    if (!canDraw(dims)) return null;
    const s = scaleFor(dims.L6);
    const p = paths(dims, s, X0, Y0);
    return {
      casePath: p.casePath,
      bulletPath: p.bulletPath,
      ax0: p.px(-3),
      ax1: p.px(dims.L6 + 4),
      rows: buildRows(dims, p.px, p.py, s, units),
      shoulder: shoulderOf(dims, p.px, p.py),
    };
  }, [dims, units]);

  if (!model) return null;

  /* Only offer the dimensions as controls when the page can actually react.
     bench.css styles :focus-visible for the shared controls and not for
     `.dim`, so the lit letter IS the focus indicator here — which means a tab
     stop with no `onHotChange` behind it would be a stop that shows the
     keyboard user nothing. */
  const interactive = typeof onHotChange === 'function';
  const setHot = (k: string | null) => onHotChange?.(k);

  /* The silhouette lands first and the dimension web resolves onto it — the
     same rhythm as the load card's chart. `animate={false}` on a re-render
     keeps the annotations put instead of replaying the fade every time the
     card's state changes. `.late` collapses to 1 ms under
     prefers-reduced-motion, and if the class does not resolve the layer is
     simply visible, which is the safe direction to fail in. */
  const annotations = animate === false ? undefined : 'late';

  /* The table lists the shoulder angle as α; accept the spelled key too so a
     caller that avoids a Greek letter in state still lights the arc. */
  const alphaHot = hot === 'α' || hot === 'alpha';

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={VIEW_W}
      height={VIEW_H}
      role="group"
      aria-label="Scale drawing of the cartridge with its dimension letters"
      style={{ display: 'block', width: '100%', height: 'auto', fontFamily: MONO }}
    >
      <defs>
        {/* `auto-start-reverse` is what lets one marker serve both ends of a
            dimension line, pointing outward at each. */}
        <marker
          id={arrow}
          viewBox="0 0 6 6"
          refX="3"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0L6 3L0 6z" style={{ fill: GREY }} />
        </marker>
        <marker
          id={arrowHot}
          viewBox="0 0 6 6"
          refX="3"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0L6 3L0 6z" style={{ fill: HOT }} />
        </marker>
      </defs>

      {/* Case and bullet are two closed paths rather than one so they can
          carry brass and copper; the split is at the neck/bullet junction. */}
      <path
        d={model.casePath}
        strokeWidth={0.7}
        style={{ fill: CASE_FILL, stroke: CASE_STROKE }}
        aria-hidden="true"
      />
      <path
        d={model.bulletPath}
        strokeWidth={0.7}
        style={{ fill: BULLET_FILL, stroke: BULLET_STROKE }}
        aria-hidden="true"
      />

      {/* Centre axis: chain-dashed, the drawing convention for an axis of
          revolution, and it runs past both ends of the round. */}
      <line
        x1={model.ax0.toFixed(1)}
        x2={model.ax1.toFixed(1)}
        y1={Y0}
        y2={Y0}
        strokeWidth={0.7}
        strokeDasharray="8 3 1.5 3"
        style={{ stroke: 'var(--text-faint)' }}
        aria-hidden="true"
      />

      <g className={annotations}>
        {model.rows.map((r) => {
          const isHot = hot === r.k;
          const c = isHot ? HOT : GREY;
          const mk = `url(#${isHot ? arrowHot : arrow})`;
          return (
            <g
              key={r.k}
              className="dim"
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? r.text : undefined}
              aria-pressed={interactive ? isHot : undefined}
              onMouseEnter={() => setHot(r.k)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => setHot(r.k)}
              onBlur={() => setHot(null)}
              /* Tap is the mobile equivalent of hover, and it toggles so a
                 second tap can put the drawing back to neutral. */
              onClick={() => setHot(isHot ? null : r.k)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setHot(isHot ? null : r.k);
                }
              }}
              /* `.dim` sets a pointer cursor; without a handler behind it
                 that cursor is a promise the drawing cannot keep. */
              style={interactive ? undefined : { pointerEvents: 'none' }}
            >
              <line
                x1={r.e1[0].toFixed(1)}
                y1={r.e1[1].toFixed(1)}
                x2={r.e1[2].toFixed(1)}
                y2={r.e1[3].toFixed(1)}
                strokeWidth={0.7}
                strokeDasharray="2 2"
                style={{ stroke: c }}
              />
              <line
                x1={r.e2[0].toFixed(1)}
                y1={r.e2[1].toFixed(1)}
                x2={r.e2[2].toFixed(1)}
                y2={r.e2[3].toFixed(1)}
                strokeWidth={0.7}
                strokeDasharray="2 2"
                style={{ stroke: c }}
              />
              <line
                x1={r.m[0].toFixed(1)}
                y1={r.m[1].toFixed(1)}
                x2={r.m[2].toFixed(1)}
                y2={r.m[3].toFixed(1)}
                strokeWidth={isHot ? 1.5 : 0.9}
                markerStart={mk}
                markerEnd={mk}
                style={{ stroke: c }}
              />
              <text
                className="num"
                x={r.tx.toFixed(1)}
                y={r.ty.toFixed(1)}
                textAnchor={r.ta}
                fontSize={10}
                fontWeight={isHot ? 600 : 400}
                style={{ fill: c }}
              >
                {r.text}
              </text>
            </g>
          );
        })}

        {model.shoulder ? (
          <g aria-hidden="true">
            <path
              d={model.shoulder.d}
              fill="none"
              strokeWidth={0.9}
              style={{ stroke: alphaHot ? HOT : GREY }}
            />
            <text
              className="num"
              x={model.shoulder.x.toFixed(1)}
              y={model.shoulder.y.toFixed(1)}
              fontSize={10}
              fontWeight={alphaHot ? 600 : 400}
              style={{ fill: alphaHot ? HOT : GREY }}
            >
              {model.shoulder.text}
            </text>
          </g>
        ) : null}
      </g>
    </svg>
  );
}

export default CartridgeDrawing2D;
