/**
 * Build the CartridgeSpec seed from our GRT-extracted caliber data
 * (prisma/seed-data/grt-caliber.csv — our own Frida extraction of Gordon's
 * Reloading Tool) matched against Load Lab's canonical cartridgeKeys.
 *
 * The match uses the SAME cartridgeKey() the load-data query uses, plus a
 * fuzzy + alias fallback for spelling drift between the Somchem-sourced
 * display names and GRT's CIP names. Field mapping was calibrated against
 * known reference cartridges (6.5 Creedmoor: L3=48.77mm case, L6=71.76mm
 * COAL, Pmax=4360bar) and is adversarially re-verified before deploy.
 *
 * Output: prisma/seed-data/cartridge-specs.json — one row per MATCHED
 * Load Lab cartridge, upserted into CartridgeSpec by the seed loader.
 *
 *   npx ts-node scripts/build-cartridge-specs.ts [cartridgeKeysFile]
 *
 * cartridgeKeysFile: optional "key|display" lines (default: query the DB).
 */
import * as fs from 'fs';
import * as path from 'path';
import { cartridgeKey } from '../src/load-lab/recommended-loads.service';
import { PrismaClient } from '@prisma/client';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Manual overrides from the adversarial verification pass (43-agent, 3-opinion
// recheck). The fuzzy matcher pointed these Load Lab cartridges at the WRONG
// GRT row (unanimous expert agreement) — most dangerously bare "308" → .308
// Marlin Express and "45-70" → a Belgian magnum. Each is re-pointed at the
// exact correct GRT cipname the reviewers named, or dropped where no safe
// target exists in GRT. Key = Load Lab cartridgeKey; value = exact GRT
// cipname to force, or '__DROP__' to exclude entirely.
const OVERRIDES: Record<string, string> = {
  '308': '.308 Win.', // was .308 Marlin Express
  '4570': '.45-70 Govt.', // was .45-70 Elko Mag.
  '22250': '.22-250 Rem.', // was .22-250 Rem. AI (blown-out wildcat)
  '7mauser': '7 x 57', // was 6.5 x 57 (wrong bullet dia)
  '8mauser': '8 x 57 IS', // was .338 Mauser
  '8remington': '8 mm Rem. Mag.', // was .338 Rem. Ultra Mag.
  '243winchestersupershortmagnum': '.243 WSSM', // was plain .243 Win.
  '257robertsimproved': '.257 Roberts AI', // was standard .257 Roberts
  '280remingtonai': '.280 Ackley Improved', // was standard .280 Rem.
  '30remingtonar': '__DROP__', // no GRT entry for the 2008 AR cartridge
  '6x45': '__DROP__', // 6mm/.243 wildcat; GRT only has the AI variant
  '7': '__DROP__', // 7mm TCU wildcat; no clean GRT target
  '30338': '__DROP__', // ambiguous wildcat vs Prechtl Mag — held for review
};

async function loadLabKeys(
  file?: string,
): Promise<{ key: string; display: string }[]> {
  if (file && fs.existsSync(file)) {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes('|'))
      .map((l) => {
        const [key, display] = l.split('|');
        return { key, display };
      });
  }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.manualLoad.groupBy({
      by: ['cartridgeKey', 'cartridge'],
    });
    // one display per key (first alphabetically for determinism)
    const byKey = new Map<string, string>();
    for (const r of rows.sort((a, b) => a.cartridge.localeCompare(b.cartridge))) {
      if (!byKey.has(r.cartridgeKey)) byKey.set(r.cartridgeKey, r.cartridge);
    }
    return [...byKey].map(([key, display]) => ({ key, display }));
  } finally {
    await prisma.$disconnect();
  }
}

