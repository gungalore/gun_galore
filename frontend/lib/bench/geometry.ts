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

/** The figures no cartridge can be drawn without. */
const REQUIRED: (keyof Dims)[] = ['R', 'R1', 'P1', 'L3', 'L6', 'G1'];

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export interface CompletedDims {
  dims: Dims;
  /** Letters the sheet did NOT print. Drawn, and never annotated. */
  derived: ReadonlySet<keyof Dims>;
}

/**
 * A complete set of figures, or null.
 *
 * ⚠️ ALL THIRTEEN REFUSED THE TWO CARTRIDGES MEMBERS ACTUALLY ASK ABOUT. Of
 * the 215 sheets held, only 132 print every letter — a case with no shoulder
 * does not print one, and a rimmed revolver case prints no extractor groove
 * either — so `canDraw` alone drew nothing for 9 mm Luger or .38 Special, and
 * the spec card fell through to its text fallback for 83 cartridges.
 *
 * ⚠️ A DERIVED LETTER IS A COLLAPSE, NEVER AN INVENTION. Where a case has no
 * shoulder the shoulder is placed AT the mouth and the diameters either side
 * of it are the mouth's own, so the body runs from P1 to the mouth as the real
 * case does. Where there is no extractor groove the groove diameter is the
 * body's, so the flange stands proud of a straight wall. The silhouette drawn
 * is the silhouette the sheet describes.
 *
 * ⚠️ AND `derived` IS WHY THE TABLE STAYS HONEST. The drawing may need a
 * figure to know what shape to cut and still have no business annotating it as
 * though it were published.
 *
 * ⚠️ KEPT IDENTICAL TO backend/src/motivations/motivation-cartridge-drawing.ts,
 * which draws the same cartridge into a member's licence pack. The shape they
 * see here and the shape they print must be one shape.
 */
export function completeDims(
  d: Partial<Record<keyof Dims, number | null | undefined>> | null | undefined,
): CompletedDims | null {
  if (!d) return null;
  for (const k of REQUIRED) if (num(d[k]) === undefined) return null;

  const derived = new Set<keyof Dims>();
  for (const k of DIM_KEYS) if (num(d[k]) === undefined) derived.add(k);

  const R = num(d.R)!;
  const R1 = num(d.R1)!;
  const P1 = num(d.P1)!;
  const L3 = num(d.L3)!;
  const L6 = num(d.L6)!;
  const G1 = num(d.G1)!;
  const mouth = num(d.H2) ?? num(d.H1) ?? num(d.P2) ?? P1;
  /**
   * ⚠️ THE GROOVE IS HELD CLEAR OF THE RIM, OR THE SILHOUETTE FOLDS. `profile`
   * reads a vertex at `E − 0.9`; on a rimmed case with no groove that lands
   * BEHIND the rim vertex and the outline crosses itself. Nothing fails.
   */
  const E = Math.max(num(d.E) ?? R, R + 0.9);
  const E1 = num(d.E1) ?? P1;
  const L1 = num(d.L1) ?? L3;
  const L2 = num(d.L2) ?? L1;
  const P2 = num(d.P2) ?? (L1 >= L3 ? mouth : P1);
  const H1 = num(d.H1) ?? mouth;

  const dims: Dims = { R, R1, E, E1, P1, P2, L1, L2, L3, L6, H1, H2: mouth, G1 };
  return canDraw(dims) && L6 > L3 && L3 > E ? { dims, derived } : null;
}



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
 * The seated bullet's nose, from the top of the bearing surface to the tip.
 *
 * ⚠️ A TANGENT OGIVE WITH A SPHERICAL TIP, WHICH IS WHAT A BULLET IS. What was
 * here was `sqrt(1 − t²)` — a semicircle — with a `+ 0.35 (1 − t)` term added
 * on top of it. Two faults, and together they drew the wrong object:
 *
 *   - A semicircle holds nearly full diameter for most of its run and then
 *     falls away almost vertically at the end. A bullet does the opposite: it
 *     leaves the shank flat and tightens continuously into the tip. Operator,
 *     2026-09-09, on the result: "yours looks like a fucking dick head or a
 *     mushroom".
 *   - The `+ 0.35 (1 − t)` term ADDED 0.35 mm of radius at the start of the
 *     curve, so the nose bulged wider than the bullet exactly where it left
 *     the case, giving it a lip.
 *
 * A tangent ogive is an arc of radius `R` that meets the bearing surface flat
 * — no corner, which is the whole meaning of "tangent" — and it is the shape
 * every jacketed bullet made since about 1900 actually has. `R` is not chosen
 * by eye: it is the only radius that both meets the shank flat AND reaches the
 * tip in the length the round has, so it comes out of the round's own figures.
 * For a 9 mm Luger that lands at about 1.1 calibres, which is the classic
 * round nose; for a .223 at about 3.4, which is a spitzer. The drawing does
 * not decide that — the case length and the overall length do.
 *
 * ⚠️ AND THE TIP IS A SPHERE TANGENT TO THAT ARC, not a point and not a cap
 * bolted on. A round-nose bullet has a small radius at the very front, and an
 * arc that simply stops leaves either a needle or a visible corner. The centre
 * of that sphere sits on the axis at `len − rn`, and internal tangency puts it
 * exactly `R − rn` from the ogive's centre — which is what fixes `R` above.
 *
 * ⚠️ IT DEGRADES TO AN ELLIPSE WHEN THE NOSE IS SHORTER THAN THE BULLET IS
 * WIDE. Below `len = r` no tangent ogive exists: the algebra returns an `R`
 * under `r`, the centre crosses the axis and the tangency point comes out with
 * a NEGATIVE radius, which draws a nose folded inside out. Nothing throws.
 * A wadcutter, or bad data, takes a quarter ellipse instead.
 */
