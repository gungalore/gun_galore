/**
 * Build the powder burn-rate chart from OUR OWN powder inventory (every powder
 * we hold published ManualLoad data for), positioned by burn rate.
 *
 * Source of truth = the ManualLoad seed. Burn rate + maker come from the
 * vendored GRT dataset (693 powders: maker `mname`, name `pname`, burn-rate
 * `Ba` — higher = faster). Ba → a 0..1 vertical position (0 fast, 1 slow) via a
 * curve calibrated on the Vihtavuori chart. Powders GRT lacks are placed by a
 * hand-curated residual map (anchored to powders GRT does have).
 *
 * Because the seed names the same powder several ways across manuals (e.g.
 * "2700" / "A-2700" / "Accurate 2700"), each of which is its own powderKey, we
 * MERGE keys that resolve to the same powder into one chart cell carrying all
 * the keys (so the hover unions every load and there are no duplicate cells).
 *
 *   node scripts/build-db-powder-chart.mjs
 * Output: src/load-lab/data/powder-burn-rate.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BK = path.join(__dirname, '..');
const require_ = createRequire(import.meta.url);

function powderKey(name) {
  let s = (name || '').toLowerCase().trim();
  s = s.replace(/^(hodgdon|vihtavuori|vv|viht|alliant|winchester|norma|somchem|ramshot|nobelsport|nobel sport|lovex)\s+/, '');
  s = s.replace(/^reloder\s*/, 'rl');
  return s.replace(/[^a-z0-9]/g, '');
}
const norm = (s) => (s || '').toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]/g, '');
const MAKER_ABBR = { Accurate: ['a', 'aa'], Winchester: ['w', 'win'], IMR: ['imr'], ADI: ['adi'], Hodgdon: ['h'] };

