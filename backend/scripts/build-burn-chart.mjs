/**
 * Build the powder burn-rate chart dataset from the Vihtavuori Burning Rate
 * Chart PDF (a cross-manufacturer ranking of canister powders, fast → slow).
 *
 * Coordinate-aware extraction (pdfjs): the chart is 11 maker columns of powders
 * at aligned y-positions; plain text loses the row alignment, so we read each
 * text item's (x,y), assign it to a maker column by x, merge wrapped/continued
 * lines, split comma-joined cells into individual powders, and map y → a
 * normalised burn-rate position (0 = fastest/top, 1 = slowest/bottom). Powders
 * that share a y in the source share a burn-rate band across makers.
 *
 * Optionally merges researched Somchem placements (2nd arg): each Somchem
 * powder is anchored to 1-3 charted powders and positioned at their mean yNorm.
 *
 *   node scripts/build-burn-chart.mjs <chart.pdf> [somchem-placements.json]
 *
 * Output: src/load-lab/data/powder-burn-rate.json (bundled asset, served by
 * BurnChartService). Reference material only — never used for load development.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAKERS = [
  'Vihtavuori', 'Norma', 'RWS', 'Vectan', 'Reload Swiss',
  'IMR', 'Hodgdon', 'Accurate', 'Winchester', 'Alliant', 'Ramshot',
];
const CENTERS = [185, 275, 350, 435, 515, 590, 672, 760, 845, 912, 1002];
const EXCLUDE = new Set(['FAST BURNING', 'SLOW BURNING']);
const Y_TOP = 620; // fastest charted powder band
const Y_BOT = 52; // slowest charted powder band

// Same powder-identity normaliser the ManualLoad matcher uses, so chart cells
// join to published loads (recommended-loads.service.ts powderKey()).
function powderKey(name) {
  let s = (name || '').toLowerCase().trim();
  s = s.replace(
    /^(hodgdon|vihtavuori|vv|viht|alliant|winchester|norma|somchem|ramshot|nobelsport|nobel sport|lovex)\s+/,
    '',
  );
  s = s.replace(/^reloder\s*/, 'rl');
  return s.replace(/[^a-z0-9]/g, '');
}

// Cosmetic name fixups for cells the chart abbreviates/hyphenates oddly.
const NAME_FIX = {
  'H4831 SuperPerformance': 'Superformance',
  'Univer.': 'Universal',
  'Clays Int’l': 'Clays International',
  "Clays Int'l": 'Clays International',
  'SP2 Pract.': 'SP2 Practical',
};

function colOf(x) {
  let best = 0, bd = Infinity;
  CENTERS.forEach((c, i) => {
    const d = Math.abs(x - c);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function yToNorm(y) {
  return +Math.min(1, Math.max(0, (Y_TOP - y) / (Y_TOP - Y_BOT))).toFixed(4);
}

async function extractPowders(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ s: i.str.trim(), x: +i.transform[4].toFixed(1), y: +i.transform[5].toFixed(1) }));

  const cols = Array.from({ length: MAKERS.length }, () => []);
  for (const it of items) {
    if (it.y > 660 || it.y < 40) continue; // headers / title / disclaimer
    if (EXCLUDE.has(it.s)) continue;
    cols[colOf(it.x)].push(it);
  }

  const powders = [];
  let idc = 0;
  for (let c = 0; c < MAKERS.length; c++) {
    const list = cols[c].slice().sort((a, b) => b.y - a.y);
    // Merge wrapped continuation lines (small y-gap → same band cell; a
    // trailing hyphen means the word was split mid-token, e.g. "Leve-"+"revolution").
    const cells = [];
    for (const it of list) {
      const last = cells[cells.length - 1];
      if (last && last.y - it.y < 12) {
        if (last.text.endsWith('-')) last.text = last.text.slice(0, -1) + it.s;
        else last.text += ' ' + it.s;
      } else {
        cells.push({ y: it.y, text: it.s });
      }
    }
    for (const cell of cells) {
      const text = cell.text.replace(/Relo\.\s*/g, 'Reloder '); // Alliant "Relo. 23" → "Reloder 23"
      for (let raw of text.split(',')) {
        raw = raw.trim();
        if (!raw) continue;
        const name = NAME_FIX[raw] ?? raw;
        powders.push({
          id: `p${idc++}`,
          maker: MAKERS[c],
          name,
          key: powderKey(name),
          yNorm: yToNorm(cell.y),
        });
      }
    }
  }
  return powders;
}

// Merge researched placements for powders NOT on the source chart (Somchem,
// Lovex) or missing from a maker's column (new Winchester StaBALL powders).
// Each entry: { maker?, name (or legacy `somchem`), anchors[], confidence? }.
// Position = mean yNorm of the anchor powders that resolve on the chart.
function mergeAdditional(powders, placementsPath) {
  const raw = JSON.parse(fs.readFileSync(placementsPath, 'utf8'));
  const placements = raw.placements ?? raw;
  const byKey = new Map(powders.map((p) => [p.key, p]));
  let idc = powders.length;
  const added = [];
  for (const pl of placements) {
    const maker = pl.maker ?? 'Somchem';
    const name = pl.name ?? pl.somchem;
    const anchors = (pl.anchors || []).map((a) => byKey.get(powderKey(a))).filter(Boolean);
    if (!name || anchors.length === 0) {
      console.warn(`  ! ${maker} ${name ?? '(unnamed)'}: no anchor matched (${(pl.anchors || []).join(', ')}) — skipped`);
      continue;
    }
    const yNorm = +(anchors.reduce((s, a) => s + a.yNorm, 0) / anchors.length).toFixed(4);
    added.push({
      id: `p${idc++}`,
      maker,
      name,
      key: powderKey(name),
      yNorm,
      approx: true,
      anchors: anchors.map((a) => a.name),
      confidence: pl.confidence ?? null,
    });
  }
  added.sort((a, b) => a.yNorm - b.yNorm);
  console.log(`  merged ${added.length}/${placements.length} additional powders`);
  return added;
}

async function main() {
  const [pdfPath, placementsPath] = process.argv.slice(2);
  if (!pdfPath) {
    console.error('usage: build-burn-chart.mjs <chart.pdf> [somchem-placements.json]');
    process.exit(1);
  }
  const powders = await extractPowders(pdfPath);
  const makers = [...MAKERS];
  if (placementsPath && fs.existsSync(placementsPath)) {
    const extra = mergeAdditional(powders, placementsPath);
    for (const p of extra) if (!makers.includes(p.maker)) makers.push(p.maker);
    powders.push(...extra);
  }
  const out = {
    source: 'Vihtavuori Burning Rate Chart',
    note: 'Current canister powders in order of approximate burning rate.',
    makers,
    powders,
  };
  const dest = path.join(__dirname, '..', 'src', 'load-lab', 'data', 'powder-burn-rate.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  const somCount = powders.filter((p) => p.somchem).length;
  console.log(`Wrote ${powders.length} powders (${makers.length} makers, ${somCount} Somchem) -> ${dest}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