function noseInto(out: Point[], x0: number, r: number, len: number): void {
  if (len <= 0.01 || r <= 0) {
    out.push([x0 + Math.max(len, 0), 0]);
    return;
  }

  const N = 18;
  if (len < r) {
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      out.push([x0 + len * t, r * Math.sqrt(Math.max(1 - t * t, 0))]);
    }
    out[out.length - 1] = [x0 + len, 0];
    return;
  }

  /** The tip's own radius. */
  const rn = Math.min(0.22 * r, len * 0.28);
  /** The ogive radius that meets the shank flat and the tip sphere tangentially. */
  const R = ((len - rn) ** 2 + r * r - rn * rn) / (2 * (r - rn));
  /** Its centre sits below the axis, on the normal through the shank. */
  const cy = r - R;
  /** Where the ogive hands over to the tip sphere. */
  const xT = (R * (len - rn)) / (R - rn);
  const yT = (rn * (R - r)) / (R - rn);

  for (let i = 1; i <= N; i++) {
    const x = (xT * i) / N;
    out.push([x0 + x, cy + Math.sqrt(Math.max(R * R - x * x, 0))]);
  }

  const T = 6;
  const a0 = Math.atan2(yT, xT - (len - rn));
  for (let i = 1; i <= T; i++) {
    const a = a0 * (1 - i / T);
    out.push([x0 + len - rn + rn * Math.cos(a), rn * Math.sin(a)]);
  }
  out[out.length - 1] = [x0 + len, 0];
}

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

  /**
   * ⚠️ THE BEARING SURFACE IS PROPORTIONAL, NOT A FLAT 6 mm. Six millimetres
   * of full-diameter bullet standing proud of the case mouth is most of a
   * 9 mm Luger's entire exposed length — it left barely four millimetres for
   * the nose, so the round drew as a cylinder with a blob on the end. A short
   * run of shank and then the curve is what a seated bullet looks like, and
   * taking it as a fraction of what is actually exposed means the same rule
   * suits a pistol round and a rifle round.
   *
   * The old clamp is kept in spirit: the nose can never start past the tip.
   */
  const exposed = Math.max(0, D.L6 - D.L3);
  const shank = Math.min(D.L3 + Math.min(Math.max(exposed * 0.22, 0.6), 3), D.L6);
  p.push([shank, D.G1 / 2]);
  noseInto(p, shank, D.G1 / 2, D.L6 - shank);
  /**
   * ⚠️ THE TIP IS SET FROM L6, NOT ARRIVED AT BY ADDING UP. `shank` plus
   * `L6 − shank` is L6 in arithmetic and not always in floating point, and the
   * silhouette closing a thousandth of a millimetre short of the overall
   * length is invisible on the page and fails an exact assertion.
   */
  p[p.length - 1] = [D.L6, 0];
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

