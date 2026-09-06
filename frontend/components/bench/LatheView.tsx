'use client';

/**
 * THE BENCH — the 3D lathe view.
 *
 * A solid of revolution built from the SAME half-profile the 2D drawing uses
 * (`profile()` in lib/bench/geometry), so the 3D model and the 2D drawing can
 * never disagree: there is one silhouette in the module and both views revolve
 * or stroke it.
 *
 * ⚠️ three.js IS LOADED WITH A DYNAMIC import() INSIDE THE EFFECT, NEVER AT
 * MODULE SCOPE. A static import would pull ~600 kB of renderer into the main
 * bundle for every member who opens /bench and never touches 3D. The import
 * therefore happens on mount of this component, which SpecCard only mounts on
 * the first switch to the 3D or Half section view.
 *
 * ⚠️ THE PROTOTYPE'S CANVAS-2D PAINTER IS NOT PORTED. It exists only because
 * the design sandbox blocks script hosts. What IS ported verbatim is the
 * BEHAVIOUR and every tuned constant: the idle spin rate, the drag gains, the
 * tilt clamp, the station table, the 1.3 mm snap, the 26 px ring grab, and the
 * illustrative interior. Those numbers were chosen against a real drawing;
 * re-deriving them by eye produces a model that looks plausible and measures
 * wrong.
 *
 * COPY: nothing here names where a figure comes from — no "manual", no "CIP",
 * no "SAAMI", no counts. Letters (L3, G1, Pmax) are dimension names, not
 * provenance.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LatheViewProps } from '@/components/bench/contract';
import { DIM_KEYS, fmtLength, profile, type Dims, type Point, type Units } from '@/lib/bench/geometry';
import { Btn, usePhone } from './primitives';

/* ── Ported constants ───────────────────────────────────────────────────
   Every one of these is the prototype's, in the prototype's units. The
   pointer maths runs in a VIRTUAL 1120×560 space (the prototype's canvas
   backing store) so that the px-denominated gains below keep meaning the
   same thing whatever the real element size or device pixel ratio is. */
const VIRT_W = 1120;
const VIRT_H = 560;
/** The prototype's weak perspective, `k = 1 / (1 − Z/900)`: the eye sits 900 mm out. */
const CAM_DIST = 900;
/** The model spans 1/1.32 of the viewport width, as `S = W / (L6 * 1.32)`. */
const FIT = 1.32;
const FRAME_MS = 1000 / 60;
/** Idle spin: 0.012 rad per 60 fps frame ≈ 0.72 rad/s (SPEC §6.3). */
const IDLE_SPIN = 0.012;
const SPIN_CLAMP = 0.05;
/** Per-frame pull of the flick velocity back to the idle rate (~1.5 s settle). */
const SPIN_EASE = 0.015;
const TILT_MAX = 0.5;
const SPIN_PER_PX = 0.012;
const TILT_PER_PX = 0.004;
const FLICK_PER_PX = 0.004;
/** How near the ring a pointer-down counts as grabbing it rather than spinning. */
const GRAB_PX = 26;
/**
 * The same band, floored in REAL pixels.
 *
 * ⚠️ GRAB_PX IS IN THE VIRTUAL 1120-WIDE SPACE, NOT ON THE SCREEN. On a 1120px
 * desktop canvas the two agree; on a 360px phone the band is 26 × 360/1120 ≈
 * 8 real pixels — a third of a fingertip, so the ring could not be grabbed at
 * all and every attempt spun the model instead. 22 px is the floor the band is
 * widened to in virtual units whenever the canvas is drawn smaller than that.
 */
const GRAB_MIN_PX = 22;
/** The tilt the model rests at, and the amplitude it breathes through. */
const TILT_REST = 0.28;
const TILT_SWING = 0.12;
/** One full breath of the resting tilt. */
const TILT_PERIOD_MS = 6000;
/** Within this the calliper snaps to a station. */
const SNAP_MM = 1.3;
const SEGMENTS = 96;
const HATCH_MM = 0.85;
const CONE_H = 0.85;
const CONE_R = 0.3;

/* ── Pure geometry, ported from `drawLathe()` and friends ───────────── */

interface Station {
  k: string;
  mm: number;
  /** A diameter station reads Ø at that point; a length station reads the length. */
  dia: boolean;
}

/**
 * The measuring stations along the axis.
 *
 * ⚠️ THESE OFFSETS ARE NOT THE C.I.P. ORDINATES. R1 is read 0.7 mm up from the
 * head, not at 0, because at exactly 0 the profile has zero radius; E1 is read
 * 1.4 mm back from the end of the groove, and so on. Each one is a point where
 * the silhouette is FLAT, so the ring measures the figure the table prints
 * rather than a value part-way up a taper.
 */
function stations(D: Dims): Station[] {
  return [
    { k: 'R1', mm: 0.7, dia: true },
    { k: 'E1', mm: D.E - 1.4, dia: true },
    { k: 'P1', mm: D.E + 3, dia: true },
    { k: 'P2', mm: D.L1 - 0.8, dia: true },
    { k: 'H1', mm: D.L2 + 3.5, dia: true },
    { k: 'H2', mm: D.L3 - 0.6, dia: true },
    { k: 'G1', mm: D.L3 + 3, dia: true },
    { k: 'L1', mm: D.L1, dia: false },
    { k: 'L2', mm: D.L2, dia: false },
    { k: 'L3', mm: D.L3, dia: false },
    { k: 'L6', mm: D.L6, dia: false },
  ];
}

/** Radius of the silhouette at x, by linear interpolation between vertices. */
function radiusAt(P: Point[], x: number): number {
  for (let i = 1; i < P.length; i++) {
    if (P[i][0] >= x) {
      const x0 = P[i - 1][0];
      const r0 = P[i - 1][1];
      const x1 = P[i][0];
      const r1 = P[i][1];
      return x1 === x0 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (x - x0)) / (x1 - x0);
    }
  }
  return 0;
}

/**
 * The half section's interior.
 *
 * ⚠️ ILLUSTRATIVE, AND DELIBERATELY SO. No interior figure is a standard one:
 * the web, the pocket, the flash hole and the wall taper are drawn so the cut
 * reads as a case rather than a tube. Only the OUTER profile is dimensioned,
 * which is why nothing in here is ever labelled or measured by the calliper.
 */
function innerProfile(D: Dims): { pts: Point[]; seat: number } | null {
  const P = profile(D);
  /**
   * ⚠️ THE WEB AND THE SEAT ARE CLAMPED, AND THE SECTION IS SKIPPED IF THEY
   * STILL MEET.
   *
   * The prototype's figures are a rifle case's: a solid web to `E + 4.2` and
   * the bullet seated 7 mm into the neck. On a short pistol case — anything
   * with `L3 < E + 11.2` — the seat lands BEHIND the web, so the interior
   * polygon runs backwards, the cut face becomes a self-intersecting shape,
   * and the hatch scanline fills it in stripes that cross the case wall. It
   * renders; it is just not a case.
   *
   * Clamped, a short case gets a shallower web and a shallower seat, both in
   * proportion. Anything still degenerate after that — a case so short the
   * primer pocket alone would fill it — returns null and the caller draws the
   * solid uncut rather than a wrong interior.
   */
  const web = Math.min(D.E + 4.2, D.L3 * 0.45);
  const seat = Math.max(D.L3 - 7, web + 1.5);
  /* 3.2 is the primer pocket's own depth: a web behind it is not a web. */
  if (!(web > 3.2) || !(seat > web) || !(seat < D.L3)) return null;
  const pts: Point[] = [
    [0, 0],
    [0, 2.7],
    [3.2, 2.7],
    [3.2, 0.95],
    [web, 0.95],
  ];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const x = web + ((seat - web) * i) / n;
    const t = i / n;
    const wall = 0.75 - 0.42 * t;
    pts.push([x, Math.max(0.6, radiusAt(P, x) - wall)]);
  }
  pts.push([seat, D.G1 / 2]);
  return { pts, seat };
}