// Powders GRT lacks → anchored to powders it has. Keyed by powderKey. `canon`
// merges the manuals' name variants into one cell.
const RESIDUAL = {
  // Hodgdon
  h380: { maker: 'Hodgdon', canon: 'H380', anchors: ['H4895', 'Varget'] },
  h414: { maker: 'Hodgdon', canon: 'H414', anchors: ['H4350', '760'] },
  h50bmg: { maker: 'Hodgdon', canon: 'H50BMG', anchors: ['Retumbo'] },
  h870: { maker: 'Hodgdon', canon: 'H870', anchors: ['Retumbo'] },
  us869: { maker: 'Hodgdon', canon: 'US 869', anchors: ['Retumbo'] },
  suprform: { maker: 'Hodgdon', canon: 'Superformance', anchors: ['H4350', 'RL17'] },
  superformance: { maker: 'Hodgdon', canon: 'Superformance', anchors: ['H4350', 'RL17'] },
  trailboss: { maker: 'Hodgdon', canon: 'Trail Boss', anchors: ['Unique'] },
  clays: { maker: 'Hodgdon', canon: 'Clays', anchors: ['Titegroup'] },
  // IMR
  imr4320: { maker: 'IMR', canon: 'IMR 4320', anchors: ['4064', 'Varget'] },
  sr4759: { maker: 'IMR', canon: 'IMR SR 4759', anchors: ['4198'] },
  sr4756: { maker: 'IMR', canon: 'IMR SR 4756', anchors: ['Unique'] },
  imrsr4756: { maker: 'IMR', canon: 'IMR SR 4756', anchors: ['Unique'] },
  sr7625: { maker: 'IMR', canon: 'IMR SR 7625', anchors: ['Unique'] },
  imr4007ssc: { maker: 'IMR', canon: 'IMR 4007 SSC', anchors: ['4064', 'RL15'] },
  imr800x: { maker: 'IMR', canon: 'IMR 800-X', anchors: ['Blue Dot'] },
  '800x': { maker: 'IMR', canon: 'IMR 800-X', anchors: ['Blue Dot'] },
  imr700x: { maker: 'IMR', canon: 'IMR 700-X', anchors: ['Titegroup'] },
  '700x': { maker: 'IMR', canon: 'IMR 700-X', anchors: ['Titegroup'] },
  pb: { maker: 'IMR', canon: 'PB', anchors: ['Unique'] },
  // Accurate
  '2700': { maker: 'Accurate', canon: 'Accurate 2700', anchors: ['4064', 'Varget'] },
  a2700: { maker: 'Accurate', canon: 'Accurate 2700', anchors: ['4064', 'Varget'] },
  accurate2700: { maker: 'Accurate', canon: 'Accurate 2700', anchors: ['4064', 'Varget'] },
  '4100': { maker: 'Accurate', canon: 'Accurate 4100', anchors: ['H4350'] },
  a4100: { maker: 'Accurate', canon: 'Accurate 4100', anchors: ['H4350'] },
  '8700': { maker: 'Accurate', canon: 'Accurate 8700', anchors: ['Retumbo'] },
  '2200': { maker: 'Accurate', canon: 'Accurate 2200', anchors: ['H335'] },
  a2200: { maker: 'Accurate', canon: 'Accurate 2200', anchors: ['H335'] },
  magpro: { maker: 'Accurate', canon: 'MagPro', anchors: ['H4831', 'RL22'] },
  no11fs: { maker: 'Accurate', canon: 'No. 11 FS', anchors: ['2400'] },
  // Alliant
  rl25: { maker: 'Alliant', canon: 'Reloder 25', anchors: ['RL22', 'RL26'] },
  powerpro4000mr: { maker: 'Alliant', canon: 'Power Pro 4000-MR', anchors: ['H4350'] },
  '4000mr': { maker: 'Alliant', canon: 'Power Pro 4000-MR', anchors: ['H4350'] },
  americanselect: { maker: 'Alliant', canon: 'American Select', anchors: ['Bullseye'] },
  reddot: { maker: 'Alliant', canon: 'Red Dot', anchors: ['Bullseye'] },
  herco: { maker: 'Alliant', canon: 'Herco', anchors: ['Unique'] },
  be86: { maker: 'Alliant', canon: 'BE-86', anchors: ['Unique', 'Power Pistol'] },
  // Winchester
  staballmatch: { maker: 'Winchester', canon: 'StaBALL Match', anchors: ['Varget', 'RL15'] },
  staballhd: { maker: 'Winchester', canon: 'StaBALL HD', anchors: ['H1000', 'Retumbo'] },
  '572': { maker: 'Winchester', canon: 'Win 572', anchors: ['Unique'] },
  w572: { maker: 'Winchester', canon: 'Win 572', anchors: ['Unique'] },
  winsupreme780: { maker: 'Winchester', canon: 'Supreme 780', anchors: ['H4350'] },
  supreme780: { maker: 'Winchester', canon: 'Supreme 780', anchors: ['H4350'] },
  wsf: { maker: 'Winchester', canon: 'WSF', anchors: ['Unique', 'HS-6'] },
  wst: { maker: 'Winchester', canon: 'WST', anchors: ['Titegroup'] },
  // Ramshot
  enforcer: { maker: 'Ramshot', canon: 'Enforcer', anchors: ['2400', 'H110'] },
  grand: { maker: 'Ramshot', canon: 'Grand', anchors: ['H1000', 'Retumbo'] },
  zip: { maker: 'Ramshot', canon: 'Zip', anchors: ['Titegroup'] },
  competition: { maker: 'Ramshot', canon: 'Competition', anchors: ['Titegroup'] },
  lrt: { maker: 'Ramshot', canon: 'LRT', anchors: ['Retumbo'] },
  // ADI
  ar2206: { maker: 'ADI', canon: 'AR2206', anchors: ['Varget', 'H4895'] },
  ar2207: { maker: 'ADI', canon: 'AR2207', anchors: ['Benchmark', 'H322'] },
  ar2218: { maker: 'ADI', canon: 'AR2218', anchors: ['Retumbo'] },
  bm1: { maker: 'ADI', canon: 'BM1', anchors: ['Benchmark'] },
  // Somchem
  s221: { maker: 'Somchem', canon: 'S221', anchors: ['HS-6', 'Blue Dot'] },
  mp200: { maker: 'Somchem', canon: 'MP200', anchors: ['Unique', 'Blue Dot'] },
  ms200: { maker: 'Somchem', canon: 'MS200', anchors: ['Bullseye'] },
  // Shooters World / Lovex (we hold some SW load data)
  swtacticalrifle: { maker: 'Shooters World', canon: 'Tactical Rifle', anchors: ['H335', 'BLC-2'] },
  swautopistol: { maker: 'Shooters World', canon: 'Auto Pistol', anchors: ['HS-6'] },
  swmatchrifle: { maker: 'Shooters World', canon: 'Match Rifle', anchors: ['Varget', 'RL15'] },
  swprecisionrifle: { maker: 'Shooters World', canon: 'Precision Rifle', anchors: ['Varget'] },
  swlongrifle: { maker: 'Shooters World', canon: 'Long Rifle', anchors: ['H4350', 'RL17'] },
  swcleanshot: { maker: 'Shooters World', canon: 'Clean Shot', anchors: ['Titegroup'] },
  swblackout: { maker: 'Shooters World', canon: 'Blackout', anchors: ['H110', 'Lil Gun'] },
  // Extra GRT gaps
  hs7: { maker: 'Hodgdon', canon: 'HS-7', anchors: ['Blue Dot'] },
  titewad: { maker: 'Hodgdon', canon: 'Titewad', anchors: ['Bullseye'] },
  h5010: { maker: 'Hodgdon', canon: 'H5010', anchors: ['Retumbo'] },
  rl50: { maker: 'Alliant', canon: 'Reloder 50', anchors: ['RL33'] },
  powerpro300mp: { maker: 'Alliant', canon: 'Power Pro 300-MP', anchors: ['2400', 'H110'] },
  imrsr4759: { maker: 'IMR', canon: 'IMR SR 4759', anchors: ['4198'] },
  imr7625: { maker: 'IMR', canon: 'IMR 7625', anchors: ['Unique'] },
  ar2214: { maker: 'ADI', canon: 'AR2214', anchors: ['Retumbo'] },
};

