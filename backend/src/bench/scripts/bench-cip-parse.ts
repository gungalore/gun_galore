/**
 * THE BENCH — the C.I.P. dimension import. Standalone, NOT wired into app boot.
 *
 * Walks the per-cartridge sheets the motivations module already split out,
 * reads each one's CARTRIDGE MAXI / CHAMBER MINI tables, and fills
 * BenchCipDimension.
 *
 *   Usage:
 *     npx ts-node -r tsconfig-paths/register src/bench/scripts/bench-cip-parse.ts
 *     … --file <one.pdf>     parse a single sheet and print it, touching no database
 *     … --dry-run            parse everything, write nothing
 *
 * ⚠️ REUSES THE EXISTING SPLIT. The 562 sheets live outside the repository at
 * CIP_SHEETS_DIR (default /home/alloutdoor/data/cip) and are indexed by
 * src/motivations/cip-index.json. Re-splitting the combined pack here would
 * produce a second set of pages that could drift from the set the motivation
 * annexures are built from.
 *
 * ⚠️ VALUES ARE STORED AS PRINTED — millimetres and bar, no conversion. A
 * converted figure is a figure C.I.P. never published, and this table exists so
 * a reloader can check a round against the standard.
 *
 * The row/column reading — and why it cannot be done with `pdftotext -layout`
 * — is in ../cip-layout.ts.
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import CIP_INDEX from '../../motivations/cip-index.json';
import {
  parseSheet,
  CARTRIDGE_FIELDS,
  CHAMBER_FIELDS,
  TEXT_FIELDS,
  INT_FIELDS,
  type TextItem,
  type ParsedField,
} from '../cip-layout';

/**
 * ⚠️ require(), NOT import. pdfjs-dist ships ESM only; under this tsconfig an
 * `import` of it is emitted as a require anyway, and Node 22+ resolves that
 * natively. Spelling it out keeps the .mjs specifier out of tsc's module
 * resolution, which cannot follow it.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs') as {
  getDocument: (o: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<{
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: { str: string; transform: number[] }[] }>;
      }>;
    }>;
  };
};

let prisma: PrismaClient;

const SHEETS_DIR = process.env.CIP_SHEETS_DIR ?? '/home/alloutdoor/data/cip';

interface IndexEntry {
  name: string;
  pmaxBar: number | null;
  twistMm: number | null;
  file: string;
}
const INDEX = CIP_INDEX as unknown as Record<string, IndexEntry>;

/* ── Reading a page ─────────────────────────────────────────────────── */