/** Index of the neck/bullet junction — the vertex at (L3, G1/2). */
function junction(P: Point[], D: Dims): number {
  for (let i = 0; i < P.length; i++) {
    if (P[i][0] === D.L3 && P[i][1] === D.G1 / 2) return i;
  }
  return P.length - 1;
}

interface DimSpec {
  k: keyof Dims;
  kind: 'len' | 'dia';
  /** Length dims run 0 → val at y; diameter dims run +val/2 → −val/2 at x. */
  x: number;
  val: number;
  y: number;
  /** R1 is the only left-aligned label — it would otherwise sit off the head. */
  left: boolean;
}

/**
 * ⚠️ THE LABEL TEXT IS NOT ON THE SPEC, DELIBERATELY.
 *
 * It used to be, and adding `units` then made `dimSpecs()` unit-dependent —
 * which made `specs` a new array on every flip of the mm/inch control, which
 * is a dependency of the scene effect, which would tear down and rebuild the
 * WebGL context to change nine strings. The geometry here is unit-free; the
 * text is composed in the JSX where the label actually renders.
 */

/**
 * The dimension set drawn in 3D, with the prototype's stacking levels.
 *
 * Lengths go below the model at a 2.9 mm pitch, diameters above on three
 * levels so the leaders never cross. Both the lines and the HTML labels are
 * built from this one list — two lists would drift the moment a level changed.
 */
function dimSpecs(D: Dims): DimSpec[] {
  const out: DimSpec[] = [];
  const lens: (keyof Dims)[] = ['L1', 'L2', 'L3', 'L6'];
  lens.forEach((k, i) => {
    out.push({
      k,
      kind: 'len',
      x: 0,
      val: D[k],
      y: -(D.R1 / 2) - 5 - i * 2.9,
      left: false,
    });
  });
  const dia: [keyof Dims, number][] = [
    ['R1', 0.7],
    ['P1', D.E + 3],
    ['P2', D.L1],
    ['H1', D.L2 + 3.5],
    ['G1', D.L3 + 3],
  ];
  const lvl = [0, 1, 2, 0, 1];
  dia.forEach(([k, x], i) => {
    out.push({
      k,
      kind: 'dia',
      x,
      val: D[k],
      y: D.R1 / 2 + 2.4 + lvl[i] * 2.6,
      left: i === 0,
    });
  });
  return out;
}

/**
 * Clamp, snap and round a calliper position.
 *
 * The rounding to a tenth is not cosmetic: it is the slider's step, and it
 * caps how often a pointer drag can push new text into React.
 */
function snapCal(D: Dims, mm: number): { mm: number; letter: string | null } {
  const v = Math.max(0, Math.min(D.L6, mm));
  let best = SNAP_MM;
  let hit: Station | null = null;
  for (const s of stations(D)) {
    const d = Math.abs(s.mm - v);
    if (d < best) {
      best = d;
      hit = s;
    }
  }
  if (hit) return { mm: hit.mm, letter: hit.k };
  return { mm: Math.round(v * 10) / 10, letter: null };
}

/**
 * Where the modelled nose begins — the last vertex still at full bullet
 * diameter.
 *
 * ⚠️ PAST THIS POINT THE SILHOUETTE IS A CURVE `profile()` INVENTS, not a run
 * of vertices off the figures, so a diameter read there is a number nothing
 * ever stated. The ring may still travel over the nose — the distance along
 * the axis is real — but the readout must not put a Ø on it. Found from the
 * profile rather than re-typed from geometry.ts so the two cannot drift.
 */
function noseStart(P: Point[], D: Dims): number {
  let x = D.L3;
  for (const p of P) {
    if (p[1] === D.G1 / 2 && p[0] > x) x = p[0];
  }
  return x;
}

/**
 * The calliper readout.
 *
 * ⚠️ EVERY FIGURE GOES THROUGH fmtLength, INCLUDING THE DISTANCE FROM THE
 * HEAD. This whole component printed `mm` regardless of the card's mm/inch
 * control, so a member reading the table in inches got a 3D view answering in
 * millimetres — two units for one quantity on one screen. The distance was the
 * easy one to miss: it is not a dimension off the sheet, it is where the ring
 * happens to be, and it still has to be in the unit they chose.
 */
function readoutOf(
  D: Dims,
  P: Point[],
  cal: number | null,
  snap: string | null,
  units: Units,
): { title: string; sub: string } | null {
  if (cal === null) return null;
  const from = `${fmtLength(cal, units)} from the head`;
  if (snap) {
    const st = stations(D).find((s) => s.k === snap);
    if (st && st.dia) {
      return {
        title: `${st.k} = ${fmtLength(D[st.k as keyof Dims], units)}`,
        sub: from,
      };
    }
    return { title: `${snap} = ${fmtLength(cal, units)}`, sub: 'from the head' };
  }
  /* No station under the ring, and the ring is on the nose: give the distance
     and say why there is no diameter, rather than printing a modelled one. */
  if (cal > noseStart(P, D)) {
    return {
      title: from,
      sub: 'The nose curve is illustrative.',
    };
  }
  return {
    title: `Ø ${fmtLength(radiusAt(P, cal) * 2, units)}`,
    sub: from,
  };
}

/**
 * 45° section hatch, clipped to a polygon by even–odd scanline.
 *
 * Cheaper and steadier than a texture: the lines are real geometry in the cut
 * plane, so they turn with the tilt instead of swimming across the face.
 */
function hatchSegments(poly: Point[], pitch: number): number[] {
  const a = Math.PI / 4;
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const s = nx * p[0] + ny * p[1];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const out: number[] = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return out;
  for (let s = Math.ceil(lo / pitch) * pitch; s < hi; s += pitch) {
    const cuts: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i];
      const B = poly[(i + 1) % poly.length];
      const sa = nx * A[0] + ny * A[1] - s;
      const sb = nx * B[0] + ny * B[1] - s;
      if (sa > 0 === sb > 0) continue;
      const t = sa / (sa - sb);
      const px = A[0] + (B[0] - A[0]) * t;
      const py = A[1] + (B[1] - A[1]) * t;
      cuts.push(dx * px + dy * py);
    }
    cuts.sort((m, n) => m - n);
    for (let j = 0; j + 1 < cuts.length; j += 2) {
      out.push(
        s * nx + cuts[j] * dx,
        s * ny + cuts[j] * dy,
        0.05,
        s * nx + cuts[j + 1] * dx,
        s * ny + cuts[j + 1] * dy,
        0.05,
      );
    }
  }
  return out;
}

/* ── Colour ─────────────────────────────────────────────────────────────
   ⚠️ NO RAW HEX, AND THAT INCLUDES THE METAL. three.js wants numbers, the
   house rule wants tokens, so every colour below is a CSS expression resolved
   in the browser through a probe element and handed to THREE.Color. Brass and
   copper have no token of their own yet, so they are MIXED from ones that do
   and left overridable: define --bench-brass / --bench-copper in bench.css and
   this picks them up with no change here. Never concatenate alpha onto a
   var() — `var(--red)18` computes to transparent. */
