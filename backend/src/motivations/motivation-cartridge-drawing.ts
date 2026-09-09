// ────────────────────────────────────────────────────────────────────
// THE CARTRIDGE, DRAWN FROM THE SHEET, FOR THE PACK.
//
// Operator, 2026-09-09: "you can render the cartridge in 3D with the main
// measurements and make it half a page with half a page description", then
// "that drawing does not look like a cartridge" and "remeber to draw the finer
// detail like the rim part as well".
//
// It is drawn side-on and shaded as a solid of revolution, which is what makes
// a photograph of a cartridge read as a cartridge: one light, a bright band a
// quarter of the way down, and both edges rolling into shadow. The case and the
// bullet are lit separately because they are different metals.
//
// ⚠️ THE SILHOUETTE IS A PORT OF `frontend/lib/bench/geometry.ts`, NOT A SECOND
// DESIGN. That module is pure and already draws this cartridge on The Bench;
// the shape a member sees there and the shape printed in their pack must be
// the same shape. It is copied rather than imported because the backend cannot
// reach the frontend's lib, and there is no shared package — the same reason
// `lib/scan-v3` is a vendored copy. ⚠️ IF THE BENCH'S PROFILE CHANGES, CHANGE
// THIS ONE: the spec pins the vertex list so the two cannot drift silently.
//
// ⚠️ AND IT NAMES NO SOURCE, for the same reason motivation-cartridge.ts does
// not. CLAUDE.md's Bench rule is a copyright boundary, not a style note.
//
// PURE — figures in, SVG out. No Nest, no Prisma, no fonts, no measurement of
// text; every label is placed from the geometry.
// ────────────────────────────────────────────────────────────────────

/** The thirteen figures the silhouette reads, as the sheet prints them. */
export interface DrawingDims {
  /** Rim or flange thickness. */
  R: number;
  /** Rim diameter. */
  R1: number;
  /** Where the extractor groove ends. */
  E: number;
  /** Extractor groove diameter. */
  E1: number;
  /** Body diameter at the head. */
  P1: number;
  /** Body diameter where the shoulder starts. */
  P2: number;
  /** Shoulder start. */
  L1: number;
  /** Shoulder end. */
  L2: number;
  /** Case length. */
  L3: number;
  /** Maximum cartridge length. */
  L6: number;
  /** Neck diameter at the shoulder. */
  H1: number;
  /** Neck diameter at the mouth. */
  H2: number;
  /** Bullet diameter. */
  G1: number;
}

export type Point = [number, number];

const DIM_KEYS: (keyof DrawingDims)[] = [
  'R',
  'R1',
  'E',
  'E1',
  'P1',
  'P2',
  'L1',
  'L2',
  'L3',
  'L6',
  'H1',
  'H2',
  'G1',
];

/** Every figure the profile reads, present and finite. */
export function canDraw(
  d: Partial<DrawingDims> | null | undefined,
): d is DrawingDims {
  if (!d) return false;
  return DIM_KEYS.every(
    (k) => typeof d[k] === 'number' && Number.isFinite(d[k]),
  );
}

/**
 * The figures no cartridge can be drawn without.
 *
 * ⚠️ THE OTHER SEVEN ARE DERIVED, NOT DEMANDED, AND THAT IS THE WHOLE REASON
 * `completeDims` EXISTS. A sheet for a case with no shoulder does not print a
 * shoulder: 9 mm Luger carries no P2, L1, L2 or H1, and .38 Special carries no
 * E or E1 either, because a rimmed revolver case has no extractor groove to
 * measure. Of the 215 sheets held, only 132 print all thirteen letters — so a
 * drawing that insists on thirteen refuses exactly the two cartridges a
 * self-defence applicant is most likely to be applying for.
 */
const REQUIRED: (keyof DrawingDims)[] = ['R', 'R1', 'P1', 'L3', 'L6', 'G1'];

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * A complete set of figures, or null.
 *
 * ⚠️ A DERIVED LETTER IS A COLLAPSE, NEVER AN INVENTION. Where a case has no
 * shoulder the shoulder is placed AT the mouth (L1 = L2 = L3) and the diameters
 * either side of it are the mouth's own, so the body simply runs from P1 to the
 * mouth as the real case does. Where there is no extractor groove the groove
 * diameter is the body's, so the flange stands proud of a straight wall. In
 * both cases the silhouette drawn is the silhouette the sheet describes; no
 * figure is guessed at, and nothing is dimensioned that was not printed.
 */
