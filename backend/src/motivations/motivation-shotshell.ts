import type { DrawingText } from './motivation-cartridge-drawing';

// ────────────────────────────────────────────────────────────────────
// THE SHOT SHELL.
//
// ⚠️ A SHOTGUN DOES NOT TAKE A BULLETTED CASE, AND THE DRAWING ENGINE KNOWS
// ONLY THOSE. `profile()` cuts a silhouette around a shoulder and a seated
// bullet, and every fill is brass behind the neck and copper in front of it.
// A shot shell has none of that: a brass head with a rim, a straight plastic
// hull, and a crimped mouth that closes the case. Forcing it through the
// bullet path drew a bottle-shaped case with an ogive on top.
//
// ⚠️ THE FIGURES ARE THE C.I.P. SHEET'S, NOT OURS. Each entry below is read
// from the Tab VII datasheet for that cartridge (g = rim, d = head, h = hull,
// l = case length, t = rim thickness, Pmax). Nothing here is estimated: a
// dimension printed under an applicant's signature has to come off the sheet.
//
// ⚠️ AND THE HEAD HEIGHT IS THE ONE THING THAT IS NOT A FIGURE. C.I.P. does
// not publish it — it depends on the case maker — so it is DRAWN at a
// conventional proportion and carries NO callout. The eye needs the join to
// see brass at the back and plastic at the front; no reader should think we
// measured it.
// ────────────────────────────────────────────────────────────────────

export interface ShotShell {
  /** C.I.P. designation, e.g. "12/70". */
  name: string;
  /** What the applicant's card prints, e.g. "12 Gauge". */
  label: string;
  /** g — rim diameter, mm. */
  rimMm: number;
  /** t — rim thickness, mm. */
  rimThickMm: number;
  /** d — head diameter, mm. */
  headMm: number;
  /** h — hull diameter, mm. */
  hullMm: number;
  /** l — case length, mm. */
  lengthMm: number;
  /** Pmax, bar. */
  pmaxBar: number;
}

/**
 * The three gauges we hold a C.I.P. sheet for. Figures from Tab VII of the
 * C.I.P. TDCC (12/70: 84-06-14, rev 18-10-17; 20/70 and 410/70 likewise).
 */
export const SHOT_SHELLS: readonly ShotShell[] = [
  {
    name: '12/70',
    label: '12 Gauge',
    rimMm: 22.45,
    rimThickMm: 1.85,
    headMm: 20.6,
    hullMm: 20.2,
    lengthMm: 69.8,
    pmaxBar: 740,
  },
  {
    name: '20/70',
    label: '20 Gauge',
    rimMm: 19.4,
    rimThickMm: 1.55,
    headMm: 17.7,
    hullMm: 17.35,
    lengthMm: 69.8,
    pmaxBar: 830,
  },
  {
    name: '410/70',
    label: '.410 Gauge',
    rimMm: 13.6,
    rimThickMm: 1.55,
    headMm: 12.0,
    hullMm: 11.75,
    lengthMm: 69.8,
    pmaxBar: 830,
  },
];

/**
 * Does this calibre name a shot gauge?
 *
 * ⚠️ BOTH SPELLINGS, AND NOT A RIFLE. Cards print "12 Gauge" and the C.I.P.
 * table prints "12/70"; a rifle is never either. A bare "410" is a gauge too,
 * which is why the check is not only the word "gauge".
 */
export function shotShellFor(calibre: string | undefined): ShotShell | null {
  const printed = (calibre ?? '').trim().toLowerCase();
  if (!printed) return null;
  const gauge = /\b(12|16|20|28)\s*gauge\b/.exec(printed);
  const slash = /\b(\d{2,3})\/(\d{2,3})\b/.exec(printed);
  const bare = /\b(410|\.410)\b/.exec(printed);

  let bore: number | null = null;
  let length = 70;
  if (gauge) bore = Number(gauge[1]);
  else if (bare) bore = 410;
  else if (slash) {
    const first = Number(slash[1]);
    length = Number(slash[2]);
    bore = first === 410 || first === 41 ? 410 : first;
  }
  if (bore === null) return null;

  const want = bore === 410 ? '410/70' : `${bore}/70`;
  const exact = SHOT_SHELLS.find((s) => s.name === want);
  if (exact && length === 70) return exact;
  /**
   * A chambering we hold no sheet for (12/76, 20/65) still draws from the
   * 70 mm sheet's proportions? No — that would print the wrong length. Return
   * the base gauge only when the length is the one we hold, else nothing.
   */
  return length === 70 ? exact ?? null : null;
}