const BRASS = 'var(--bench-brass, color-mix(in srgb, var(--gold-tag-fill) 82%, var(--text-faint)))';
const COPPER = 'var(--bench-copper, color-mix(in srgb, var(--gold) 70%, var(--hot)))';
const BRASS_CUT = `color-mix(in srgb, ${BRASS} 62%, var(--bg-card))`;
const BRASS_INNER = `color-mix(in srgb, ${BRASS} 68%, var(--text-tertiary))`;
const BRASS_EDGE = `color-mix(in srgb, var(--gold) 72%, var(--text-primary))`;
const COPPER_CUT = `color-mix(in srgb, ${COPPER} 72%, var(--bg-card))`;
const COPPER_EDGE = `color-mix(in srgb, ${COPPER} 60%, var(--text-primary))`;

/** Mutable per-frame state. Kept off React on purpose — 60 fps of setState is a bug. */
interface Ctl {
  half: boolean;
  showDims: boolean;
  cal: number | null;
  snap: string | null;
  /** The letter the TABLE is hovering, which lights the model while it lasts. */
  hot: string | null;
  psi: number;
  phi: number;
  vel: number;
  auto: boolean;
  /** True once the member has tilted it themselves — the resting sway stops for good. */
  tilted: boolean;
  drag: 'spin' | 'cal' | null;
  lx: number;
  ly: number;
}

type Paintable = { material: unknown };
type Disposable = { dispose: () => void };