export interface CompletedDims {
  dims: DrawingDims;
  /**
   * The letters the sheet did NOT print, which this filled in.
   *
   * ⚠️ A DERIVED LETTER IS NEVER DIMENSIONED. The drawing may need a figure to
   * know what shape to cut, and still have no business printing it beside the
   * cartridge as though it were published: a .38 Special has no extractor
   * groove, so calling out its groove diameter states a measurement of a
   * feature that does not exist. Callouts come off this set.
   */
  derived: ReadonlySet<keyof DrawingDims>;
}

export function completeDims(
  d:
    | Partial<Record<keyof DrawingDims, number | null | undefined>>
    | null
    | undefined,
): CompletedDims | null {
  if (!d) return null;
  for (const k of REQUIRED) if (num(d[k]) === undefined) return null;

  const derived = new Set<keyof DrawingDims>();
  for (const k of DIM_KEYS) if (num(d[k]) === undefined) derived.add(k);

  const R = num(d.R)!;
  const R1 = num(d.R1)!;
  const P1 = num(d.P1)!;
  const L3 = num(d.L3)!;
  const L6 = num(d.L6)!;
  const G1 = num(d.G1)!;

  // The mouth: whichever of the neck figures the sheet printed, else the body.
  const mouth = num(d.H2) ?? num(d.H1) ?? num(d.P2) ?? P1;

  /**
   * ⚠️ THE GROOVE IS HELD CLEAR OF THE RIM, OR THE SILHOUETTE FOLDS. The
   * profile reads a vertex at `E − 0.9`, which on a rimmed case with no groove
   * (E derived as R = 1.5 on a .38 Special) lands at 0.6 — BEHIND the rim
   * vertex at 1.5. The polyline then runs backwards, the outline crosses
   * itself and the head draws as a bow tie. Nothing fails; it just draws a
   * cartridge that does not exist.
   */
  const E = Math.max(num(d.E) ?? R, R + 0.9);
  const E1 = num(d.E1) ?? P1;

  // No shoulder printed means no shoulder: put it at the mouth.
  const L1 = num(d.L1) ?? L3;
  const L2 = num(d.L2) ?? L1;
  const P2 = num(d.P2) ?? (L1 >= L3 ? mouth : P1);
  const H1 = num(d.H1) ?? mouth;

  const out: DrawingDims = {
    R,
    R1,
    E,
    E1,
    P1,
    P2,
    L1,
    L2,
    L3,
    L6,
    H1,
    H2: mouth,
    G1,
  };
  return canDraw(out) && L6 > L3 && L3 > E ? { dims: out, derived } : null;
}

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
 * ⚠️ TANGENCY IS NECESSARY AND NOT SUFFICIENT. A sphere can meet the arc
 * perfectly flat and still read as a cap bolted on, because what the eye
 * follows is CURVATURE, not slope: hand over from a 66 mm arc to a 0.74 mm one
 * across a tenth of a millimetre and the point visibly stops being the ogive.
 * The join is invisible only while the sphere is too small to see, which is
 * what sizing `rn` below is for.
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

  /**
   * The tip's own radius.
   *
   * ⚠️ IT SCALES WITH HOW POINTED THE ROUND IS, AND A FLAT FRACTION OF THE
   * BULLET RADIUS DOES NOT. This was `0.22 r` for every cartridge alike — on a
   * 6.5 Creedmoor a 1.5 mm ball on the end of a 6.7 mm bullet. By the time a
   * three-calibre ogive reaches the front it has narrowed to well under that,
   * so the sphere stopped softening the point and BECAME the point: the
   * outline left the arc half a millimetre short, bulged back out to meet the
   * ball, and ended on a vertical face. Operator, 2026-09-09: "the tip was
   * wrong and did not follow the correct o-give."
   *
   * The rule that works is the one real bullets follow — a SHORT nose is a
   * round nose and a LONG nose is a spitzer — so the tip radius falls away as
   * the nose lengthens, measured in calibres of the bullet it sits on. A 9 mm
   * Luger's nose is 0.9 calibres and keeps a 16 % tip, which is the round nose
   * it has; a .223's is 1.7 and keeps 7 %; a 6.5 Creedmoor's is 3.1 and keeps
   * under 3 %, which is a point. One expression, no special cases, and the
   * ogive radii the cartridges already drew at — 1.1, 3.4 and 9.9 calibres —
   * barely move, because this changes the last half-millimetre and not the
   * curve.
   *
   * ⚠️ IT IS A SHAPE RULE, NOT A PUBLISHED FIGURE. No C.I.P. sheet prints a
   * tip radius or a meplat. So it decides how the drawn bullet LOOKS and is
   * never dimensioned on the page — the same standing as the bearing-surface
   * fraction in `profile`, and the reason neither is ever called out.
   */
  const noseCalibres = len / (2 * r);
  const tipFrac = 0.3 / (1 + noseCalibres * noseCalibres);
  const rn = Math.min(tipFrac * r, len * 0.28);
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
 * The half-silhouette, head at x=0, tip at x=L6.
 *
 * ⚠️ PORTED VERBATIM FROM THE BENCH, INCLUDING THE SHANK CLAMP. On a short
 * pistol case `L6 − L3` can be under 6 mm, and an unclamped 6 mm shank runs
 * PAST the tip: the ogive length goes negative, the silhouette folds back on
 * itself and the drawing shows a cartridge that does not exist.
 */
