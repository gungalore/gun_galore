/**
 * THE BENCH — the one-off import. Standalone, NOT wired into app boot.
 *
 * Reads the three source files off the operator's machine and builds the
 * canonical tables: cartridges, powders, bullet makers, every source row, and
 * the consolidated loads the page actually serves.
 *
 *   Usage:
 *     npx ts-node -r tsconfig-paths/register src/bench/scripts/bench-import.ts --dir <data dir>
 *
 * Idempotent: everything upserts on a natural key, so a re-run is a no-op
 * rather than a duplicate.
 *
 * ⚠️ THE CSV MUST BE PARSED WITH QUOTES HONOURED. European cartridge names
 * use the comma as a decimal separator — "6,5 Creedmoor", "7,62 x 54 R" — so
 * a naive split(',') silently shears every one of them in half and then keys
 * the wrong cartridge. The parser below is minimal but RFC-4180 correct on
 * the two things that matter: quoted fields containing commas, and doubled
 * quotes inside them.
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { cartridgeKey } from '../../common/cartridge-key';
import { consolidate, needsReview, pickDisplayName } from '../consolidate';

/**
 * ⚠️ CONSTRUCTED INSIDE main(), AFTER THE ARGUMENTS ARE CHECKED. At module
 * scope it connects on load, so running the script with a typo in --dir
 * fails with a database error instead of the usage line.
 */
let prisma: PrismaClient;

/* ── CSV ────────────────────────────────────────────────────────────── */

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // doubled quote
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/* ── Normalisers ────────────────────────────────────────────────────── */

/** "6,5 Creedmoor" → "6-5-creedmoor" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/,/g, '-')
    .replace(/[\s.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Canonical powder name: collapse whitespace and dashes, upper-case letters,
 * keep digits. "H 4350" and "H4350" are one powder; "N-160" and "N160" are one.
 */
function powderKey(printed: string): string {
  return printed.toUpperCase().replace(/[\s-]+/g, '').replace(/[^A-Z0-9]/g, '');
}

/** Makers whose printed forms differ between manuals. */
const MAKER_ALIASES: Record<string, string> = {
  HDY: 'Hornady', SRA: 'Sierra', SIE: 'Sierra', NOS: 'Nosler', SPR: 'Speer',
  BAR: 'Barnes', BER: 'Berger', SFT: 'Swift', LAP: 'Lapua', WIN: 'Winchester',
};

/**
 * Bullet category, first match wins.
 *
 * ⚠️ ORDER IS THE SPEC. MONO before SP, because a TTSX is a monolithic that
 * also matches nothing else; HP before SP, because "ELD Match" must not fall
 * through to the soft-point bucket. Anything uncertain becomes OTHER, which
 * forms its own group rather than being guessed into a neighbour's — a
 * mis-grouped bullet would put one projectile's charge range under another's
 * name.
 */
const CATEGORY_RULES: [RegExp, string][] = [
  [/\b(FMJ|TMJ)\b/i, 'FMJ'],
  [/\b(TTSX|TSX|GMX|CX|Classic Hunter)\b/i, 'MONO'],
  [/\b(ELD-?X|SST|Ballistic ?Tip|V-?MAX|TIP)\b/i, 'TIP'],
  [/\b(HPBT|BTHP|ELD-?M|ELD ?Match|Match|Scenar|HP)\b/i, 'HP'],
  [/(\bL\)|\bcast\b|RNGC|LSWC)/i, 'CAST'],
  [/\b(InterLock|Partition|A-?Frame|TOG|SP|Spitzer|SPBT)\b/i, 'SP'],
];

function bulletCategory(rawType: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(rawType)) return cat;
  return 'OTHER';
}

/** Splits a leading maker alias out of the type string. */
function splitMaker(manufacturer: string, rawType: string): { maker: string | null; type: string } {
  if (manufacturer) return { maker: MAKER_ALIASES[manufacturer.toUpperCase()] ?? manufacturer, type: rawType };
  const first = rawType.split(/\s+/)[0]?.toUpperCase() ?? '';
  if (MAKER_ALIASES[first]) {
    return { maker: MAKER_ALIASES[first], type: rawType.slice(first.length).trim() };
  }
  return { maker: null, type: rawType };
}

const num = (v: string): number | null => {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const int = (v: string): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};


/**
 * ⚠️ THE FAILURE THIS CATCHES LOOKS LIKE SUCCESS. The first run of this import
 * used invented column names — `powder`, `start_grains`, `max_fps`, `L3` —
 * none of which the CSVs carry. Every lookup returned undefined, every row was
 * skipped by a guard, and the script printed a tidy report of zeros and exited
 * 0. The tables were created, the deploy was green, and the Bench answered
 * "Nothing matches that name" for every search.
 *
 * So the columns are asserted up front, by name, and a missing one stops the
 * import instead of quietly importing nothing.
 */