export default function LatheView({
  dims,
  halfSection,
  units,
  hot,
  onHotChange,
  name,
  slug,
  onToast,
}: LatheViewProps) {
  const phone = usePhone();
  /* A parent that rebuilds an equal-but-new dims object must not tear down the
     WebGL context, so the scene is keyed on the FIGURES, not the reference. */
  const sig = DIM_KEYS.map((k) => dims[k]).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const D = useMemo(() => dims, [sig]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const ctl = useRef<Ctl>({
    half: false,
    showDims: true,
    cal: null,
    snap: null,
    hot: null,
    psi: 0.6,
    phi: TILT_REST,
    vel: IDLE_SPIN,
    auto: true,
    tilted: false,
    drag: null,
    lx: 0,
    ly: 0,
  });
  /**
   * "Show all", assigned once the scene exists.
   *
   * ⚠️ A REF, NOT STATE. The button has to reach into the renderer — freeze
   * the pose, force one render and read the drawing buffer — and everything
   * that can do that is closed over inside the scene effect. Hoisting the
   * renderer into React state instead would put a live GL context in a
   * dependency array.
   */
  const showAllRef = useRef<(() => void) | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * SPEC §9: `aria-label="3D view of <name>; use the slider to measure"`.
   *
   * ⚠️ THE NAME ARRIVES AFTER THE CANVAS DOES. The card mounts this view from
   * data it already holds and the cartridge's own record can still be in
   * flight, so the label is written imperatively when the canvas is built AND
   * again whenever the name changes — a dependency on `name` in the scene
   * effect would tear down the GL context to change a string.
   */
  const canvasLabel = name
    ? `Three-dimensional view of ${name}. Use the calliper slider to measure.`
    : 'Three-dimensional view of the cartridge. Use the calliper slider to measure.';
  const canvasLabelRef = useRef(canvasLabel);
  useEffect(() => {
    canvasLabelRef.current = canvasLabel;
    glCanvasRef.current?.setAttribute('aria-label', canvasLabel);
  }, [canvasLabel]);

  /* What the snapshot needs, kept out of the scene effect's dependencies: a
     unit flip or a name arriving must not rebuild a WebGL context. */
  const exportRef = useRef({ units, name, slug });
  useEffect(() => {
    exportRef.current = { units, name, slug };
  }, [units, name, slug]);
  const onToastRef = useRef(onToast);
  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  const [failed, setFailed] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [cal, setCal] = useState<number | null>(null);
  const [snap, setSnap] = useState<string | null>(null);

  const P = useMemo(() => profile(D), [D]);
  const specs = useMemo(() => dimSpecs(D), [D]);
  const readout = useMemo(() => readoutOf(D, P, cal, snap, units), [D, P, cal, snap, units]);

  const calText =
    cal === null
      ? 'Slide to measure'
      : `${snap ? `${snap} · ` : ''}${fmtLength(cal, units)} from the head`;

  /* The snap writes the hot letter out to the card, and the card's own hover
     writes back in — so the callback must not be a dependency of anything that
     re-binds the pointer handlers. */
  const onHotRef = useRef(onHotChange);
  useEffect(() => {
    onHotRef.current = onHotChange;
  }, [onHotChange]);

  /**
   * One writer for the calliper, shared by the slider and the ring drag.
   *
   * ⚠️ IT ALSO SETS THE TABLE'S HOT LETTER (SPEC §6.3: "the letter is set hot
   * so the table row highlights"). Snapping to P2 and having the P2 row stay
   * grey was the calliper's only promise the card did not keep. Clearing the
   * calliper clears it again — a letter left lit by a measurement that is no
   * longer on screen points at nothing.
   */
  const applyCal = useCallback(
    (mm: number | null) => {
      const c = ctl.current;
      if (mm === null) {
        c.cal = null;
        c.snap = null;
        setCal(null);
        setSnap(null);
        onHotRef.current?.(null);
        return;
      }
      const s = snapCal(D, mm);
      c.cal = s.mm;
      c.snap = s.letter;
      setCal(s.mm);
      setSnap(s.letter);
      onHotRef.current?.(s.letter);
    },
    [D],
  );

  /* The pointer handlers live inside the scene effect and must not re-bind
     when this callback's identity changes, so they reach it through a ref. */
  const applyCalRef = useRef(applyCal);
  useEffect(() => {
    applyCalRef.current = applyCal;
  }, [applyCal]);

  useEffect(() => {
    ctl.current.half = halfSection;
  }, [halfSection]);

  useEffect(() => {
    ctl.current.showDims = showDims;
  }, [showDims]);

  /* The letter the table is hovering. The frame loop reads it and lights the
     matching dimension; the calliper's own snap still takes precedence. */
  useEffect(() => {
    ctl.current.hot = hot ?? null;
  }, [hot]);

  /* A new cartridge invalidates the measurement — a ring left at 37.8 mm on a
     different case is a wrong reading, not a stale one. */
  useEffect(() => {
    applyCal(null);
  }, [applyCal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !(D.L6 > 0)) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      let mod: typeof import('three') | null = null;
      try {
        mod = await import('three');
      } catch {
        setFailed(true);
        return;
      }
      if (!mod || disposed) return;
      const THREE = mod;
      /* ⚠️ NOTHING BELOW THIS LINE MAY await. Everything after the import runs
         synchronously, which is the only reason the `disposed` check above is
         sufficient: hand back to the event loop once more and the effect's
         cleanup could run between the check and `cleanup` being assigned,
         stranding a live GL context. */

      /* ── Colour probe ──────────────────────────────────────────────
         getComputedStyle resolves color-mix() and var() on `color`; a
         custom property would come back as the unresolved expression. */
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText =
        'position:absolute;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none';
      host.appendChild(probe);
      /* The fallback is written FIRST and deliberately: an expression the
         browser rejects leaves `color` untouched, so without one a missing
         color-mix() would paint the metal whatever was there last. */
      const col = (expr: string, fallback = 'var(--text-tertiary)') => {
        probe.style.color = fallback;
        probe.style.color = expr;
        const s = getComputedStyle(probe).color;
        /* Safari can serialise a color-mix result as color(srgb r g b), which
           THREE.Color cannot parse — it would warn and hand back white. */
        const m = s.match(/^color\(srgb\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
        if (m) {
          return new THREE.Color().setRGB(
            Number(m[1]),
            Number(m[2]),
            Number(m[3]),
            THREE.SRGBColorSpace,
          );
        }
        try {
          return new THREE.Color(s);
        } catch {
          return new THREE.Color(1, 1, 1);
        }
      };

      let made: import('three').WebGLRenderer | null = null;
      try {
        /**
         * ⚠️ preserveDrawingBuffer IS FOR "Show all", NOT FOR THE VIEW.
         * Without it the colour buffer is undefined the moment the browser
         * composites, and the snapshot came back blank or black on some
         * drivers even though it is taken in the same task as the render. It
         * costs an extra buffer copy per frame; a spec card that exports a
         * dimensioned PNG is worth it.
         */
        made = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
        });
      } catch {
        made = null;
      }
      if (!made) {
        /* No WebGL. Render nothing and let the card fall back to the drawing. */
        if (probe.parentNode) probe.parentNode.removeChild(probe);
        setFailed(true);
        return;
      }
      const renderer = made;
      if (disposed) {
        renderer.dispose();
        if (probe.parentNode) probe.parentNode.removeChild(probe);
        return;
      }

      /* The half section is a clipping plane, not a second geometry. */
      renderer.localClippingEnabled = true;

      const canvas = renderer.domElement;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      /**
       * ⚠️ pan-y, NOT none.
       *
       * `touch-action: none` on a canvas that fills half a phone screen means
       * the page cannot be scrolled from anywhere over the model — the member
       * is stuck on the spec card's drawing with the whole table below it out
       * of reach. pan-y hands vertical gestures back to the browser and keeps
       * horizontal ones, which is all the model needs: spin is horizontal and
       * so is the calliper's travel along the axis. The cost is that tilt by
       * drag is a pointer-device gesture only (see onMove) — the model tilts
       * itself at rest, and the tilt is a look rather than a measurement.
       */
      canvas.style.touchAction = 'pan-y';
      canvas.style.cursor = 'grab';
      canvas.setAttribute('role', 'img');
      glCanvasRef.current = canvas;
      canvas.setAttribute('aria-label', canvasLabelRef.current);
      host.appendChild(canvas);

      const geos: Disposable[] = [];
      const mats: Disposable[] = [];
      const keep = <T extends Disposable>(o: T, into: Disposable[]): T => {
        into.push(o);
        return o;
      };

      const scene = new THREE.Scene();
      /* tilt yaws the whole assembly; spin turns the solid about its own axis;
         flat holds everything that must stay in the plane facing the camera. */
      const tilt = new THREE.Group();
      const spin = new THREE.Group();
      const flat = new THREE.Group();
      tilt.add(spin);
      tilt.add(flat);
      scene.add(tilt);

      const camera = new THREE.PerspectiveCamera(6, 2, 100, 2000);
      camera.position.set(0, 0, CAM_DIST);
      camera.lookAt(0, 0, 0);

      const half0 = D.L6 / 2;
      const mx = (mm: number) => mm - half0;
      const ci = junction(P, D);
      const cp = P.slice(0, ci + 1);
      const bp = P.slice(ci);
      const inner = innerProfile(D);

      /* ── Solids ─────────────────────────────────────────────────────
         LatheGeometry revolves a Vector2 list about ITS OWN Y axis with
         x = radius, so the profile's [x_mm, radius_mm] maps to (r, x) and
         the result is rotated a quarter turn to lay the case down the world
         X axis, then centred so the model turns about its middle. */
      const latheOf = (pts: Point[]) => {
        const v = pts.map((p) => new THREE.Vector2(p[1], p[0]));
        const g = new THREE.LatheGeometry(v, SEGMENTS);
        /* rotateZ carries the normals with it (applyMatrix4 uses the normal
           matrix), so LatheGeometry's own analytic normals survive — do NOT
           recompute them here, that would average the shoulder away. */
        g.rotateZ(-Math.PI / 2);
        g.translate(-half0, 0, 0);
        return keep(g, geos);
      };

      const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
      const basePlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

      /* Low metalness on purpose: with no environment map a fully metallic
         standard material renders near-black, and the prototype's look is a
         diffuse body with a tight highlight anyway. */
      const caseMat = keep(
        new THREE.MeshStandardMaterial({
          color: col(BRASS, 'var(--gold-tag-fill)'),
          metalness: 0.3,
          roughness: 0.28,
        }),
        mats,
      );
      const bulletMat = keep(
        new THREE.MeshStandardMaterial({
          color: col(COPPER, 'var(--gold)'),
          metalness: 0.35,
          roughness: 0.3,
        }),
        mats,
      );
      const innerMat = keep(
        new THREE.MeshStandardMaterial({
          color: col(BRASS_INNER, 'var(--gold)'),
          metalness: 0.2,
          roughness: 0.62,
          side: THREE.DoubleSide,
        }),
        mats,
      );

      const caseMesh = new THREE.Mesh(latheOf(cp), caseMat);
      const bulletMesh = new THREE.Mesh(latheOf(bp), bulletMat);
      spin.add(caseMesh);
      spin.add(bulletMesh);

      /* ── The section ────────────────────────────────────────────────
         Everything below shows only in half section and lives in the flat
         group: the cut plane is the model's own z = 0, and spin is pinned to
         zero in that mode so the cut always faces the viewer. */
      /* Hoisted above the section: the axis, the dimension web and the ring
         all build their geometry with it, and the section is now conditional. */
      const lineGeo = (pts: number[]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        return keep(g, geos);
      };

      const section = new THREE.Group();
      section.visible = false;
      flat.add(section);

      /**
       * ⚠️ THE SECTION IS SKIPPED WHEN THE INTERIOR CANNOT BE BUILT.
       *
       * `innerProfile` returns null for a case so short that the web and the
       * seated bullet would meet (see its own note). Building the cut anyway
       * gave a self-intersecting cap polygon, which the hatch scanline fills
       * in bands across the case wall — a picture that reads as a case with a
       * hole through it. `hasSection` therefore also decides whether the
       * clipping plane is applied at all, so Half section falls back to the
       * uncut solid rather than to an open shell.
       */
      const hasSection = inner !== null;
      if (inner) {
        section.add(new THREE.Mesh(latheOf(inner.pts), innerMat));

        const capUpper: Point[] = cp
          .map((p) => [mx(p[0]), p[1]] as Point)
          .concat(
            inner.pts
              .slice()
              .reverse()
              .slice(0, -1)
              .map((p) => [mx(p[0]), p[1]] as Point),
          );
        const capLower: Point[] = capUpper.map((p) => [p[0], -p[1]] as Point);
        const bulletUp: Point[] = [[mx(inner.seat), D.G1 / 2] as Point].concat(
          bp.map((p) => [mx(p[0]), p[1]] as Point),
        );
        const bulletCap: Point[] = bulletUp.concat(
          bulletUp
            .slice(0, -1)
            .reverse()
            .map((p) => [p[0], -p[1]] as Point),
        );

        const shapeOf = (poly: Point[]) => {
          const s = new THREE.Shape();
          s.moveTo(poly[0][0], poly[0][1]);
          for (let i = 1; i < poly.length; i++) s.lineTo(poly[i][0], poly[i][1]);
          s.closePath();
          return keep(new THREE.ShapeGeometry(s), geos);
        };

        /* Flat fills, not lit surfaces: a cut face in a section drawing reads
           as a filled outline, and lighting it makes it look like another
           solid. */
        const capMat = keep(
          new THREE.MeshBasicMaterial({
            color: col(BRASS_CUT, 'var(--gold-tag-fill)'),
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
          mats,
        );
        const bulletCapMat = keep(
          new THREE.MeshBasicMaterial({
            color: col(COPPER_CUT, 'var(--gold)'),
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
          mats,
        );
        section.add(new THREE.Mesh(shapeOf(capUpper), capMat));
        section.add(new THREE.Mesh(shapeOf(capLower), capMat));
        section.add(new THREE.Mesh(shapeOf(bulletCap), bulletCapMat));

        const loopOf = (poly: Point[], z: number) => {
          const arr: number[] = [];
          for (const p of poly) arr.push(p[0], p[1], z);
          return lineGeo(arr);
        };

        const edgeMat = keep(
          new THREE.LineBasicMaterial({ color: col(BRASS_EDGE, 'var(--gold-strong)') }),
          mats,
        );
        const bulletEdgeMat = keep(
          new THREE.LineBasicMaterial({ color: col(COPPER_EDGE, 'var(--gold-strong)') }),
          mats,
        );
        section.add(new THREE.LineLoop(loopOf(capUpper, 0.06), edgeMat));
        section.add(new THREE.LineLoop(loopOf(capLower, 0.06), edgeMat));
        section.add(new THREE.LineLoop(loopOf(bulletCap, 0.06), bulletEdgeMat));

        /* Hatch the brass only — the bullet is solid, not a wall. */
        const hatchMat = keep(
          new THREE.LineBasicMaterial({
            color: col(BRASS_EDGE, 'var(--gold-strong)'),
            transparent: true,
            opacity: 0.55,
          }),
          mats,
        );
        const hatch = hatchSegments(capUpper, HATCH_MM).concat(hatchSegments(capLower, HATCH_MM));
        if (hatch.length) section.add(new THREE.LineSegments(lineGeo(hatch), hatchMat));
      }

      /* ── Overlay: axis, dimensions, stations, ring ──────────────────
         All of it draws over the solid (depthTest off, ascending renderOrder)
         and none of it is clipped, so a dimension stays readable across the
         cut. */
      const axisMat = keep(
        new THREE.LineDashedMaterial({
          color: col('var(--text-faint)'),
          dashSize: 0.9,
          gapSize: 0.4,
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const axis = new THREE.Line(
        lineGeo([mx(-4), 0, 0, mx(D.L6 + 5), 0, 0]),
        axisMat,
      );
      axis.computeLineDistances();
      axis.renderOrder = 3;
      flat.add(axis);

      const dimMat = keep(
        new THREE.LineBasicMaterial({
          color: col('var(--text-secondary)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const dimHotMat = keep(
        new THREE.LineBasicMaterial({
          color: col('var(--red)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const dashMat = keep(
        new THREE.LineDashedMaterial({
          color: col('var(--text-faint)'),
          dashSize: 0.35,
          gapSize: 0.35,
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const dashHotMat = keep(
        new THREE.LineDashedMaterial({
          color: col('var(--red)'),
          dashSize: 0.35,
          gapSize: 0.35,
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const headMat = keep(
        new THREE.MeshBasicMaterial({
          color: col('var(--text-secondary)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const headHotMat = keep(
        new THREE.MeshBasicMaterial({
          color: col('var(--red)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );

      /* One cone, tip translated to the origin so placing an arrowhead is a
         position plus a quarter-turn rather than trigonometry per arrow. */
      const coneGeo = keep(new THREE.ConeGeometry(CONE_R, CONE_H, 6), geos);
      coneGeo.translate(0, -CONE_H / 2, 0);

      const dimGroup = new THREE.Group();
      flat.add(dimGroup);
      const dimParts: { k: string; lines: Paintable[]; heads: Paintable[]; dash: Paintable[] }[] =
        [];

      for (const s of specs) {
        const lines: Paintable[] = [];
        const heads: Paintable[] = [];
        const dash: Paintable[] = [];
        const arrow = (x: number, y: number, rz: number) => {
          const m = new THREE.Mesh(coneGeo, headMat);
          m.position.set(x, y, 0);
          m.rotation.z = rz;
          m.renderOrder = 4;
          dimGroup.add(m);
          heads.push(m);
        };
        if (s.kind === 'len') {
          const a = mx(0);
          const b = mx(s.val);
          const line = new THREE.Line(lineGeo([a, s.y, 0, b, s.y, 0]), dimMat);
          line.renderOrder = 4;
          dimGroup.add(line);
          lines.push(line);
          arrow(a, s.y, Math.PI / 2);
          arrow(b, s.y, -Math.PI / 2);
          const ext = new THREE.LineSegments(
            lineGeo([
              a,
              -(D.R1 / 2) - 0.4,
              0,
              a,
              s.y,
              0,
              b,
              -radiusAt(P, s.val) - 0.4,
              0,
              b,
              s.y,
              0,
            ]),
            dashMat,
          );
          ext.computeLineDistances();
          ext.renderOrder = 4;
          dimGroup.add(ext);
          dash.push(ext);
        } else {
          const x = mx(s.x);
          const line = new THREE.Line(lineGeo([x, s.val / 2, 0, x, -s.val / 2, 0]), dimMat);
          line.renderOrder = 4;
          dimGroup.add(line);
          lines.push(line);
          arrow(x, s.val / 2, 0);
          arrow(x, -s.val / 2, Math.PI);
          const ext = new THREE.Line(lineGeo([x, s.val / 2, 0, x, s.y, 0]), dashMat);
          ext.computeLineDistances();
          ext.renderOrder = 4;
          dimGroup.add(ext);
          dash.push(ext);
        }
        dimParts.push({ k: s.k, lines, heads, dash });
      }

      /* Station dots: where the ring will land if you let it. */
      const dotGeo = keep(new THREE.SphereGeometry(0.32, 10, 8), geos);
      const dotMat = keep(
        new THREE.MeshBasicMaterial({
          color: col('var(--text-tertiary)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const dotHotMat = keep(
        new THREE.MeshBasicMaterial({
          color: col('var(--red)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const dots: { k: string; mesh: Paintable }[] = [];
      for (const st of stations(D)) {
        if (!st.dia) continue;
        const m = new THREE.Mesh(dotGeo, dotMat);
        m.position.set(mx(st.mm), radiusAt(P, st.mm), 0);
        m.renderOrder = 5;
        flat.add(m);
        dots.push({ k: st.k, mesh: m });
      }

      /* The ring is two unit circles scaled to the radius under it. A tube
         would need rebuilding every frame of a drag; two lines 0.12 mm apart
         read as one 2 px ring at any size and cost nothing. */
      const ringPts: number[] = [];
      const RSEG = 72;
      for (let i = 0; i <= RSEG; i++) {
        const t = (i / RSEG) * Math.PI * 2;
        ringPts.push(0, Math.cos(t), Math.sin(t));
      }
      const ringMat = keep(
        new THREE.LineBasicMaterial({
          color: col('var(--red)'),
          depthTest: false,
          depthWrite: false,
        }),
        mats,
      );
      const ringGeo = lineGeo(ringPts);
      const ringA = new THREE.Line(ringGeo, ringMat);
      const ringB = new THREE.Line(ringGeo, ringMat);
      ringA.renderOrder = 6;
      ringB.renderOrder = 6;
      const ring = new THREE.Group();
      ring.add(ringA);
      ring.add(ringB);
      ring.visible = false;
      flat.add(ring);

      /* ── Light ──────────────────────────────────────────────────────
         The prototype's key direction, kept: L = normalize(−0.45, 0.72, 0.53). */
      const white = col('var(--bg-card)');
      const ambient = new THREE.AmbientLight(white, 0.9);
      const key = new THREE.DirectionalLight(white, 1.7);
      key.position.set(-0.45, 0.72, 0.53).normalize().multiplyScalar(400);
      const fill = new THREE.DirectionalLight(white, 0.5);
      fill.position.set(0.6, -0.35, 0.8).normalize().multiplyScalar(400);
      const rim = new THREE.DirectionalLight(col('var(--bg-inset)'), 0.65);
      rim.position.set(0.15, 0.45, -0.9).normalize().multiplyScalar(400);
      scene.add(ambient);
      scene.add(key);
      scene.add(fill);
      scene.add(rim);

      /* ── Size ───────────────────────────────────────────────────────
         fov is derived, not chosen: at 900 mm the model must span L6 × 1.32
         across the width, which is the prototype's S. */
      const size = { w: 0, h: 0, dpr: 0 };
      const resize = () => {
        /* ⚠️ clientWidth, NOT getBoundingClientRect. The card animates in on a
           scale transform, and the rect reports the SCALED box — measured on
           the first frame that would size the drawing buffer a few per cent
           small and nothing would ever resize it back. */
        const w = Math.max(1, host.clientWidth);
        const h = Math.max(1, host.clientHeight);
        /**
         * ⚠️ THE PIXEL RATIO IS RE-READ HERE, NOT SET ONCE AT STARTUP.
         * devicePixelRatio is not a constant: dragging the window to a second
         * monitor, or the browser's own zoom, changes it. Set once, the model
         * stayed at the ratio of whichever screen the card happened to open
         * on and went visibly soft (or needlessly heavy) on the other.
         */
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (w === size.w && h === size.h && dpr === size.dpr) return;
        size.w = w;
        size.h = h;
        size.dpr = dpr;
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const visH = (D.L6 * FIT) / camera.aspect;
        camera.fov = (2 * Math.atan(visH / 2 / CAM_DIST) * 180) / Math.PI;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      /* ── Pointer ────────────────────────────────────────────────────
         Everything is measured in the prototype's virtual 1120×560 space so
         the ported gains keep their feel at any real size. */
      const virt = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: r.width ? ((ev.clientX - r.left) / r.width) * VIRT_W : 0,
          y: r.height ? ((ev.clientY - r.top) / r.height) * VIRT_H : 0,
        };
      };

      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const inv = new THREE.Matrix4();
      const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hit = new THREE.Vector3();
      const tmpV = new THREE.Vector3();

      /**
       * Pointer → millimetres from the head.
       *
       * ⚠️ THE RAY IS TAKEN INTO THE FLAT GROUP'S OWN FRAME AND MET WITH ITS
       * z = 0 PLANE. Meeting a world plane instead looks equivalent and is
       * not: with the camera on the axis, the world y = 0 plane is edge-on
       * and the intersection degenerates.
       */
      const pointerMm = (ev: PointerEvent): number | null => {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        ndc.set(
          ((ev.clientX - r.left) / r.width) * 2 - 1,
          -(((ev.clientY - r.top) / r.height) * 2 - 1),
        );
        ray.setFromCamera(ndc, camera);
        flat.updateMatrixWorld();
        inv.copy(flat.matrixWorld).invert();
        const local = ray.ray.clone().applyMatrix4(inv);
        if (!local.intersectPlane(planeZ, hit)) return null;
        return hit.x + half0;
      };

      /** Where the ring sits, in virtual px across the width. */
      const ringVirtX = (mm: number): number => {
        tmpV.set(mx(mm), 0, 0);
        flat.updateMatrixWorld();
        tmpV.applyMatrix4(flat.matrixWorld).project(camera);
        return (tmpV.x * 0.5 + 0.5) * VIRT_W;
      };

      /* SPEC §8: reduced motion means no auto-spin. A deliberate drag still
         turns it. Read BEFORE the handlers because onDown restores this exact
         value — writing a bare `true` there would hand a member who asked for
         no motion a permanently spinning model after one tap, which is the
         preference defeated rather than honoured. */
      let reduced = false;
      /**
       * ⚠️ SUBSCRIBED, NOT SAMPLED ONCE. The preference is a live media query:
       * a member who turns "reduce motion" on while a spec card is open — or
       * whose OS turns it on for them at a low battery — kept a spinning model
       * until they closed and reopened the card. The listener also has to
       * settle `auto`, because that is the flag the frame loop reads.
       */
      let motionMql: MediaQueryList | null = null;
      const onMotion = (e: { matches: boolean }) => {
        reduced = e.matches;
        ctl.current.auto = !reduced;
        if (reduced) {
          ctl.current.vel = 0;
          ctl.current.tilted = true;
        }
      };
      try {
        motionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
        reduced = motionMql.matches;
        motionMql.addEventListener('change', onMotion);
      } catch {
        reduced = false;
        motionMql = null;
      }

      /**
       * The ring's grab band in VIRTUAL units, never narrower than
       * GRAB_MIN_PX on the actual screen.
       */
      const grabBand = (): number => {
        const r = canvas.getBoundingClientRect();
        if (!r.width) return GRAB_PX;
        return Math.max(GRAB_PX, (GRAB_MIN_PX * VIRT_W) / r.width);
      };

      const onDown = (ev: PointerEvent) => {
        const c = ctl.current;
        const v = virt(ev);
        c.auto = !reduced;
        c.lx = v.x;
        c.ly = v.y;
        if (c.cal !== null && Math.abs(v.x - ringVirtX(c.cal)) < grabBand()) {
          c.drag = 'cal';
        } else {
          c.drag = 'spin';
        }
        canvas.style.cursor = 'grabbing';
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch {
          /* Pointer capture is a convenience; the drag still works without it. */
        }
      };

      const onMove = (ev: PointerEvent) => {
        const c = ctl.current;
        if (!c.drag) return;
        const v = virt(ev);
        if (c.drag === 'cal') {
          const mm = pointerMm(ev);
          if (mm !== null) applyCalRef.current(mm);
        } else {
          const dx = v.x - c.lx;
          const dy = v.y - c.ly;
          /* Spin is disabled in half section — the cut must keep facing you. */
          if (!c.half) c.psi += dx * SPIN_PER_PX;
          /**
           * ⚠️ TILT IS A POINTER GESTURE, NOT A TOUCH ONE. `touch-action:
           * pan-y` gives vertical movement to the page's scroller, so a
           * finger dragging up is scrolling and the browser will send
           * pointercancel part-way through. Tilting on that same dy would
           * yaw the model by however much of the gesture arrived before the
           * cancel — a tilt nobody asked for, applied to a model they were
           * scrolling past.
           */
          if (ev.pointerType !== 'touch') {
            c.phi = Math.max(-TILT_MAX, Math.min(TILT_MAX, c.phi + dy * TILT_PER_PX));
            if (dy !== 0) c.tilted = true;
          }
          c.vel = Math.max(-SPIN_CLAMP, Math.min(SPIN_CLAMP, dx * FLICK_PER_PX));
        }
        c.lx = v.x;
        c.ly = v.y;
      };

      const onUp = (ev: PointerEvent) => {
        ctl.current.drag = null;
        canvas.style.cursor = 'grab';
        try {
          canvas.releasePointerCapture(ev.pointerId);
        } catch {
          /* Already released, or never captured. */
        }
      };

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);

      ctl.current.auto = !reduced;

      /* ── Frame ──────────────────────────────────────────────────────── */
      let raf = 0;
      let last = 0;
      let appliedHalf: boolean | null = null;
      /** The letter currently painted red — the calliper's, or the table's. */
      let appliedLit: string | null | undefined = undefined;
      let appliedDims: boolean | null = null;
      const project = (x: number, y: number) => {
        tmpV.set(x, y, 0).applyMatrix4(flat.matrixWorld).project(camera);
        return {
          x: (tmpV.x * 0.5 + 0.5) * size.w,
          y: (-tmpV.y * 0.5 + 0.5) * size.h,
        };
      };

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const c = ctl.current;
        const dt = last ? Math.min(64, now - last) : FRAME_MS;
        last = now;
        const f = dt / FRAME_MS;

        if (c.auto && !c.drag && !c.half) c.psi += c.vel * f;
        /* A flick decays back to the idle rate rather than running forever. */
        if (!c.drag) c.vel += (IDLE_SPIN - c.vel) * Math.min(1, SPIN_EASE * f);

        /**
         * The resting sway.
         *
         * ⚠️ A SOLID OF REVOLUTION SPINNING ABOUT ITS OWN AXIS IS INVISIBLE.
         * The idle spin is real and does nothing a viewer can see: every
         * silhouette of a lathed body is the same silhouette. The model
         * therefore read as a still picture, and nobody discovered it could be
         * dragged. A ±0.12 rad tilt over six seconds moves the highlight and
         * the dimension web enough to say "this is live" and not enough to
         * distract. It stops for good the moment the member tilts it
         * themselves — their angle is a choice — and never starts under
         * reduced motion.
         */
        if (!reduced && !c.tilted && !c.drag && c.auto) {
          c.phi = TILT_REST + TILT_SWING * Math.sin((now / TILT_PERIOD_MS) * Math.PI * 2);
        }

        spin.rotation.x = c.half ? 0 : c.psi;
        tilt.rotation.y = c.phi;
        scene.updateMatrixWorld(true);

        const cut = c.half && hasSection;
        if (appliedHalf !== cut) {
          appliedHalf = cut;
          section.visible = cut;
          for (const m of [caseMat, bulletMat, innerMat]) {
            m.clippingPlanes = cut ? [clip] : null;
            m.needsUpdate = true;
          }
        }
        /* The cut plane rides with the tilt: it must always contain the axis
           AND face the camera, which a fixed world plane stops doing the
           moment the model yaws. */
        if (cut) clip.copy(basePlane).applyMatrix4(tilt.matrixWorld);

        /**
         * The lit letter: the calliper's snapped station, or — when nothing is
         * snapped — whichever row the table is hovering.
         *
         * ⚠️ THE CALLIPER WINS, AND THAT IS THE WHOLE OF C16. The table's
         * hover used to be the only writer of the hot letter, so moving the
         * pointer across the rows put out a station the member had
         * deliberately measured to, and moving it off set the letter to null
         * rather than back to the measurement. Reading the snap first means a
         * hover is a look and the snap is a state.
         *
         * Repainting is driven by the change, not by the frame: swapping
         * materials every frame would dirty the render lists sixty times a
         * second for nothing.
         */
        const lit = c.snap ?? c.hot;
        const snapChanged = appliedLit !== lit;
        const dimsChanged = appliedDims !== c.showDims;
        if (snapChanged) {
          appliedLit = lit;
          for (const d of dimParts) {
            const on = lit === d.k;
            for (const o of d.lines) o.material = on ? dimHotMat : dimMat;
            for (const o of d.heads) o.material = on ? headHotMat : headMat;
            for (const o of d.dash) o.material = on ? dashHotMat : dashMat;
          }
          for (const d of dots) d.mesh.material = lit === d.k ? dotHotMat : dotMat;
        }
        if (dimsChanged) {
          appliedDims = c.showDims;
          dimGroup.visible = c.showDims;
        }

        let ringRadius = 0;
        if (c.cal === null) {
          ring.visible = false;
        } else {
          ringRadius = radiusAt(P, c.cal) + 0.35;
          ring.visible = true;
          ring.position.x = mx(c.cal);
          ringA.scale.set(1, ringRadius, ringRadius);
          ringB.scale.set(1, ringRadius + 0.12, ringRadius + 0.12);
        }

        renderer.render(scene, camera);

        /* HTML labels, projected after the render so the matrices are current.
           SPEC §6.3: positioned by projecting anchors each frame, no
           CSS2DRenderer — one small overlay does not justify a second
           renderer in the bundle. */
        for (const s of specs) {
          const el = labelRefs.current[s.k];
          if (!el) continue;
          /* Written every frame on purpose. Gating it on the change would
             leave a freshly mounted span stuck at the `display: none` the JSX
             gives it, since React cannot see the imperative write. */
          el.style.display = c.showDims ? '' : 'none';
          if (!c.showDims) continue;
          if (snapChanged || dimsChanged) {
            el.style.color = lit === s.k ? 'var(--red)' : 'var(--text-secondary)';
            el.style.fontWeight = lit === s.k ? '600' : '500';
          }
          const p = project(s.kind === 'len' ? mx(s.val / 2) : mx(s.x), s.y);
          el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y - 4).toFixed(1)}px) translate(${
            s.left ? '4px' : '-50%'
          }, -100%)`;
        }
        /* ⚠️ THE READOUT IS NO LONGER POSITIONED HERE. It used to float above
           the ring, which put it straight over the G1 and H1 labels — the two
           the calliper is most often used to reach, so the box hid the figures
           it was there to confirm. It now renders as a fixed strip under the
           model (see the JSX), where it cannot collide with anything and does
           not have to be re-measured sixty times a second. */
      };
      raf = requestAnimationFrame(tick);

      /**
       * "Show all" — SPEC §6.3.
       *
       * Freeze side-on, dimensions on, calliper cleared, then export a PNG of
       * exactly what is on screen with the cartridge named in the corner.
       *
       * ⚠️ THE HTML LABELS ARE NOT IN THE DRAWING BUFFER, SO THEY ARE DRAWN
       * AGAIN. The dimension text is a DOM overlay positioned by projecting
       * anchors each frame (there is no CSS2DRenderer in the bundle); a
       * straight `canvas.toBlob` therefore produces a picture of arrows and
       * leader lines with no figures on it — a dimensioned drawing with the
       * dimensions missing, which is worse than no export. The same
       * projection that places the spans places the text here, so the PNG and
       * the screen cannot disagree.
       */
      showAllRef.current = () => {
        const c = ctl.current;
        c.psi = 0;
        c.phi = 0;
        c.vel = 0;
        c.auto = false;
        /* The pose is now a decision, so the resting sway stops. */
        c.tilted = true;
        c.drag = null;
        c.showDims = true;
        setShowDims(true);
        applyCalRef.current(null);

        spin.rotation.x = 0;
        tilt.rotation.y = 0;
        ring.visible = false;
        dimGroup.visible = true;
        scene.updateMatrixWorld(true);
        renderer.render(scene, camera);

        const out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        const g2 = out.getContext('2d');
        if (!g2 || !out.width || !out.height) return;

        /* The renderer is alpha:true, so the buffer has no background of its
           own — without this the PNG is the model on transparency and reads
           as a black drawing in most viewers. */
        g2.fillStyle = col('var(--bg-card-hover)', 'var(--bg-card)').getStyle();
        g2.fillRect(0, 0, out.width, out.height);
        g2.drawImage(canvas, 0, 0, out.width, out.height);

        /* Back into CSS pixels, which is the space project() answers in. */
        const k = out.width / Math.max(1, size.w);
        g2.scale(k, k);
        g2.textBaseline = 'alphabetic';
        g2.font = "500 11px ui-monospace, 'Cascadia Mono', Consolas, monospace";
        g2.fillStyle = col('var(--text-secondary)').getStyle();
        for (const s of specs) {
          const p = project(s.kind === 'len' ? mx(s.val / 2) : mx(s.x), s.y);
          g2.textAlign = s.left ? 'left' : 'center';
          g2.fillText(
            `${s.k} = ${fmtLength(s.val, exportRef.current.units)}`,
            p.x + (s.left ? 4 : 0),
            p.y - 4,
          );
        }

        const corner = exportRef.current.name;
        if (corner) {
          g2.textAlign = 'left';
          g2.font = "600 14px 'Archivo', system-ui, sans-serif";
          g2.fillStyle = col('var(--text-primary)').getStyle();
          g2.fillText(corner, 12, size.h - 12);
        }

        out.toBlob((blob) => {
          if (!blob) return;
          const base = (exportRef.current.slug || 'cartridge')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${base || 'cartridge'}-dimensions.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          onToastRef.current?.('Snapshot saved');
        }, 'image/png');
      };

      cleanup = () => {
        /* ⚠️ A LEAKED GL CONTEXT IS A REAL BUG ON A PHONE. Browsers cap live
           contexts (~8–16) and drop the OLDEST when the cap is hit, so a
           spec card opened a dozen times would blank an earlier canvas. Kill
           the frame, free every buffer, then force the context loss. */
        cancelAnimationFrame(raf);
        ro.disconnect();
        showAllRef.current = null;
        glCanvasRef.current = null;
        motionMql?.removeEventListener('change', onMotion);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
        scene.clear();
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (probe.parentNode) probe.parentNode.removeChild(probe);
      };
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [D, P, specs]);

  /* ⚠️ THROWN, NOT RETURNED AS null. The card falls back to the 2D drawing
     off its error boundary (SpecCard's LatheBoundary → onFail → view '2d');
     returning null instead leaves an empty well sitting under a note telling
     the member to drag and spin it. The renderer chunk failing to load is
     precisely the failure that boundary exists for. */
  if (failed) throw new Error('LatheView: no WebGL renderer');
  /* A cartridge with no length is nothing to draw, not a failure. */
  if (!(dims.L6 > 0)) return null;

  const btnSize = phone ? 'mobile' : 'desktop';

  return (
    <div>
      <div
        ref={hostRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '2 / 1',
          background: 'var(--bg-card-hover)',
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
        }}
      >
        {/* Decorative duplicates of the Dimensions table — the table carries
            every figure, so a screen reader is told nothing twice. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {specs.map((s) => (
            <span
              key={s.k}
              ref={(el) => {
                labelRefs.current[s.k] = el;
              }}
              className="mono num"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                display: 'none',
                whiteSpace: 'nowrap',
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
              }}
            >
              {`${s.k} = ${fmtLength(s.val, units)}`}
            </span>
          ))}
        </div>
      </div>

      {/**
       * The calliper readout, UNDER the model rather than floating over it.
       *
       * ⚠️ IT USED TO SIT ABOVE THE RING, WHICH IS WHERE G1 AND H1 LIVE. Those
       * two are the bullet diameter and the neck — the stations a reloader
       * reaches for first — so the box covered the figures it was opened to
       * confirm, and the only way to read them was to move the calliper away
       * from them. Down here it collides with nothing, and the strip holds its
       * height whether or not anything is measured so the controls below do
       * not jump when the ring lands.
       */}
      <div
        style={{
          minHeight: 40,
          marginTop: '8px',
          padding: '6px 10px 7px',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--r-sm)',
          background: 'var(--bg-card)',
        }}
        /* ⚠️ NOT A LIVE REGION. The slider below already carries this text as
           `aria-valuetext`, which announces once per committed change; a
           polite region on the same words would queue an announcement for
           every 0.1 mm of a drag and read the whole ladder back afterwards. */
        aria-hidden="true"
      >
        <div className="mono num" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--red)' }}>
          {readout ? readout.title : ''}
        </div>
        <div
          className="mono num"
          style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}
        >
          {readout ? readout.sub : 'Slide the calliper to measure.'}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginTop: '10px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            whiteSpace: 'nowrap',
          }}
        >
          Calliper
        </span>
        <input
          type="range"
          min={0}
          max={Math.round(D.L6 * 10)}
          step={1}
          value={cal === null ? 0 : Math.round(cal * 10)}
          onChange={(e) => applyCal(Number(e.target.value) / 10)}
          aria-label="Calliper position along the cartridge"
          aria-valuetext={calText}
          style={{
            flex: '1 1 140px',
            minWidth: '120px',
            height: '44px',
            accentColor: 'var(--red)',
            cursor: 'pointer',
          }}
        />
        <span className="mono num" style={{ whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>
          {calText}
        </span>
        {/* ⚠️ THE `Btn` PRIMITIVE, NOT A RAW <button className="btn">. A button
            does not inherit font-family and `.bench .btn` does not set one, so
            a hand-rolled one renders its label in the UA's default face beside
            controls that are all in Public Sans.

            ⚠️ size="mobile" ON A PHONE, WHICH IS A 44px TARGET (SPEC §9). The
            three buttons here were the desktop 34px on every screen, under a
            canvas the same finger is dragging. */}
        <Btn size={btnSize} aria-pressed={showDims} onClick={() => setShowDims((v) => !v)}>
          <span
            aria-hidden="true"
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '5px',
              border: '0.5px solid var(--border)',
              background: showDims ? 'var(--red)' : 'var(--bg-card)',
              display: 'inline-block',
            }}
          />
          Dimensions
        </Btn>
        <Btn size={btnSize} onClick={() => applyCal(null)} disabled={cal === null}>
          Clear
        </Btn>
        {/* SPEC §6.3: side-on, dimensions on, calliper cleared, exported as
            `<slug>-dimensions.png` with the cartridge named in the corner. */}
        <Btn
          size={btnSize}
          title="Face the model on, turn the dimensions on and save a picture"
          onClick={() => showAllRef.current?.()}
        >
          Show all
        </Btn>
      </div>
      {/* No hint line here: SpecCard prints one directly beneath this view and
          varies it by phone/desktop. Two components writing the same
          instruction is the same sentence twice on the screen. */}
    </div>
  );
}

export { LatheView };