async function itemsFor(file: string): Promise<TextItem[]> {
  const data = new Uint8Array(await fs.readFile(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  return content.items
    .filter((i) => i.str.trim())
    .map((i) => ({
      s: i.str.trim(),
      x: +i.transform[4].toFixed(1),
      y: +i.transform[5].toFixed(1),
    }));
}

/* ── Mapping to columns ─────────────────────────────────────────────── */

interface Mapped {
  data: Record<string, string | number | null>;
  tolerances: Record<string, string>;
  footnotes: Record<string, string>;
  unmapped: string[];
}

function mapFields(fields: ParsedField[], map: Record<string, string>): Mapped {
  const out: Mapped = { data: {}, tolerances: {}, footnotes: {}, unmapped: [] };
  for (const f of fields) {
    const column = map[f.label];
    if (!column) {
      // Not dropped silently: the whole page stays in rawText, and the report
      // names every label with no column so the omission is a visible choice.
      if (f.label) out.unmapped.push(f.label);
      continue;
    }
    if (f.value === '') continue;

    if (TEXT_FIELDS.has(column)) {
      out.data[column] = f.value;
    } else {
      const n = Number(f.value.replace(',', '.'));
      if (!Number.isFinite(n)) continue;
      out.data[column] = INT_FIELDS.has(column) ? Math.round(n) : n;
    }
    if (f.tolerance) out.tolerances[f.label] = f.tolerance;
    if (f.footnotes) out.footnotes[f.label] = f.footnotes;
  }
  return out;
}

/* ── Report ─────────────────────────────────────────────────────────── */

interface Report {
  sheetsInIndex: number;
  sheetsFound: number;
  sheetsMissingOnDisk: string[];
  sheetsImageOnly: string[];
  sheetsFailed: { key: string; reason: string }[];
  keysWithoutCartridge: string[];
  written: number;
  fieldCounts: Record<string, number>;
  /** Labels the sheets print that no column holds, most common first. */
  unmappedLabels: [string, number][];
  thinSheets: { key: string; fields: number }[];
  /** Cartridges whose blank L3 / L6 / Pmax were filled from their sheet. */
  cartridgesBackfilled: string[];
}

async function main(): Promise<void> {
  const argv = process.argv;
  const oneFile = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null;
  const dryRun = argv.includes('--dry-run');

  /* Single-sheet mode: parse, print, touch nothing. This is how a sheet that
     the report flags as failed or thin gets diagnosed. */
  if (oneFile) {
    let items: TextItem[];
    try {
      items = await itemsFor(oneFile);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      console.error(
        code === 'ENOENT'
          ? `No such sheet: ${oneFile}`
          : `Could not read ${oneFile}: ${String(err).slice(0, 140)}`,
      );
      process.exit(1);
    }
    const parsed = parseSheet(items);
    if (!parsed) {
      console.error(`No table found in ${oneFile} — image-only, or not a TDCC sheet.`);
      process.exit(1);
    }
    const cart = mapFields(parsed.cartridge, CARTRIDGE_FIELDS);
    const cham = mapFields(parsed.chamber, CHAMBER_FIELDS);
    console.log(`\n  TAB ${parsed.tab}   date ${parsed.sheetDate}   rev ${parsed.revision}\n`);
    console.log('  CARTRIDGE MAXI');
    for (const [k, v] of Object.entries(cart.data)) console.log(`    ${k.padEnd(9)} ${v}`);
    console.log('\n  CHAMBER MINI / BARREL');
    for (const [k, v] of Object.entries(cham.data)) console.log(`    ${k.padEnd(9)} ${v}`);
    const un = [...new Set([...cart.unmapped, ...cham.unmapped])];
    if (un.length) console.log(`\n  no column for: ${un.join(', ')}`);
    console.log(`\n  tolerances: ${JSON.stringify(cart.tolerances)}`);
    console.log(`  footnotes:  ${JSON.stringify(cart.footnotes)}\n`);
    return;
  }

  prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

  const keys = Object.keys(INDEX);
  const report: Report = {
    sheetsInIndex: keys.length,
    sheetsFound: 0,
    sheetsMissingOnDisk: [],
    sheetsImageOnly: [],
    sheetsFailed: [],
    keysWithoutCartridge: [],
    written: 0,
    fieldCounts: {},
    unmappedLabels: [],
    thinSheets: [],
    cartridgesBackfilled: [],
  };

  // Only keys that exist as BenchCartridge rows can be written: the dimension
  // table is keyed by a foreign key onto it.
  const known = new Set(
    (await prisma.benchCartridge.findMany({ select: { key: true } })).map((c) => c.key),
  );
  const unmappedTally = new Map<string, number>();

  for (const key of keys) {
    const entry = INDEX[key];
    if (!known.has(key)) {
      report.keysWithoutCartridge.push(`${key} (${entry.name})`);
      continue;
    }

    const file = path.join(SHEETS_DIR, path.basename(entry.file));
    let items: TextItem[];
    try {
      items = await itemsFor(file);
      report.sheetsFound++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') report.sheetsMissingOnDisk.push(entry.file);
      else report.sheetsFailed.push({ key, reason: String(err).slice(0, 120) });
      continue;
    }

    const parsed = parseSheet(items);
    const rawText = items.map((i) => i.s).join(' ');

    // Five sheets in the pack are scans with no text layer. They are recorded
    // as such rather than skipped, so the panel can say the sheet exists but
    // could not be read instead of implying C.I.P. publishes nothing.
    if (!parsed) {
      report.sheetsImageOnly.push(`${key} (${entry.name})`);
      if (!dryRun) {
        await prisma.benchCipDimension.upsert({
          where: { cartridgeKey: key },
          create: { cartridgeKey: key, imageOnly: true, rawText },
          update: { imageOnly: true, rawText },
        });
      }
      continue;
    }

    const cart = mapFields(parsed.cartridge, CARTRIDGE_FIELDS);
    const cham = mapFields(parsed.chamber, CHAMBER_FIELDS);
    for (const label of [...cart.unmapped, ...cham.unmapped]) {
      unmappedTally.set(label, (unmappedTally.get(label) ?? 0) + 1);
    }

    const data = {
      ...cart.data,
      ...cham.data,
      tab: parsed.tab,
      sheetDate: parsed.sheetDate,
      revision: parsed.revision,
      tolerances: cart.tolerances,
      footnotes: { ...cart.footnotes, ...cham.footnotes },
      imageOnly: false,
      rawText,
    };

    const fieldCount = Object.keys(cart.data).length + Object.keys(cham.data).length;
    for (const k of [...Object.keys(cart.data), ...Object.keys(cham.data)]) {
      report.fieldCounts[k] = (report.fieldCounts[k] ?? 0) + 1;
    }
    // A TDCC sheet carries 25-40 figures. Far fewer means the page parsed but
    // the reading is probably wrong, which is worth a human look before it is
    // shown as a standard.
    if (fieldCount < 12) report.thinSheets.push({ key, fields: fieldCount });

    if (!dryRun) {
      await prisma.benchCipDimension.upsert({
        where: { cartridgeKey: key },
        create: { cartridgeKey: key, ...data },
        update: data,
      });

      // A cartridge bench-import created FROM a sheet (the reference file
      // had no row for it) arrives with no lengths and, when the index had
      // none, no Pmax. The sheet is the only standard it has, so its L3, L6
      // and Pmax become the cartridge's own — and only where the row is
      // blank: a figure the reference file stated is never overwritten by
      // a parse, because a mis-read column would move a COAL ceiling.
      const row = await prisma.benchCartridge.findUnique({
        where: { key },
        select: { caseLengthMm: true, maxLengthMm: true, pmaxBar: true },
      });
      const cd = cart.data as Record<string, unknown>;
      const patch: Record<string, number> = {};
      if (row && row.caseLengthMm == null && typeof cd.L3 === 'number') patch.caseLengthMm = cd.L3;
      if (row && row.maxLengthMm == null && typeof cd.L6 === 'number') patch.maxLengthMm = cd.L6;
      if (row && row.pmaxBar == null && typeof cd.pmaxBar === 'number') {
        patch.pmaxBar = cd.pmaxBar;
        patch.pmaxPsi = Math.round(cd.pmaxBar * 14.5038);
      }
      if (Object.keys(patch).length) {
        await prisma.benchCartridge.update({ where: { key }, data: patch });
        report.cartridgesBackfilled.push(`${key}: ${Object.keys(patch).join(', ')}`);
      }
    }
    report.written++;
  }

  report.unmappedLabels = [...unmappedTally.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\n  sheets in index       ${report.sheetsInIndex}`);
  console.log(`  read off disk         ${report.sheetsFound}`);
  console.log(`  ${dryRun ? 'would write         ' : 'written             '}  ${report.written}`);
  console.log(`  image-only            ${report.sheetsImageOnly.length}`);
  console.log(`  missing on disk       ${report.sheetsMissingOnDisk.length}`);
  console.log(`  failed to parse       ${report.sheetsFailed.length}`);
  console.log(`  no BenchCartridge row ${report.keysWithoutCartridge.length}`);
  console.log(`  suspiciously thin     ${report.thinSheets.length}  (review by hand)`);
  console.log(`  lengths backfilled    ${report.cartridgesBackfilled.length}  (cartridges the reference file lacked)`);
  if (report.unmappedLabels.length) {
    console.log(
      `\n  labels with no column: ${report.unmappedLabels
        .slice(0, 12)
        .map(([l, n]) => `${l}×${n}`)
        .join('  ')}`,
    );
  }

  const out = path.join(process.cwd(), 'bench-cip-report.json');
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log(`\n  wrote ${out}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma?.$disconnect());