export function profile(D: DrawingDims): Point[] {
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

/**
 * The figures the body prints beside the firearm, in the order a reader wants
 * them: what the round IS, then what it measures, then what it runs at.
 *
 * ⚠️ EVERY LABEL IS PLAIN ENGLISH AND NAMES NO SOURCE. The sheet's own letters
 * mean nothing to a DFO — "P2" is not a word — and the standard they come from
 * may not be named on a page we publish. See the drawing module and CLAUDE.md's
 * Bench rule: it is a copyright boundary, not a style note.
 *
 * ⚠️ AND THE SET STOPS WHERE A READER STOPS. A sheet carries thirteen letters,
 * several of which locate the shoulder and the extractor groove along the axis.
 * Printing all thirteen makes the block an engineering drawing in words, which
 * is the fault the hero was trimmed to avoid; these nine are the ones that
 * identify a chambering and let somebody check it.
 */
export const DIM_LABELS: [keyof DrawingDims | 'pmax', string, 'mm' | 'bar'][] = [
  ['L6', 'Overall length', 'mm'],
  ['L3', 'Case length', 'mm'],
  ['G1', 'Bullet diameter', 'mm'],
  ['H2', 'Neck diameter', 'mm'],
  ['P2', 'Shoulder diameter', 'mm'],
  ['P1', 'Base diameter', 'mm'],
  ['R1', 'Rim diameter', 'mm'],
  ['R', 'Rim thickness', 'mm'],
  ['pmax', 'Maximum average pressure', 'bar'],
];

export function cartridgeDimRows(
  dims: DrawingDims,
  derived: ReadonlySet<keyof DrawingDims>,
  pmaxBar: number | null | undefined,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [key, label, unit] of DIM_LABELS) {
    if (key === 'pmax') {
      if (typeof pmaxBar === 'number' && Number.isFinite(pmaxBar)) {
        out.push({ label, value: `${Math.round(pmaxBar)} ${unit}` });
      }
      continue;
    }
    /**
     * ⚠️ A STOOD-IN LETTER IS NEVER PRINTED. `completeDims` fills the gaps so
     * a shape can be cut — a case with no shoulder gets its shoulder placed at
     * the mouth — and printing that as a shoulder diameter states a
     * measurement of a feature the cartridge does not have. It is the same set
     * the drawing's own callouts refuse.
     */
    if (derived.has(key)) continue;
    const v = dims[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.push({ label, value: `${v.toFixed(2)} ${unit}` });
  }
  return out;
}

/** What the caption prints beside the drawing. */
export interface DrawingLabels {
  /** The cartridge's standardised name. */
  name: string;
  /** Maximum average pressure in bar, or null. */
  pmaxBar?: number | null;
}

/**
 * One piece of lettering, in the drawing's own millimetre space.
 *
 * ⚠️ THE LETTERING IS NOT IN THE SVG, AND THAT IS DELIBERATE. The first
 * attempt set the callouts as SVG <text> and asked the rasteriser to find a
 * font: librsvg has no `system-ui`, fell back to whatever fontconfig offered,
 * and printed the dimensions on a firearms application in a typewriter face.
 * Which face it picks depends on the fonts installed on the box, so the same
 * code renders differently in development and in production and neither one is
 * the document's own type.
 *
 * So the SVG carries geometry only and the caller sets these in the pack's
 * fonts as real vector text — sharper on paper, selectable in the PDF, and
 * identical wherever it is built.
 */
export interface DrawingText {
  /** Millimetres from the drawing's left edge. */
  x: number;
  /** Millimetres from the drawing's top edge, at the BASELINE. */
  y: number;
  text: string;
  /** Type size in millimetres. */
  size: number;
  anchor: 'start' | 'middle';
  /** Callouts are set in the figure face; the caption is the caption. */
  role: 'callout' | 'caption';
}

export interface CartridgeDrawing {
  /** Geometry only — no lettering, no fonts. */
  svg: string;
  widthMm: number;
  heightMm: number;
  texts: DrawingText[];
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const f2 = (v: number) => v.toFixed(2);

/**
 * ⚠️ THE STOPS ARE A LIT CYLINDER, NOT A DECORATIVE FADE. Dark at the top edge
 * where the surface turns away from the eye, brightest about a quarter down
 * where it faces the light, a long roll into shadow, then a slight lift at the
 * very bottom where light bounces back off whatever it is lying on.
 * Symmetrical stops make it look like a flat printed ribbon.
 */
const BRASS: [number, string][] = [
  [0, '#6b5624'],
  [0.06, '#9d8138'],
  [0.16, '#d9c07a'],
  [0.26, '#f4e6b8'],
  [0.36, '#e3cc8d'],
  [0.52, '#c9a851'],
  [0.72, '#9d7f38'],
  [0.9, '#6d5522'],
  [0.97, '#8a6c2c'],
  [1, '#5b471c'],
];

/**
 * Gilding metal — the jacket, and it is COPPER, not more brass.
 *
 * ⚠️ THE FIRST PAIR WERE BOTH BRASS, ONE A SHADE PALER. Cartridge brass is
 * roughly 70 % copper and 30 % zinc and comes out yellow; a jacket is about
 * 95 % copper and reads distinctly red beside it. Lit with the same stops in
 * a lighter tint, the two metals differed only in exposure, so the round read
 * as one turned piece with a seam rather than as a bullet seated in a case.
 * Operator, 2026-09-09: "the case and the bullet should be different color.
 * case brass and bullet head copper. make it realistic."
 *
 * The lighting is deliberately the SAME structure as the brass — dark top
 * edge, highlight a quarter down, long roll into shadow, bounce at the bottom
 * — because both are turned surfaces under one light. Only the hue moves.
 */
const JACKET: [number, string][] = [
  [0, '#5c2f13'],
  [0.06, '#8c4a1f'],
  [0.16, '#c97a45'],
  [0.26, '#f0b98a'],
  [0.36, '#dc9a63'],
  [0.52, '#bd7238'],
  [0.72, '#95521f'],
  [0.9, '#63340f'],
  [0.97, '#7d451a'],
  [1, '#4d2710'],
];

const CALLOUT_MM = 2.7;
const CAPTION_MM = 3.1;

/**
 * A half-page technical illustration of the cartridge.
 *
 * ⚠️ ONE GRADIENT ACROSS THE WHOLE SOLID, IN USER SPACE — never one per
 * polygon. A gradient left in its default object-bounding-box units restarts
 * inside every shape it fills, so the half above the axis and the half below
 * each took a full sweep from highlight to shadow: the cartridge came out lit
 * from two directions at once, with a seam down the axis where the darkest
 * edge of one half met the darkest edge of the other. Anchored in user space,
 * both halves read one light and the thing looks turned.
 *
 * ⚠️ AND THE CASE AND THE BULLET ARE LIT SEPARATELY, because they are
 * different metals and the join at the case mouth is the line that tells a
 * reader where the case ends. Filling both from one gradient draws a solid
 * brass slug — which is what the first attempt did, and why the operator said
 * it did not look like a cartridge.
 *
 * @param widthMm the printed width. The A4 text column in the layout spec is
 *                166 mm, and half a page of that is what this is drawn for.
 */
export interface DrawingOptions {
  /**
   * The printed width. The A4 text column in the layout spec is 166 mm, and
   * half a page of that is what this is drawn for.
   */
  widthMm?: number;
  /** Letters `completeDims` filled in. They are drawn but never dimensioned. */
  derived?: ReadonlySet<keyof DrawingDims>;
  /**
   * Draw it as the pack's COVER HERO rather than as a figure in the body.
   *
   * Operator, 2026-09-09: "i think we put the renedered cartridge as the Hero
   * image on the frontpage with it's basic dimensions and the Firearm
   * manufacturer and caliber as a nice biggish readable subscript for it."
   *
   * ⚠️ "BASIC DIMENSIONS" IS THE WHOLE INSTRUCTION, AND IT IS A SUBTRACTION.
   * The body figure carries five diameter callouts on two tiers above the
   * silhouette, each on its own leader line — which is right where a reader
   * has the prose beside it, and wrong on a cover, where it turns the first
   * page of a licence application into an engineering sheet. The hero keeps
   * the two lengths a person actually quotes, case and overall, and drops the
   * rest. They are not lost: the full set is what the C.I.P. table in the
   * body is for.
   *
   * ⚠️ AND IT DROPS THE CAPTION, because the cover sets its own. The caption
   * here is 3.1 mm of type sized for a figure; the operator asked for the make
   * and the calibre "biggish and readable", which is a display line the pack
   * sets in its own faces at its own size.
   *
   * The saving is vertical and it is what makes room on the page: the two
   * callout tiers above and the caption below come off, so the block lands at
   * roughly two thirds the height for the same width.
   */
  hero?: boolean;
}

export function cartridgeDrawing(
  D: DrawingDims,
  labels: DrawingLabels,
  opts: DrawingOptions = {},
): CartridgeDrawing {
  const widthMm = opts.widthMm ?? 166;
  const derived = opts.derived ?? new Set<keyof DrawingDims>();
  // Laid out in millimetres of PAPER, so the caller can place it at a known
  // size and the callouts keep their weight.
  const marginL = 13;
  const marginR = 13;
  const S = (widthMm - marginL - marginR) / D.L6;

  const hero = opts.hero ?? false;

  const maxR = Math.max(D.R1, D.E1, D.P1, D.P2, D.H1, D.H2, D.G1) / 2;
  const halfH = maxR * S;
  /**
   * Headroom for two tiers of diameter callouts above the silhouette — and
   * none at all on the hero, which draws no diameters.
   */
  const axisY = halfH + (hero ? 2 : 15);
  const topY = axisY - halfH;
  const botY = axisY + halfH;
  /**
   * Room below for the two length tiers, and for the caption under them.
   *
   * ⚠️ THE LOWEST INK IS THE SECOND TIER'S EXTENSION LINE, which stops two
   * millimetres below that tier. Trim past it and the overall-length dimension
   * is clipped SILENTLY — the SVG has no clip path, so the callout simply
   * falls outside the viewBox and the rasteriser drops it.
   */
  const heightMm = botY + (hero ? 14 : 30);

  /**
   * Where the length tiers sit below the silhouette, and how far apart.
   *
   * ⚠️ TIGHTER ON THE HERO BECAUSE HEIGHT IS WHAT IT PAYS FOR WIDTH. The hero
   * is scaled to the room the cover has left after the address block and the
   * particulars grid, so every millimetre of white space inside the drawing
   * comes straight off how big the cartridge is on the page. On the body
   * figure there is a whole column to spend and the callouts get their air.
   */
  const dimBase = hero ? 5 : 8;
  const dimStep = hero ? 5.5 : 8;

  const px = (x: number) => marginL + x * S;
  const py = (r: number) => axisY - r * S;

  const P = profile(D);
  const texts: DrawingText[] = [];
  const parts: string[] = [];

  /** The half-silhouette mirrored about the axis and closed. */
  const closed = (pts: Point[]) =>
    [
      ...pts.map((p) => `${f2(px(p[0]))},${f2(py(p[1]))}`),
      ...[...pts].reverse().map((p) => `${f2(px(p[0]))},${f2(py(-p[1]))}`),
    ].join(' ');

  /**
   * Split at the neck/bullet junction — the vertex at (L3, G1/2) — exactly as
   * the Bench's `paths()` does, so the case and the seated bullet can be
   * filled as the two metals they are.
   */
  let ci = P.length - 1;
  for (let i = 0; i < P.length; i++) {
    if (P[i][0] === D.L3 && P[i][1] === D.G1 / 2) {
      ci = i;
      break;
    }
  }
  const casePts = P.slice(0, ci + 1);
  const bulletPts = P.slice(ci);

  /**
   * The specular line.
   *
   * ⚠️ IT FOLLOWS THE RADIUS; IT IS NOT A STRAIGHT RULE. On a surface of
   * revolution under one light the highlight sits at a fixed ANGLE from the
   * light, so its height above the axis is proportional to the local radius —
   * it narrows through the extractor groove and rolls over the ogive. Drawn as
   * a straight horizontal streak it reads as a scratch on the paper rather
   * than as light on a curved surface.
   */
  const spec = (pts: Point[]) =>
    pts
      .filter((p) => p[1] > 0.2)
      .map((p, i) => `${i ? 'L' : 'M'}${f2(px(p[0]))} ${f2(py(p[1] * 0.6))}`)
      .join(' ');

  /** A length dimension under the drawing, on its own tier. */
  const lengthDim = (from: number, to: number, tier: number, label: string) => {
    const y = botY + dimBase + tier * dimStep;
    const a = px(from);
    const b = px(to);
    parts.push(
      `<path d="M${f2(a)} ${f2(botY + 1.5)} L${f2(a)} ${f2(y + 2)}" class="ext"/>`,
      `<path d="M${f2(b)} ${f2(botY + 1.5)} L${f2(b)} ${f2(y + 2)}" class="ext"/>`,
      `<path d="M${f2(a)} ${f2(y)} L${f2(b)} ${f2(y)}" class="dim" marker-start="url(#ar)" marker-end="url(#ar)"/>`,
    );
    texts.push({
      x: (a + b) / 2,
      y: y - 1.6,
      text: label,
      size: CALLOUT_MM,
      anchor: 'middle',
      role: 'callout',
    });
  };

  /**
   * A diameter callout above the drawing.
   *
   * ⚠️ THE LEADER STARTS AT THE SILHOUETTE'S OWN EDGE AND RUNS UP, AWAY FROM
   * IT. The first attempt placed the label at a fixed height that fell INSIDE
   * the cartridge on anything with a wide rim, so Ø9.96 printed across the
   * brass with its leader pointing down into the body.
   */
  const shown = new Set<string>();
  const diaDim = (
    key: keyof DrawingDims,
    atMm: number,
    dia: number,
    tier: number,
  ) => {
    if (derived.has(key)) return;
    /**
     * ⚠️ THE SAME FIGURE IS NOT CALLED OUT TWICE. A straight-walled revolver
     * case measures the same diameter at the head and at the mouth, so the
     * .38 Special came out with Ø9.63 printed three times across the top of
     * the drawing — which reads as a drawing that has lost count rather than
     * as a cylinder.
     */
    const label = `Ø${n2(dia)}`;
    if (shown.has(label)) return;
    shown.add(label);
    const x = px(atMm);
    const y = topY - 4 - tier * 6;
    parts.push(
      `<path d="M${f2(x)} ${f2(py(dia / 2) - 0.8)} L${f2(x)} ${f2(y + 1.2)}" class="ext"/>`,
    );
    texts.push({
      x,
      y,
      text: label,
      size: CALLOUT_MM,
      anchor: 'middle',
      role: 'callout',
    });
  };

  const grad = (id: string, r: number, stops: [number, string][]) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${f2(py(r))}" x2="0" y2="${f2(py(-r))}">` +
    stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
    '</linearGradient>';

  const caseR = Math.max(D.R1, D.P1, D.H2) / 2;

  if (!hero) {
    diaDim('R1', D.R / 2, D.R1, 1);
    diaDim('E1', D.E - 0.45, D.E1, 0);
    diaDim('P1', Math.min(D.E + 3, D.L3 - 1), D.P1, 1);
    diaDim('H2', D.L3 - 0.5, D.H2, 0);
    diaDim('G1', D.L3 + Math.min(3.5, (D.L6 - D.L3) / 2), D.G1, 1);
  }
  lengthDim(0, D.L3, 0, `case ${n2(D.L3)} mm`);
  lengthDim(0, D.L6, 1, `overall ${n2(D.L6)} mm`);

  if (!hero) {
    texts.push({
      x: marginL,
      y: heightMm - 3,
      text:
        labels.name +
        (labels.pmaxBar
          ? ` · maximum average pressure ${labels.pmaxBar} bar`
          : '') +
        ' · drawn to scale, dimensions in millimetres',
      size: CAPTION_MM,
      anchor: 'start',
      role: 'caption',
    });
  }

  /**
   * ⚠️ THE SLIGHT ANGLE IS TWO ELLIPSES, NOT A ROTATION.
   *
   * Operator, 2026-09-09: "continue with the cartridge 3D, make it at a very
   * slight angle to make it very realisitic looking."
   *
   * Turning the whole drawing a few degrees is the obvious reading and it is
   * the wrong one HERE: every diameter callout is a horizontal line landing on
   * the silhouette, and every length runs along the axis. Rotate the body and
   * the dimension lines either rotate with it — measurements printed on a
   * slant, which a DFO reads as a sloppy drawing — or stay put and stop
   * touching the thing they measure.
   *
   * What a cartridge photographed from a few degrees off the axis actually
   * shows is its END FACES: the head becomes a shallow ellipse, and a flat
   * bullet tip becomes a smaller one. That is the whole cue. The silhouette
   * stays square to the page, the callouts still land, and the object reads as
   * round rather than as a cut-out.
   *
   * ⚠️ THE SQUASH IS 0.15, AND IT WAS CHOSEN BY LOOKING. At 0.34 — about
   * twenty degrees — the head becomes a broad disc that bulges past the rim
   * plane, and the R1 extension line, whose datum IS that plane, ends in empty
   * paper beside it. The measurement stops touching the thing it measures,
   * which is the failure a rotation of the whole drawing would have caused
   * everywhere at once.
   *
   * At 0.15 the ellipse is about two millimetres across on a 166 mm drawing:
   * plainly round on paper at 300 dpi, and still inside the rim plane so every
   * callout lands where it did. "a very slight angle" is the operator's phrase
   * and it is also the constraint.
   */
  const TILT = 0.15;
  const faceRx = (r: number) => Math.max(0.35, r * S * TILT);
  const headR = D.R1 / 2;
  const headFace =
    `<ellipse cx="${f2(px(0))}" cy="${f2(axisY)}" rx="${f2(faceRx(headR))}" ` +
    `ry="${f2(headR * S)}" fill="url(#headFace)" class="headFace"/>` +
    /**
     * ⚠️ THE PRIMER POCKET, AND THE FIRST VERSION DREW THE WRONG CIRCLE. It
     * took `D.R / 2` — half the rim THICKNESS, which is a length along the
     * axis, not a radius — and rendered a dot the size of a full stop in the
     * middle of the head. `R1` is the rim DIAMETER; a large-rifle primer is
     * roughly 5.3 mm in an 11.5 mm head, so it is a little under half of it.
     *
     * It is what stops the head reading as a plain brass disc, and it is the
     * "finer detail like the rim part" the operator asked for when this
     * drawing was first built.
     */
    `<ellipse cx="${f2(px(0))}" cy="${f2(axisY)}" rx="${f2(faceRx(headR * 0.46))}" ` +
    `ry="${f2(headR * 0.46 * S)}" class="headRing"/>`;
  /**
   * ⚠️ NO FACE ON THE BULLET, AND THE FIRST ATTEMPT PROVED WHY.
   *
   * A face was drawn at the tip from `G1`, on the reading that it was the
   * meplat of a flat or hollow point. It is not — it is a bullet DIAMETER, so
   * the drawing came out with a brown disc the full width of the bullet
   * floating on the point of a spitzer. Rendered and looked at, which is the
   * only way that was ever going to be caught.
   *
   * There is no meplat figure on a C.I.P. sheet, and a spitzer has none worth
   * drawing anyway. So the tip stays a point: inventing a face there is
   * exactly the fault this comment set out to avoid, committed by reaching for
   * the nearest letter that happened to be a radius.
   */

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${n2(heightMm)}" width="${widthMm}mm" height="${n2(heightMm)}mm">
<defs>
  ${grad('caseBrass', caseR, BRASS)}
  ${grad('jacket', D.G1 / 2, JACKET)}
  <linearGradient id="glint" gradientUnits="userSpaceOnUse" x1="${f2(px(0))}" y1="0" x2="${f2(px(D.L6))}" y2="0">
    <stop offset="0" stop-color="#fffaf0" stop-opacity="0"/>
    <stop offset="0.12" stop-color="#fffaf0" stop-opacity="0.5"/>
    <stop offset="0.8" stop-color="#fffaf0" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#fffaf0" stop-opacity="0"/>
  </linearGradient>
  <!--
    ⚠️ THE HEAD FACE IS LIT FROM THE OTHER SIDE, and that is what sells the
    angle. The body's own gradient runs top-dark / middle-bright / bottom-dark
    across a surface curving TOWARDS the viewer; the head is a flat disc turned
    slightly AWAY, so it takes a flatter, darker wash with its highlight low
    and to the left, where the same light would catch its edge. Lighting it
    like the body makes the two read as one flat shape again.
  -->
  <linearGradient id="headFace" gradientUnits="userSpaceOnUse" x1="0" y1="${f2(py(D.R1 / 2))}" x2="0" y2="${f2(py(-D.R1 / 2))}">
    <stop offset="0" stop-color="#6b5a2e"/>
    <stop offset="0.55" stop-color="#a08a46"/>
    <stop offset="1" stop-color="#5a4a24"/>
  </linearGradient>
  <marker id="ar" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto">
    <path d="M0 3 L6 0 L6 6 z" fill="#1a1613"/>
  </marker>
</defs>
<style>
  .dim{fill:none;stroke:#1a1613;stroke-width:0.22}
  .ext{fill:none;stroke:#9c948a;stroke-width:0.18;stroke-dasharray:1.2 1}
  .axis{fill:none;stroke:#9c948a;stroke-width:0.16;stroke-dasharray:4 1.4 0.7 1.4}
  .edge{fill:none;stroke:#4a3c22;stroke-width:0.28;stroke-linejoin:round}
  .edgeCu{fill:none;stroke:#3f200c;stroke-width:0.28;stroke-linejoin:round}
  .spec{fill:none;stroke:url(#glint);stroke-width:0.9;stroke-linecap:round}
  .mouth{fill:none;stroke:#4a3c22;stroke-width:0.32}
  /* The two faces the slight angle reveals. See the head-face note below. */
  .headFace{stroke:#4a3c22;stroke-width:0.22}
  .headRing{fill:none;stroke:#4a3c22;stroke-width:0.18}
</style>
<polygon points="${closed(casePts)}" fill="url(#caseBrass)"/>
<polygon points="${closed(bulletPts)}" fill="url(#jacket)"/>
<path d="${spec(casePts)}" class="spec"/>
<path d="${spec(bulletPts)}" class="spec"/>
<polygon points="${closed(casePts)}" class="edge"/>
<polygon points="${closed(bulletPts)}" class="edgeCu"/>
<path d="M${f2(px(D.L3))} ${f2(py(D.H2 / 2))} L${f2(px(D.L3))} ${f2(py(-D.H2 / 2))}" class="mouth"/>
${headFace}
<path d="M${f2(px(-0.8))} ${f2(axisY)} L${f2(px(D.L6 + 0.8))} ${f2(axisY)}" class="axis"/>
${parts.join('\n')}
</svg>`;

  return { svg, widthMm, heightMm, texts };
}