const CALLOUT_MM = 2.7;
const f2 = (v: number) => v.toFixed(2);
const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

/**
 * The shell as an SVG, laid out the way the cartridge drawings are: real
 * millimetres of paper, brass at the rear, plastic at the front, and only the
 * C.I.P. figures called out.
 */
export function shotshellDrawing(
  shell: ShotShell,
  opts: { hero?: boolean } = {},
): { svg: string; widthMm: number; heightMm: number; texts: DrawingText[] } {
  const widthMm = 166;
  const marginL = 13;
  const marginR = 13;
  const S = (widthMm - marginL - marginR) / shell.lengthMm;

  const halfRim = (shell.rimMm / 2) * S;
  // A conventional head height, drawn only — never labelled.
  const headH = Math.min(shell.lengthMm * 0.12, 9) * S;
  const halfHead = (shell.headMm / 2) * S;
  const halfHull = (shell.hullMm / 2) * S;

  const axisY = halfRim + (opts.hero ? 3 : 10);
  const topY = axisY - halfRim;
  const botY = axisY + halfRim;
  const heightMm = botY + (opts.hero ? 12 : 22);

  const x0 = marginL;
  const xRimEnd = x0 + shell.rimThickMm * S;
  const xHeadEnd = x0 + headH;
  const xMouth = x0 + shell.lengthMm * S;
  const px = (mmFromRim: number) => x0 + mmFromRim * S;
  const py = (r: number) => axisY - r;

  const texts: DrawingText[] = [];

  /** A length dimension under the shell. */
  const lengthDim = (from: number, to: number, label: string, tier = 0) => {
    const y = botY + 4 + tier * 6;
    const a = px(from);
    const b = px(to);
    texts.push({
      x: (a + b) / 2,
      y: y - 1.6,
      text: label,
      size: CALLOUT_MM,
      anchor: 'middle',
      role: 'callout',
    });
    return `<path d="M${f2(a)} ${f2(botY + 1.5)} L${f2(a)} ${f2(y + 2)}" class="ext"/>
      <path d="M${f2(b)} ${f2(botY + 1.5)} L${f2(b)} ${f2(y + 2)}" class="ext"/>
      <path d="M${f2(a)} ${f2(y)} L${f2(b)} ${f2(y)}" class="dim" marker-start="url(#ar)" marker-end="url(#ar)"/>`;
  };

  /** A diameter callout above the shell, on a level of its own. */
  const diaDim = (x: number, dia: number, tier: number) => {
    const y = topY - 3 - tier * 5.5;
    texts.push({
      x,
      y: y - 1.2,
      text: `Ø${n2(dia)}`,
      size: CALLOUT_MM,
      anchor: 'middle',
      role: 'callout',
    });
    return `<path d="M${f2(x)} ${f2(topY - 2)} L${f2(x)} ${f2(y + 2)}" class="ext"/>
      <path d="M${f2(x - 3)} ${f2(y)} L${f2(x + 3)} ${f2(y)}" class="dim" marker-start="url(#ar)" marker-end="url(#ar)"/>`;
  };

  // ── the silhouette ──────────────────────────────────────────────
  // Rim, then the head, then the straight hull, closed by a crimped mouth.
  const rimPath = `M${f2(x0)} ${f2(axisY - halfRim)}
    L${f2(xRimEnd)} ${f2(axisY - halfRim)}
    L${f2(xRimEnd)} ${f2(axisY - halfHead)}
    L${f2(xHeadEnd)} ${f2(axisY - halfHead)}
    L${f2(xHeadEnd)} ${f2(axisY - halfHull)}
    L${f2(xMouth)} ${f2(axisY - halfHull)}
    A${f2(halfHull)} ${f2(halfHull)} 0 0 1 ${f2(xMouth)} ${f2(axisY + halfHull)}
    L${f2(xHeadEnd)} ${f2(axisY + halfHull)}
    L${f2(xHeadEnd)} ${f2(axisY + halfHead)}
    L${f2(xRimEnd)} ${f2(axisY + halfHead)}
    L${f2(xRimEnd)} ${f2(axisY + halfRim)}
    L${f2(x0)} ${f2(axisY + halfRim)} Z`;

  // The crimp: the pleats that close a loaded shell's mouth.
  const pleats = Array.from({ length: 7 }, (_, i) => {
    const angle = (Math.PI / 2) * (i / 6);
    const ex = xMouth - Math.cos(angle) * halfHull * 0.55;
    const ey = axisY - Math.sin(angle) * halfHull * 0.9;
    return `M${f2(xMouth)} ${f2(axisY)} L${f2(ex)} ${f2(ey)}`;
  }).join(' ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${n2(heightMm)}" width="${widthMm}mm" height="${n2(heightMm)}mm">
  <defs>
    <linearGradient id="brassHead" gradientUnits="userSpaceOnUse" x1="0" y1="${f2(axisY - halfHead)}" x2="0" y2="${f2(axisY + halfHead)}">
      <stop offset="0" stop-color="#5b471c"/>
      <stop offset="0.16" stop-color="#d9c07a"/>
      <stop offset="0.3" stop-color="#f4e6b8"/>
      <stop offset="0.55" stop-color="#c9a851"/>
      <stop offset="0.85" stop-color="#8a6c2c"/>
      <stop offset="1" stop-color="#5b471c"/>
    </linearGradient>
    <linearGradient id="redHull" gradientUnits="userSpaceOnUse" x1="0" y1="${f2(axisY - halfHull)}" x2="0" y2="${f2(axisY + halfHull)}">
      <stop offset="0" stop-color="#5c0f10"/>
      <stop offset="0.14" stop-color="#a8231f"/>
      <stop offset="0.3" stop-color="#e04a3c"/>
      <stop offset="0.42" stop-color="#f07a66"/>
      <stop offset="0.6" stop-color="#c93328"/>
      <stop offset="0.85" stop-color="#8d1b17"/>
      <stop offset="1" stop-color="#5c0f10"/>
    </linearGradient>
    <marker id="ar" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M0 0 L6 3 L0 6 Z" fill="#111"/>
    </marker>
    <style>
      .ext { stroke:#7a7a7a; stroke-width:0.28; fill:none }
      .dim { stroke:#111; stroke-width:0.32; fill:none }
      .callout { font-family:Helvetica,Arial,sans-serif; fill:#111 }
    </style>
  </defs>
  <path d="${rimPath}" fill="url(#brassHead)"/>
  <path d="M${f2(xHeadEnd)} ${f2(axisY - halfHull)} L${f2(xMouth)} ${f2(axisY - halfHull)}
    A${f2(halfHull)} ${f2(halfHull)} 0 0 1 ${f2(xMouth)} ${f2(axisY + halfHull)}
    L${f2(xHeadEnd)} ${f2(axisY + halfHull)} Z" fill="url(#redHull)"/>
  <path d="${pleats}" stroke="#4a0c0b" stroke-width="0.35" fill="none" opacity="0.55"/>
  ${opts.hero ? '' : diaDim(px(shell.lengthMm * 0.55), shell.hullMm, 0)}
  ${opts.hero ? '' : diaDim((x0 + xRimEnd) / 2, shell.rimMm, 1)}
  ${opts.hero ? '' : diaDim((xRimEnd + xHeadEnd) / 2, shell.headMm, 2)}
  ${lengthDim(0, shell.lengthMm, `${n2(shell.lengthMm)} mm`)}
</svg>`;

  return { svg, widthMm, heightMm, texts };
}