function requireColumns(rows: Record<string, string>[], want: string[], file: string): void {
  if (!rows.length) {
    console.error(`
${file} has no data rows.
`);
    process.exit(1);
  }
  const have = new Set(Object.keys(rows[0]));
  const missing = want.filter((c) => !have.has(c));
  if (missing.length) {
    console.error(
      `
${file} is missing expected column(s): ${missing.join(', ')}
` +
        `  columns present: ${[...have].join(', ')}
`,
    );
    process.exit(1);
  }
}

/* ── Import ─────────────────────────────────────────────────────────── */

interface Report {
  cartridgesWithoutReference: string[];
  unresolvedPowders: string[];
  singleSourceGroups: number;
  wideSpreadGroups: { cartridge: string; powder: string; weightGr: number; startGr: number; maxGr: number }[];
  counts: Record<string, number>;
}

async function main(): Promise<void> {
  const dirFlag = process.argv.indexOf('--dir');
  const dir = dirFlag >= 0 ? process.argv[dirFlag + 1] : '';
  if (!dir) {
    console.error('Usage: bench-import.ts --dir <data dir>\n');
    process.exit(1);
  }

  const loadsPath = path.join(dir, 'consolidated_loads.csv');
  const refPath = path.join(dir, 'cartridge_reference.csv');
  for (const p of [loadsPath, refPath]) {
    try { await fs.access(p); } catch {
      console.error(`Missing: ${p}\nBoth consolidated_loads.csv and cartridge_reference.csv must be in --dir.\n`);
      process.exit(1);
    }
  }

  prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

  const report: Report = {
    cartridgesWithoutReference: [], unresolvedPowders: [],
    singleSourceGroups: 0, wideSpreadGroups: [], counts: {},
  };

  /* 1 ─ Cartridges */
  console.log('1/6  cartridges');
  const refRows = parseCsv(await fs.readFile(refPath, 'utf8'));
  requireColumns(
    refRows,
    ['cartridge_european', 'cartridge_as_printed', 'case_length_mm',
     'max_cartridge_length_mm', 'max_pressure_psi', 'cartridge_type', 'origin', 'year'],
    'cartridge_reference.csv',
  );
  const byEuropean = new Map<string, Record<string, string>>();
  const aliasesFor = new Map<string, Set<string>>();

  for (const r of refRows) {
    const european = r.cartridge_european?.trim();
    if (!european) continue;
    if (!byEuropean.has(european)) byEuropean.set(european, r);
    const printed = r.cartridge_as_printed?.trim();
    if (printed) {
      const set = aliasesFor.get(european) ?? new Set<string>();
      set.add(printed);
      aliasesFor.set(european, set);
    }
  }

  for (const [european, r] of byEuropean) {
    const key = cartridgeKey(european);
    const psi = int(r.max_pressure_psi ?? '');
    await prisma.benchCartridge.upsert({
      where: { key },
      create: {
        key, name: european, slug: slugify(european),
        type: r.cartridge_type || null, origin: r.origin || null, year: int(r.year ?? ''),
        caseLengthMm: num(r.case_length_mm ?? ''), maxLengthMm: num(r.max_cartridge_length_mm ?? ''),
        pmaxPsi: psi, pmaxBar: psi === null ? null : Math.round(psi / 14.5038),
      },
      update: {
        name: european, slug: slugify(european),
        caseLengthMm: num(r.case_length_mm ?? ''), maxLengthMm: num(r.max_cartridge_length_mm ?? ''),
        pmaxPsi: psi, pmaxBar: psi === null ? null : Math.round(psi / 14.5038),
      },
    });
    for (const printed of aliasesFor.get(european) ?? []) {
      await prisma.benchCartridgeAlias.upsert({
        where: { printed }, create: { printed, cartridgeKey: key }, update: { cartridgeKey: key },
      });
    }
  }
  report.counts.cartridges = byEuropean.size;

  /* 2 ─ Source rows, powders and makers */
  console.log('2/6  reading loads');
  const loadRows = parseCsv(await fs.readFile(loadsPath, 'utf8'));
  requireColumns(
    loadRows,
    ['cartridge_european', 'cartridge_as_printed', 'cartridge_name_source',
     'bullet_weight_gr', 'bullet_manufacturer', 'bullet_type',
     'powder_name', 'powder_manufacturer',
     'start_charge_gr', 'start_velocity_fps', 'max_charge_gr', 'max_velocity_fps',
     'coal_mm', 'source_manual', 'source_page'],
    'consolidated_loads.csv',
  );
  report.counts.sourceRowsRead = loadRows.length;

  console.log('3/6  powders');
  const powderIdByKey = new Map<string, string>();
  const printedCounts = new Map<string, Map<string, number>>();
  const makerFor = new Map<string, string>();
  for (const r of loadRows) {
    const printed = r.powder_name?.trim();
    if (!printed) continue;
    const k = powderKey(printed);
    if (!k) { report.unresolvedPowders.push(printed); continue; }
    const mk = r.powder_manufacturer?.trim();
    if (mk && !makerFor.has(k)) makerFor.set(k, mk);
    const forms = printedCounts.get(k) ?? new Map<string, number>();
    forms.set(printed, (forms.get(printed) ?? 0) + 1);
    printedCounts.set(k, forms);
  }
  for (const [k, forms] of printedCounts) {
    // Display name is the printed form, not the canonical key: the reloader
    // reads "H4350" off a bottle, not a normalised token. pickDisplayName also
    // keeps the branded casing — a straight majority elects "VARGET".
    const display = pickDisplayName(forms);
    // The maker rides along: "H4350" means little without "Hodgdon" beside it.
    const maker = makerFor.get(k) ?? null;
    const row = await prisma.benchPowder.upsert({
      where: { name: display },
      create: { name: display, maker },
      update: maker ? { maker } : {},
    });
    powderIdByKey.set(k, row.id);
    for (const printed of forms.keys()) {
      await prisma.benchPowderAlias.upsert({
        where: { printed }, create: { printed, powderId: row.id }, update: { powderId: row.id },
      });
    }
  }
  report.counts.powders = printedCounts.size;

  for (const [alias, name] of Object.entries(MAKER_ALIASES)) {
    const existing = await prisma.benchBulletMaker.findUnique({ where: { name } });
    const aliases = new Set([...(existing?.aliases ?? []), alias, name]);
    await prisma.benchBulletMaker.upsert({
      where: { name }, create: { name, aliases: [...aliases] }, update: { aliases: [...aliases] },
    });
  }

  /* 4 ─ Source rows */
  console.log('4/6  source rows');
  const knownKeys = new Set([...byEuropean.keys()].map((e) => cartridgeKey(e)));
  const perCartridge = new Map<string, number>();
  let written = 0;

  for (const r of loadRows) {
    const printedName = r.cartridge_european?.trim() || r.cartridge_as_printed?.trim() || '';
    const key = cartridgeKey(printedName);
    if (!key || !knownKeys.has(key)) {
      if (printedName && !report.cartridgesWithoutReference.includes(printedName)) {
        report.cartridgesWithoutReference.push(printedName);
      }
      continue;
    }
    const pKey = powderKey(r.powder_name ?? '');
    const powderId = powderIdByKey.get(pKey);
    if (!powderId) continue;

    const { maker, type } = splitMaker(r.bullet_manufacturer ?? '', r.bullet_type ?? '');
    const weightGr = num(r.bullet_weight_gr ?? '');
    const startGr = num(r.start_charge_gr ?? '');
    const maxGr = num(r.max_charge_gr ?? '');
    if (weightGr === null || startGr === null || maxGr === null) continue;

    await prisma.benchSourceLoad.create({
      data: {
        cartridgeKey: key, printedName,
        nameVerified: (r.cartridge_name_source ?? '').trim() === 'verified',
        bulletMaker: maker, bulletType: type, bulletCategory: bulletCategory(type),
        weightGr, powderId,
        startGr, startFps: int(r.start_velocity_fps ?? ''),
        maxGr, maxFps: int(r.max_velocity_fps ?? ''),
        coalMm: num(r.coal_mm ?? ''),
        source: r.source_manual ?? '', sourcePage: int(r.source_page ?? ''),
        needsReview: r.needs_review || null,
      },
    });
    written++;
    perCartridge.set(printedName, (perCartridge.get(printedName) ?? 0) + 1);
  }
  report.counts.sourceRowsWritten = written;

  /* 5 ─ Consolidation */
  console.log('5/6  consolidating');
  const sources = await prisma.benchSourceLoad.findMany();
  const groups = new Map<string, typeof sources>();
  for (const s of sources) {
    if (!s.bulletMaker) continue;
    const gk = [s.cartridgeKey, s.bulletMaker, s.weightGr, s.bulletCategory, s.powderId].join(' ');
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(s);
  }

  for (const [, rows] of groups) {
    // ⚠️ ONE IMPLEMENTATION, AND IT IS THE TESTED ONE. consolidate() lives in
    // ../consolidate.ts with its own spec; duplicating the rule here would
    // mean the tests pass while the import writes something else.
    const c = consolidate(rows.map((r) => ({
      startGr: r.startGr, startFps: r.startFps,
      maxGr: r.maxGr, maxFps: r.maxFps,
      coalMm: r.coalMm, bulletType: r.bulletType,
    })));

    const first = rows[0];
    const load = await prisma.benchLoad.upsert({
      where: {
        cartridgeKey_bulletMaker_weightGr_bulletCategory_powderId: {
          cartridgeKey: first.cartridgeKey, bulletMaker: first.bulletMaker!,
          weightGr: first.weightGr, bulletCategory: first.bulletCategory, powderId: first.powderId,
        },
      },
      create: {
        cartridgeKey: first.cartridgeKey, bulletMaker: first.bulletMaker!,
        bulletType: c.bulletType,
        bulletCategory: first.bulletCategory, weightGr: first.weightGr, powderId: first.powderId,
        startGr: c.startGr, startFps: c.startFps,
        maxGr: c.maxGr, maxFps: c.maxFps,
        coalMm: c.coalMm,
        coalLoMm: c.coalLoMm,
        coalHiMm: c.coalHiMm,
        sourcesCount: c.sourcesCount,
      },
      // bulletType is updated too, so a re-import after a manual is added
      // converges on the same row rather than keeping the first name seen.
      update: {
        bulletType: c.bulletType,
        startGr: c.startGr, startFps: c.startFps,
        maxGr: c.maxGr, maxFps: c.maxFps,
        coalMm: c.coalMm,
        coalLoMm: c.coalLoMm,
        coalHiMm: c.coalHiMm,
        sourcesCount: c.sourcesCount,
      },
    });
    await prisma.benchSourceLoad.updateMany({
      where: { id: { in: rows.map((r) => r.id) } }, data: { loadId: load.id },
    });

    if (c.sourcesCount === 1) report.singleSourceGroups++;
    if (needsReview(c)) {
      report.wideSpreadGroups.push({
        cartridge: first.cartridgeKey, powder: first.powderId,
        weightGr: first.weightGr, startGr: c.startGr, maxGr: c.maxGr,
      });
    }
  }
  report.counts.consolidatedLoads = groups.size;

  /* 6 ─ Report */
  console.log('6/6  report\n');
  const SANITY: [string, number][] = [
    ['6,5 Creedmoor', 868], ['308 Win.', 1901], ['223 Rem.', 1717],
  ];
  for (const [name, expected] of SANITY) {
    const got = perCartridge.get(name) ?? 0;
    console.log(`  ${got === expected ? 'ok  ' : 'DIFF'} ${name}: ${got} source rows (spec says ${expected})`);
  }
  const somchem = loadRows.filter((r) => (r.source_manual ?? '').startsWith('Somchem')).length;
  console.log(`  ${somchem === 612 ? 'ok  ' : 'DIFF'} Somchem rows: ${somchem} (spec says 612)\n`);

  console.log(`  cartridges           ${report.counts.cartridges}`);
  console.log(`  powders              ${report.counts.powders}`);
  console.log(`  source rows read     ${report.counts.sourceRowsRead}`);
  console.log(`  source rows written  ${report.counts.sourceRowsWritten}`);
  console.log(`  consolidated loads   ${report.counts.consolidatedLoads}`);
  console.log(`  single-source groups ${report.singleSourceGroups}`);
  console.log(`  wide-spread groups   ${report.wideSpreadGroups.length}  (review by hand)`);
  console.log(`  unmatched cartridges ${report.cartridgesWithoutReference.length}`);

  await fs.writeFile(
    path.join(dir, 'bench-import-report.json'), JSON.stringify(report, null, 2),
  );
  console.log(`\n  wrote ${path.join(dir, 'bench-import-report.json')}`);

  // An import that read rows and wrote none has FAILED, whatever its exit
  // code says. The first run of this script printed a tidy report of zeros
  // and exited 0, so the deploy was green and the Bench answered 'Nothing
  // matches that name' for every search. Never again silently.
  if (report.counts.sourceRowsRead > 0 && report.counts.sourceRowsWritten === 0) {
    console.error(
      `
  IMPORT WROTE NOTHING — read ${report.counts.sourceRowsRead} rows and ` +
        `wrote 0. The cartridge or powder lookups are matching nothing.
`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => void prisma?.$disconnect());