/* ── Which letters the pictures actually carry ──────────────────────── */

/**
 * The dimensions the 2D drawing annotates, plus the shoulder arc.
 *
 * ⚠️ THE TABLE LISTS THIRTEEN LETTERS AND THE DRAWING ANNOTATES NINE. The
 * Dimensions rows advertise "hover a row to find it in the drawing", and the
 * four that no picture carries — R, E, E1, H2 — lit their own row and pointed
 * at nothing, which reads as a drawing that failed rather than as a figure
 * with no callout. These sets let the card offer the link on the rows that
 * have one and leave the rest as plain text.
 *
 * ⚠️ KEPT IN STEP WITH `buildRows()` IN CartridgeDrawing2D BY HAND. Deriving
 * it would mean calling the builder for a set of letters, which needs a full
 * `Dims`; a comment on both sides is the cheaper honest answer.
 */
export const DRAWN_LETTERS_2D: readonly string[] = [
  'L1', 'L2', 'L3', 'L6', 'R1', 'P1', 'P2', 'H1', 'G1', 'α', 'alpha',
];

/**
 * The letters the 3D views carry.
 *
 * The same nine dimensions are drawn, and the calliper adds two more: E1 and
 * H2 have station dots it snaps to, so hovering those rows does light
 * something. α is not in 3D — there is no arc to light — so it is not here.
 */
export const DRAWN_LETTERS_3D: readonly string[] = [
  'L1', 'L2', 'L3', 'L6', 'R1', 'P1', 'P2', 'H1', 'G1', 'E1', 'H2',
];

/* ── COAL ───────────────────────────────────────────────────────────── */

/** Within this much of the maximum, a COAL is flagged. */
export const COAL_NEAR_MAX_MM = 0.5;

export interface CoalCheck {
  /** Tag text, empty when the COAL is comfortably under maximum. */
  t: string;
  bad: boolean;
  /** Millimetres under L6; negative means over. */
  diff: number;
  /**
   * Past the maximum.
   *
   * ⚠️ READ THIS RATHER THAN `diff < 0`. A round a hair over — 71.7601 against
   * a 71.76 maximum — rounds to `-0`, and `-0 < 0` is FALSE in JavaScript, so
   * a caller testing the sign printed "0.00 mm under the maximum · check" over
   * a round that is over it. The decision is taken on the unrounded difference
   * here, once, and every surface reads the answer.
   */
  over: boolean;
}

/**
 * ⚠️ COMPARED AGAINST L6, THE MAXIMUM CARTRIDGE LENGTH — never against the
 * chamber. A round longer than L6 may not chamber and can raise pressure, so
 * this flags at the standard, and the wording says "check" rather than
 * asserting the round is unsafe.
 */
export function coalCheck(coal: number, l6: number): CoalCheck {
  // ⚠️ THE DECISION IS TAKEN ON THE UNROUNDED DIFFERENCE, THE PRINTING ON THE
  // ROUNDED ONE. A COAL 0.001 mm over the maximum rounds to `-0`, which is not
  // less than zero, so a rounded test called it under — and the gauge printed
  // "0.00 mm under the maximum · check" for a round that will not chamber.
  const raw = l6 - coal;
  const diff = Math.round(raw * 100) / 100;
  if (raw < 0) return { t: 'COAL OVER MAX', bad: true, diff, over: true };
  if (diff <= COAL_NEAR_MAX_MM) {
    return { t: `COAL −${diff.toFixed(2)} MAX`, bad: true, diff, over: false };
  }
  return { t: '', bad: false, diff, over: false };
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
