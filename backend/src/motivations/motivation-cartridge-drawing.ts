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
  const shank = Math.max(D.L3, Math.min(D.L3 + 6, D.L6 - 0.5));
  p.push([shank, D.G1 / 2]);
  const n = 14;
  const len = Math.max(0, D.L6 - shank);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    p.push([
      shank + len * t,
      (D.G1 / 2) * Math.sqrt(1 - t * t) * (1 - 0.04 * t) + 0.35 * (1 - t),
    ]);
  }
  p[p.length - 1] = [D.L6, 0.55];
  p.push([D.L6, 0]);
  return p;
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

/** Gilding metal: paler and pinker than the case, as a jacket is. */
const JACKET: [number, string][] = [
  [0, '#7a6533'],
  [0.06, '#ad9257'],
  [0.16, '#e5d3a3'],
  [0.26, '#faf1d6'],
  [0.36, '#efdcaf'],
  [0.52, '#d8bd7c'],
  [0.72, '#ab9053'],
  [0.9, '#7c6537'],
  [0.97, '#9a8047'],
  [1, '#66532a'],
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

  const maxR = Math.max(D.R1, D.E1, D.P1, D.P2, D.H1, D.H2, D.G1) / 2;
  const halfH = maxR * S;
  /** Headroom for two tiers of diameter callouts above the silhouette. */
  const axisY = halfH + 15;
  const topY = axisY - halfH;
  const botY = axisY + halfH;
  const heightMm = botY + 30;

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
    const y = botY + 8 + tier * 8;
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

  diaDim('R1', D.R / 2, D.R1, 1);
  diaDim('E1', D.E - 0.45, D.E1, 0);
  diaDim('P1', Math.min(D.E + 3, D.L3 - 1), D.P1, 1);
  diaDim('H2', D.L3 - 0.5, D.H2, 0);
  diaDim('G1', D.L3 + Math.min(3.5, (D.L6 - D.L3) / 2), D.G1, 1);
  lengthDim(0, D.L3, 0, `case ${n2(D.L3)} mm`);
  lengthDim(0, D.L6, 1, `overall ${n2(D.L6)} mm`);

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
  <marker id="ar" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto">
    <path d="M0 3 L6 0 L6 6 z" fill="#1a1613"/>
  </marker>
</defs>
<style>
  .dim{fill:none;stroke:#1a1613;stroke-width:0.22}
  .ext{fill:none;stroke:#9c948a;stroke-width:0.18;stroke-dasharray:1.2 1}
  .axis{fill:none;stroke:#9c948a;stroke-width:0.16;stroke-dasharray:4 1.4 0.7 1.4}
  .edge{fill:none;stroke:#4a3c22;stroke-width:0.28;stroke-linejoin:round}
  .spec{fill:none;stroke:url(#glint);stroke-width:0.9;stroke-linecap:round}
  .mouth{fill:none;stroke:#4a3c22;stroke-width:0.32}
</style>
<polygon points="${closed(casePts)}" fill="url(#caseBrass)"/>
<polygon points="${closed(bulletPts)}" fill="url(#jacket)"/>
<path d="${spec(casePts)}" class="spec"/>
<path d="${spec(bulletPts)}" class="spec"/>
<polygon points="${closed(casePts)}" class="edge"/>
<polygon points="${closed(bulletPts)}" class="edge"/>
<path d="M${f2(px(D.L3))} ${f2(py(D.H2 / 2))} L${f2(px(D.L3))} ${f2(py(-D.H2 / 2))}" class="mouth"/>
<path d="M${f2(px(-0.8))} ${f2(axisY)} L${f2(px(D.L6 + 0.8))} ${f2(axisY)}" class="axis"/>
${parts.join('\n')}
</svg>`;

  return { svg, widthMm, heightMm, texts };
}