interface GrtRow {
  cipname: string;
  standard: string;
  origin: string;
  ctype: string;
  year: string;
  caseLengthMm: number | null; // L3
  maxCartridgeLengthMm: number | null; // L6
  pmaxBar: number | null; // Pmax
  capacity: number | null; // V (units validated in verification pass)
  cipPdf: string | null;
  grtId: string;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const csv = fs
    .readFileSync(path.join(root, 'prisma/seed-data/grt-caliber.csv'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const H = csv[0].split(',');
  const col = (n: string) => H.indexOf(n);
  const iId = col('id'),
    iName = col('cipname'),
    iAlt = col('altname'),
    iStd = col('standard'),
    iOrig = col('ciporigin'),
    iType = col('ciptype'),
    iDate = col('cipdate'),
    iPdf = col('cippdf'),
    iL3 = col('L3'),
    iL6 = col('L6'),
    iPmax = col('Pmax'),
    iV = col('V');

  // GRT lookup keyed by cartridgeKey(cipname) + each altname. Keep the
  // FIRST occurrence so the canonical cipname wins over an alias.
  const grt = new Map<string, GrtRow>();
  const grtByName = new Map<string, GrtRow>(); // exact cipname → row (for overrides)
  const rowById: GrtRow[] = [];
  for (const line of csv.slice(1)) {
    const r = parseCsvLine(line);
    if (!r[iName]) continue;
    const rec: GrtRow = {
      cipname: r[iName],
      standard: r[iStd] || '',
      origin: r[iOrig] || '',
      ctype: r[iType] || '',
      year: (r[iDate] || '').slice(0, 4),
      caseLengthMm: num(r[iL3]),
      maxCartridgeLengthMm: num(r[iL6]),
      pmaxBar: num(r[iPmax]),
      capacity: num(r[iV]),
      cipPdf: r[iPdf] && r[iPdf].length > 3 ? r[iPdf] : null,
      grtId: r[iId],
    };
    rowById.push(rec);
    grtByName.set(rec.cipname, rec);
    const names = [r[iName], ...(r[iAlt] ? r[iAlt].split(',') : [])];
    for (const nm of names) {
      const k = cartridgeKey(nm.trim());
      if (k && k.length >= 3 && !grt.has(k)) grt.set(k, rec);
    }
  }

  const keys = await loadLabKeys(process.argv[2]);
  const specs: Record<string, unknown>[] = [];
  const unmatched: string[] = [];

  const badOverrides: string[] = [];
  for (const c of keys) {
    // Verification overrides win: force the correct GRT row, or drop.
    if (Object.prototype.hasOwnProperty.call(OVERRIDES, c.key)) {
      const target = OVERRIDES[c.key];
      if (target === '__DROP__') {
        unmatched.push(c.display);
        continue;
      }
      const forced = grtByName.get(target);
      if (!forced) {
        badOverrides.push(`${c.key} → "${target}" (not found in GRT)`);
        unmatched.push(c.display);
        continue;
      }
      const std2 = /saami/i.test(forced.standard)
        ? 'SAAMI'
        : /cip/i.test(forced.standard)
          ? 'CIP'
          : /wild/i.test(forced.standard)
            ? 'WILDCAT'
            : 'OTHER';
      specs.push({
        cartridgeKey: c.key,
        displayName: c.display,
        grtName: forced.cipname,
        standard: std2,
        origin: forced.origin || null,
        cartridgeType: forced.ctype || null,
        year: forced.year && /^\d{4}$/.test(forced.year) ? Number(forced.year) : null,
        caseLengthMm: forced.caseLengthMm,
        maxCartridgeLengthMm: forced.maxCartridgeLengthMm,
        maxPressureBar: forced.pmaxBar,
        maxPressurePsi: forced.pmaxBar ? Math.round(forced.pmaxBar * 14.5038) : null,
        caseCapacity: forced.capacity,
        officialPdfUrl: forced.cipPdf,
        matchMethod: 'override',
      });
      continue;
    }
    let hit = grt.get(c.key);
    let method = 'key';
    if (!hit) {
      // containment fuzzy (≥6 chars) on the canonical key
      for (const [k, v] of grt) {
        if (k.length >= 6 && (c.key.includes(k) || k.includes(c.key))) {
          hit = v;
          method = 'fuzzy';
          break;
        }
      }
    }
    if (!hit) {
      unmatched.push(c.display);
      continue;
    }
    // Only keep matches that carry at least Pmax OR a case length — a row
    // with no usable spec data is not worth showing.
    if (!hit.pmaxBar && !hit.caseLengthMm) {
      unmatched.push(c.display);
      continue;
    }
    const std = /saami/i.test(hit.standard)
      ? 'SAAMI'
      : /cip/i.test(hit.standard)
        ? 'CIP'
        : /wild/i.test(hit.standard)
          ? 'WILDCAT'
          : 'OTHER';
    specs.push({
      cartridgeKey: c.key,
      displayName: c.display,
      grtName: hit.cipname,
      standard: std,
      origin: hit.origin || null,
      cartridgeType: hit.ctype || null,
      year: hit.year && /^\d{4}$/.test(hit.year) ? Number(hit.year) : null,
      caseLengthMm: hit.caseLengthMm,
      maxCartridgeLengthMm: hit.maxCartridgeLengthMm,
      maxPressureBar: hit.pmaxBar,
      maxPressurePsi: hit.pmaxBar ? Math.round(hit.pmaxBar * 14.5038) : null,
      caseCapacity: hit.capacity, // units validated in the verification pass
      officialPdfUrl: hit.cipPdf,
      matchMethod: method,
    });
  }

  specs.sort((a, b) =>
    String(a.cartridgeKey).localeCompare(String(b.cartridgeKey)),
  );
  const out = path.join(root, 'prisma/seed-data/cartridge-specs.json');
  fs.writeFileSync(out, JSON.stringify(specs, null, 2));

  // Also emit idempotent SQL so prod can load without ts-node: upsert each
  // row + prune any key no longer present, reconciling the table to the seed.
  const sqlEsc = (v: unknown) =>
    v === null || v === undefined
      ? 'NULL'
      : typeof v === 'number'
        ? String(v)
        : `'${String(v).replace(/'/g, "''")}'`;
  const cols = [
    'cartridgeKey', 'displayName', 'grtName', 'standard', 'origin',
    'cartridgeType', 'year', 'caseLengthMm', 'maxCartridgeLengthMm',
    'maxPressureBar', 'maxPressurePsi', 'caseCapacityGrH2O', 'officialPdfUrl',
  ];
  const valOf = (s: Record<string, unknown>, c: string) =>
    c === 'caseCapacityGrH2O' ? s.caseCapacity : s[c];
  const rowsSql = specs
    .map(
      (s) =>
        `  (${cols.map((c) => sqlEsc(valOf(s, c))).join(', ')}, NOW())`,
    )
    .join(',\n');
  const keyList = specs.map((s) => sqlEsc(s.cartridgeKey)).join(', ');
  const sql = `-- Generated by build-cartridge-specs.ts — do not edit by hand.
-- Idempotent: upserts every verified spec + prunes stale keys.
INSERT INTO "CartridgeSpec" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES
${rowsSql}
ON CONFLICT ("cartridgeKey") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "grtName" = EXCLUDED."grtName",
  "standard" = EXCLUDED."standard",
  "origin" = EXCLUDED."origin",
  "cartridgeType" = EXCLUDED."cartridgeType",
  "year" = EXCLUDED."year",
  "caseLengthMm" = EXCLUDED."caseLengthMm",
  "maxCartridgeLengthMm" = EXCLUDED."maxCartridgeLengthMm",
  "maxPressureBar" = EXCLUDED."maxPressureBar",
  "maxPressurePsi" = EXCLUDED."maxPressurePsi",
  "caseCapacityGrH2O" = EXCLUDED."caseCapacityGrH2O",
  "officialPdfUrl" = EXCLUDED."officialPdfUrl",
  "updatedAt" = NOW();
DELETE FROM "CartridgeSpec" WHERE "cartridgeKey" NOT IN (${keyList});
`;
  fs.writeFileSync(
    path.join(root, 'prisma/seed-data/cartridge-specs.sql'),
    sql,
  );
  const byStd: Record<string, number> = {};
  for (const s of specs) byStd[String(s.standard)] = (byStd[String(s.standard)] || 0) + 1;
  console.log(`Load Lab cartridges: ${keys.length}`);
  console.log(`Matched specs written: ${specs.length}`, byStd);
  console.log(`With official datasheet: ${specs.filter((s) => s.officialPdfUrl).length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  if (badOverrides.length)
    console.log(`⚠ OVERRIDE TARGETS NOT FOUND:\n  ${badOverrides.join('\n  ')}`);
  console.log(`→ ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
