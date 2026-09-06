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
 * An absolute ceiling on the scale.
 *
 * ⚠️ NOT THE PROTOTYPE'S 6.2 ANY MORE, AND THAT IS THE POINT. The prototype
 * fixed 6.2 px/mm because it only ever drew 6,5 Creedmoor. Fixed, it fails at
 * both ends: the frame runs out at L6 ≈ 80.6 mm, so .30-06, .300 Win Mag,
 * .375 H&H and .338 Lapua drew their bullet past x = 560 and were silently
 * clipped; and a 9 mm Luger at 29.7 mm drew across a THIRD of the frame with
 * two-thirds of the box empty beside it.
 *
 * This ceiling exists only so a freak set of figures cannot magnify to
 * nonsense. The real limits are computed per cartridge in scaleFor().
 */
const S_MAX = 14;
/** Room for the tip's stroke and the L6 witness line at the right edge. */
const RIGHT_PAD = 12;

/**
 * The scale, fitted to the frame on all three axes.
 *
 * ⚠️ THE LENGTH IS NOT THE ONLY CONSTRAINT, WHICH IS WHY R1 IS AN ARGUMENT.
 * Fitting on length alone magnifies a short, fat pistol case until its rim
 * pushes the diameter stack off the top of the viewBox and the length ladder
 * off the bottom — labels that simply are not there, with nothing logged. The
 * two vertical budgets are the ladder below (the tighter of the two) and the
 * three-level stack above; the drawing takes whichever of the three allows
 * least.
 *
 * ⚠️ THIS DRAWING SCALES UP, THE THUMBNAIL DOES NOT, AND THE DIFFERENCE IS
 * DELIBERATE. A list of thumbnails is a comparison — a .223 and a .338 there
 * must not draw the same length — so `thumbOf()` keeps its never-scale-up
 * rule. The spec card shows exactly one cartridge, where relative size is not
 * information and an empty two-thirds of the frame is just a small drawing.
 */
function scaleFor(l6: number, r1: number): number {
  if (!(l6 > 0)) return S_MAX;
  const byLength = (VIEW_W - X0 - RIGHT_PAD) / l6;
  const half = r1 > 0 ? r1 / 2 : 0;
  if (half <= 0) return Math.min(S_MAX, byLength);
  /* Read inside the function, not at module scope: these pitches are declared
     below and a top-level const referencing them would be a temporal-dead-zone
     throw on import. */
  const ladder = LEN_GAP + 3 * LEN_PITCH + 6;
  const stack = DIA_GAP + 2 * DIA_LEVEL + 12;
  const byBelow = (VIEW_H - Y0 - ladder) / half;
  const byAbove = (Y0 - stack) / half;
  return Math.max(1, Math.min(S_MAX, byLength, byBelow, byAbove));
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

/* Follows the spec card's mm/inch toggle; fmtLength shows one unit only,
   because two per callout is what makes a drawing unreadable. */
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
    const s = scaleFor(dims.L6, dims.R1);
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

  /* Only offer the dimensions as pointer targets when the page can react:
     `.dim` sets a pointer cursor, and without a handler behind it that cursor
     is a promise the drawing cannot keep. */
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
              /**
               * ⚠️ NOT IN THE TAB ORDER, AND NOT A BUTTON. These nine groups
               * were `role="button" tabIndex={0}`, which put NINE tab stops
               * inside one drawing — and every one of them announced a figure
               * the Dimensions table underneath already carries as a real
               * button that lights the same letter. A keyboard or screen
               * reader user therefore lost nothing by their going and is
               * spared nine stops on the way past; the pointer affordance
               * they exist for is unaffected, and with no focusable
               * descendant `aria-hidden` here is legitimate rather than the
               * hidden-focus violation it would otherwise be.
               */
              aria-hidden="true"
              onMouseEnter={() => setHot(r.k)}
              onMouseLeave={() => setHot(null)}
              /* Tap is the mobile equivalent of hover, and it toggles so a
                 second tap can put the drawing back to neutral. */
              onClick={() => setHot(isHot ? null : r.k)}
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
          /**
           * ⚠️ THE ARC IS A TARGET NOW, NOT JUST A LIT MARK. The α row in the
           * table lights this arc, but the arc could not light the row — the
           * one dimension on the drawing whose link ran in a single
           * direction, on a card whose whole point is that the two agree.
           * `alpha` is accepted alongside `α` everywhere for a caller that
           * avoids a Greek letter in state, so the letter written here is the
           * one the table checks for.
           */
          <g
            className="dim"
            aria-hidden="true"
            onMouseEnter={() => setHot('α')}
            onMouseLeave={() => setHot(null)}
            onClick={() => setHot(alphaHot ? null : 'α')}
            style={interactive ? undefined : { pointerEvents: 'none' }}
          >
            {/* An invisible pad around the LETTER only: one glyph is a target
                nobody can hit, and a fill of `none` takes no pointer events at
                all. Kept off the arc itself — a pad wide enough to cover the
                arc would sit over the L1 rung of the length ladder below and
                steal its hover, and this group renders last. */}
            <rect
              x={(model.shoulder.x - 6).toFixed(1)}
              y={(model.shoulder.y - 13).toFixed(1)}
              width={22}
              height={18}
              fill="transparent"
            />
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
