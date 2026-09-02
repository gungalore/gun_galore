/**
 * THE BENCH — cartridge geometry.
 *
 * Ported verbatim from the design prototype's `profile()` / `paths()` /
 * `thumbOf()`, which are already parameterised on a dimensions object. The
 * silhouette is a pure function of the C.I.P. figures: nothing here is drawn
 * by eye, and nothing is tuned per cartridge.
 *
 * ⚠️ EVERY FIGURE IS A C.I.P. DIMENSION IN MILLIMETRES, AS PRINTED. The
 * backend stores them unconverted for exactly this reason. Feeding this
 * inches, or a mix, produces a drawing that looks plausible and is wrong —
 * which is worse than one that obviously fails.
 */

/** The subset of `BenchCipDimension` the drawing needs. */
export interface Dims {
  R: number;
  R1: number;
  E: number;
  E1: number;
  P1: number;
  P2: number;
  L1: number;
  L2: number;
  L3: number;
  L6: number;
  H1: number;
  H2: number;
  G1: number;
}

/** The thirteen figures the profile reads, in the order the drawing uses them. */
export const DIM_KEYS: (keyof Dims)[] = [
  'R', 'R1', 'E', 'E1', 'P1', 'P2', 'L1', 'L2', 'L3', 'L6', 'H1', 'H2', 'G1',
];

/**
 * Whether a full silhouette can be drawn.
 *
 * ⚠️ ALL THIRTEEN OR NONE. A profile built from a partial sheet does not fail
 * visibly — it renders a smooth, confident, wrong shape, because a missing
 * shoulder diameter simply collapses that vertex onto its neighbour. Where
 * this returns false the spec card falls back to the reference file's L3/L6
 * text and draws nothing.
 */
export function canDraw(d: Partial<Dims> | null | undefined): d is Dims {
  if (!d) return false;
  return DIM_KEYS.every((k) => typeof d[k] === 'number' && Number.isFinite(d[k]));
}

export type Point = [number, number];

/** feet per second → metres per second. */
export const MS = 0.3048;

/**
 * Millimetres per inch.
 *
 * ⚠️ ONE DEFINITION. This was declared separately in CoalGauge, LogList,
 * LogSheet, ResultsList and SpecCard — five copies of a conversion that five
 * surfaces show side by side.
 */
export const MM_PER_INCH = 25.4;

/**
 * The half-profile, from case head to bullet tip, in millimetres.
 *
 * The case is a straight run of vertices off the C.I.P. figures; the ogive is
 * the only modelled part — 14 steps of a sqrt curve with a slight taper — and
 * it is cosmetic, since C.I.P. publishes no ogive.
 */
export function profile(D: Dims): Point[] {
  const p: Point[] = [];
  p.push([0, 0], [0, D.R1 / 2], [D.R, D.R1 / 2]);
  p.push([D.R, D.E1 / 2], [D.E - 0.9, D.E1 / 2], [D.E, D.P1 / 2]);
  p.push([D.L1, D.P2 / 2], [D.L2, D.H1 / 2], [D.L3, D.H2 / 2]);
  p.push([D.L3, D.G1 / 2]);
  const shank = D.L3 + 6;
  p.push([shank, D.G1 / 2]);
  const n = 14;
  const len = D.L6 - shank;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    p.push([shank + len * t, (D.G1 / 2) * Math.sqrt(1 - t * t) * (1 - 0.04 * t) + 0.35 * (1 - t)]);
  }
  p[p.length - 1] = [D.L6, 0.55];
  p.push([D.L6, 0]);
  return p;
}

export interface Paths {
  casePath: string;
  bulletPath: string;
  /** millimetres → SVG x. */
  px: (x: number) => number;
  /** millimetres (radius) → SVG y. */
  py: (r: number) => number;
}

/**
 * The case and bullet as two closed SVG paths.
 *
 * Split at the neck/bullet junction — the vertex at (L3, G1/2) — so the two
 * can be filled differently. Each half-profile is mirrored about the axis and
 * closed.
 */