function loadDbPowders() {
  const lines = fs.readFileSync(path.join(BK, 'prisma/seed-data/manual-loads.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim());
  const byKey = new Map();
  for (const l of lines) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    const k = powderKey(r.powderName);
    if (!k) continue;
    let e = byKey.get(k);
    if (!e) byKey.set(k, (e = { freq: new Map(), count: 0 }));
    e.count += 1;
    e.freq.set(r.powderName, (e.freq.get(r.powderName) ?? 0) + 1);
  }
  return [...byKey].map(([key, e]) => ({
    key, count: e.count, name: [...e.freq].sort((a, b) => b[1] - a[1])[0][0],
  }));
}

function buildGrtIndex() {
  const { loadGrtData } = require_(path.join(BK, 'dist/src/load-lab/internal-ballistics/powder-coefficients.js'));
  const grt = loadGrtData().propellant;
  const groups = new Map();
  for (const p of grt) {
    const g = `${p.mname}||${p.pname}`;
    let a = groups.get(g);
    if (!a) groups.set(g, (a = { mname: p.mname, pname: p.pname, bas: [] }));
    a.bas.push(p.Ba);
  }
  const index = new Map();
  const add = (key, v) => { if (key && !index.has(key)) index.set(key, v); };
  for (const { mname, pname, bas } of groups.values()) {
    bas.sort((a, b) => a - b);
    const v = { maker: mname, pname, Ba: bas[Math.floor(bas.length / 2)] };
    const np = norm(pname);
    add(np, v); add(norm(mname + pname), v);
    for (const ab of MAKER_ABBR[mname] ?? []) add(ab + np, v);
    const core = np.replace(/(ssc|sc|xbr|fs|nf|3barrel|approx|superperformance)$/g, '');
    if (core && core !== np) { add(core, v); for (const ab of MAKER_ABBR[mname] ?? []) add(ab + core, v); }
    const rl = pname.match(/reloder\s*(ts\s*)?([\d.]+)/i);
    if (rl) add('rl' + rl[2].replace(/\./g, ''), v);
    if (mname === 'Alliant') { add('powerpro' + np, v); add('pp' + np, v); }
  }
  return index;
}

function dbCandidates(name) {
  const n = norm(name);
  const cs = new Set([n]);
  cs.add(n.replace(/^(a|w|win|imr|aa|adi|viht|vv)/, ''));
  cs.add(n.replace(/^(win|imr|accurate|hodgdon|winchester|alliant|norma|somchem|ramshot|adi|western|viht|vihtavuori)/, ''));
  cs.add(n.replace(/^powerpro/, ''));
  cs.add(n.replace(/(ssc|sc|xbr|nf|fs|br)$/, ''));
  const rl = name.match(/(?:reloder|rl)[\s-]*([\d.]+)/i);
  if (rl) cs.add('rl' + rl[1].replace(/\./g, ''));
  cs.delete('');
  return [...cs];
}
function resolveGrt(name, index) {
  for (const c of dbCandidates(name)) { const h = index.get(c); if (h) return h; }
  return null;
}

function main() {
  const db = loadDbPowders();
  const index = buildGrtIndex();
  const anchorBa = (name) => { const g = resolveGrt(name, index); return g ? g.Ba : null; };

  // Resolve each DB key to an identity (maker|canonicalName) + a Ba (burn rate),
  // then merge the manuals' name-variants (same identity) into one cell.
  const cells = new Map(); // identity -> {maker, name, keys[], ba, loadCount, approx}
  const dropped = [];
  for (const d of db) {
    let maker, name, ba, approx = false;
    const g = resolveGrt(d.name, index);
    if (g) { maker = g.maker; name = g.pname.replace(/\s*\(approx\.?\)\s*$/i, '').trim(); ba = g.Ba; }
    else {
      const r = RESIDUAL[d.key];
      const bas = r ? r.anchors.map(anchorBa).filter((v) => v != null) : [];
      if (r && bas.length) { maker = r.maker; name = r.canon; ba = bas.reduce((s, v) => s + v, 0) / bas.length; approx = true; }
      else { dropped.push(d); continue; }
    }
    const id = `${maker}|${name}`;
    let c = cells.get(id);
    if (!c) cells.set(id, (c = { maker, name, keys: [], ba, loadCount: 0, approx }));
    c.keys.push(d.key);
    c.loadCount += d.count;
  }

  // Position by burn-rate RANK — Ba descending (fast→slow) spread evenly over
  // 0..1. Even spacing (no collapsing distinct powders onto one spot) and the
  // order is authoritative (Ba is the burn metric). Ties break by name.
  const list = [...cells.values()].sort((a, b) => b.ba - a.ba || a.name.localeCompare(b.name));
  const n = list.length;
  const powders = list.map((c, i) => ({
    id: `p${i}`, maker: c.maker, name: c.name, keys: c.keys,
    yNorm: n > 1 ? +(i / (n - 1)).toFixed(4) : 0,
    loadCount: c.loadCount, approx: c.approx,
  }));

  const makerTotals = new Map();
  for (const p of powders) makerTotals.set(p.maker, (makerTotals.get(p.maker) ?? 0) + p.loadCount);
  const makers = [...makerTotals.keys()].sort((a, b) => makerTotals.get(b) - makerTotals.get(a));

  fs.writeFileSync(path.join(BK, 'src/load-lab/data/powder-burn-rate.json'), JSON.stringify({
    source: 'Gun Galore powder inventory (positioned by GRT burn-rate)',
    note: 'Powders in our load-data library, ordered by approximate burning rate (fast → slow).',
    makers, powders,
  }, null, 2));

  console.log(`DB keys: ${db.length} | cells: ${powders.length} | dropped: ${dropped.length}`);
  console.log(`makers (${makers.length}): ${makers.map((m) => `${m}(${powders.filter((p) => p.maker === m).length})`).join(', ')}`);
  if (dropped.length) console.log(`\nDROPPED (unidentifiable — load data unaffected):\n` + dropped.sort((a, b) => b.count - a.count).map((d) => `  ${d.count}\t${d.name} [${d.key}]`).join('\n'));
}
main();