export function paths(D: Dims, S: number, X0: number, Y0: number): Paths {
  const P = profile(D);
  const px = (x: number) => X0 + x * S;
  const py = (r: number) => Y0 - r * S;
  const path = (pts: Point[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(2)} ${py(p[1]).toFixed(2)}`).join(' ');
  const mirror = (pts: Point[]): Point[] => pts.map((p) => [p[0], -p[1]]);

  let ci = -1;
  for (let i = 0; i < P.length; i++) {
    if (P[i][0] === D.L3 && P[i][1] === D.G1 / 2) {
      ci = i;
      break;
    }
  }
  const cp = P.slice(0, ci + 1);
  const bp = P.slice(ci);

  return {
    casePath: `${path(cp)} ${path(mirror(cp).reverse()).replace('M', 'L')} Z`,
    bulletPath: `${path(bp)} ${path(mirror(bp).reverse()).replace('M', 'L')} Z`,
    px,
    py,
  };
}

export interface Thumb {
  casePath: string;
  bulletPath: string;
  thumbBox: string;
}

/** Width available to the silhouette inside the 128×30 thumb box. */
const THUMB_SPAN = 118;
/**
 * The prototype's thumbnail scale, expressed as what it actually is: 118px
 * across for a 74 mm cartridge.
 */
const THUMB_REF_MM = 74;

/**
 * The list silhouette: no dimension lines, no labels.
 *
 * ⚠️ THE SCALE ONLY EVER SHRINKS. The prototype fixed it at 118/74, which
 * overruns the 128-wide box for anything longer than about 74 mm — .30-06,
 * .300 Win Mag and .375 H&H would each have their tip drawn outside the
 * viewBox and clipped away, with no error to notice.
 *
 * Capping rather than always fitting is deliberate: if every cartridge were
 * scaled to fill the box, a .223 and a .338 Lapua would draw the same length
 * and the list would quietly misrepresent them. Below the reference length the
 * scale is the prototype's exactly, so relative size still reads; above it,
 * the longest cartridges compress just enough to fit.
 */
export function thumbOf(D: Dims): Thumb {
  const scale = Math.min(THUMB_SPAN / THUMB_REF_MM, THUMB_SPAN / Math.max(D.L6, 1));
  const r = paths(D, scale, 4, 15);
  return { casePath: r.casePath, bulletPath: r.bulletPath, thumbBox: '0 0 128 30' };
}

/* ── COAL ───────────────────────────────────────────────────────────── */

/** Within this much of the maximum, a COAL is flagged. */
export const COAL_NEAR_MAX_MM = 0.5;

export interface CoalCheck {
  /** Tag text, empty when the COAL is comfortably under maximum. */
  t: string;
  bad: boolean;
  /** Millimetres under L6; negative means over. */
  diff: number;
}

/**
 * ⚠️ COMPARED AGAINST L6, THE MAXIMUM CARTRIDGE LENGTH — never against the
 * chamber. A round longer than L6 may not chamber and can raise pressure, so
 * this flags at the standard, and the wording says "check" rather than
 * asserting the round is unsafe.
 */
export function coalCheck(coal: number, l6: number): CoalCheck {
  const diff = Math.round((l6 - coal) * 100) / 100;
  if (diff < 0) return { t: 'COAL OVER MAX', bad: true, diff };
  if (diff <= COAL_NEAR_MAX_MM) return { t: `COAL −${diff.toFixed(2)} MAX`, bad: true, diff };
  return { t: '', bad: false, diff };
}

/* ── Units ──────────────────────────────────────────────────────────── */

export type Units = 'metric' | 'imperial';

/**
 * Velocity, with the other unit in brackets.
 *
 * Both are always shown: the manuals are published in fps and the range is
 * shopped in m/s, and a reloader comparing a figure to a book needs to see
 * the one the book printed.
 */
export function fmtVelocity(fps: number, units: Units): string {
  const ms = Math.round(fps * MS);
  return units === 'imperial' ? `${fps} fps (${ms} m/s)` : `${ms} m/s (${fps} fps)`;
}

export function today(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${dd < 10 ? '0' : ''}${dd}`;
}

/**
 * A length in the unit the reader has selected, and only that one.
 *
 * ⚠️ NOT THE SAME AS THE TABLE'S FORMATTER, DELIBERATELY. The spec card's
 * dimension rows print both units, because a reloader is usually comparing a
 * figure against a tool marked in the other one. A drawing has no room for
 * that: two units per callout is what turns an engineering drawing into
 * noise, so the drawing follows the toggle instead of showing both.
 */
export function fmtLength(mm: number, units: Units): string {
  return units === 'imperial'
    ? `${(mm / MM_PER_INCH).toFixed(3)}″`
    : `${mm.toFixed(2)} mm`;
}
