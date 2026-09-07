/**
 * CUT THE REAL SAPS WORKBOOK DOWN TO A TEST FIXTURE.
 *
 * The published file is 10.8 MB and its "RAW Data" sheet is A1:AJ55765 — far
 * too big to commit, and far too slow to open in a unit test. This keeps three
 * stations with all 44 of their categories, two rows of each aggregate level,
 * and three rows of the rubbish that sits below the table. About 30 KB.
 *
 * ⚠️ A REAL CUT, NOT A SYNTHETIC SHEET. Every quirk the parser has to survive
 * — the two banner rows, the hard line breaks inside header text, the Excel
 * serial dates in the month headers, the "Comp level" aggregates, the trailing
 * junk — is in the file because SAPS put it there. A hand-written fixture only
 * ever contains the quirks we already knew about.
 *
 * ⚠️ IT WRITES INTO src/, NOT test output. Re-run it only when SAPS changes
 * the sheet's shape, and check the diff: the committed fixture is what
 * parse-raw-data.spec.ts asserts exact counts against.
 *
 * Run:  npm run crime-stats:fixture -- <path to a real SAPS workbook>
 */
const path = require('path');
const ExcelJS = require('exceljs');

const SRC = process.argv[2];
const OUT = path.join(
  __dirname,
  '..',
  'src',
  'crime-stats',
  '__fixtures__',
  'saps-raw-data-sample.xlsx',
);

/** Three stations, three provinces, one of them two words. */
const KEEP = new Set(['Brooklyn', 'Acornhoek', 'Table View']);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

async function main() {
  if (!SRC) {
    console.error(
      'Usage: npm run crime-stats:fixture -- <path to 2025-2026_-_4th_Quarter_WEB.xlsx>',
    );
    process.exit(1);
  }
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    sharedStrings: 'cache',
    worksheets: 'emit',
    entries: 'emit',
    styles: 'ignore',
  });

  const kept = [];
  const aggregates = { District: 0, Province: 0, National: 0 };
  let headerAt = -1;
  let ix = {};
  let junk = 0;

  for await (const ws of reader) {
    if ((ws.name ?? '').trim() !== 'RAW Data') continue;
    for await (const row of ws) {
      const v = (row.values || []).slice(1);
      if (headerAt < 0) {
        // Everything above and including the header row is kept verbatim —
        // the banners are half the reason findHeader() has to search.
        kept.push(v);
        const cells = v.map(norm);
        if (cells.includes('comp level') && cells.includes('station')) {
          headerAt = kept.length - 1;
          cells.forEach((c, i) => {
            if (c && !(c in ix)) ix[c] = i;
          });
        }
        continue;
      }
      const level = String(v[ix['comp level']] ?? '');
      if (level === 'Station') {
        if (KEEP.has(String(v[ix['station']]))) kept.push(v);
      } else if (aggregates[level] !== undefined && aggregates[level] < 2) {
        aggregates[level]++;
        kept.push(v);
      } else if (
        aggregates[level] === undefined &&
        junk < 3 &&
        v.some((x) => x !== null && x !== undefined && x !== '')
      ) {
        junk++;
        kept.push(v);
      }
    }
  }

  if (headerAt < 0) throw new Error('no header row found in "RAW Data"');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RAW Data');
  for (const r of kept) ws.addRow(r.map((x) => (x === undefined ? null : x)));
  // A second sheet, so readRawDataSheet() is proven to pick the right one.
  wb.addWorksheet('TOP30 stations').addRow(['not this one']);
  await wb.xlsx.writeFile(OUT);

  console.log(
    `wrote ${OUT}: ${kept.length} rows, header at index ${headerAt}, ` +
      `aggregates ${JSON.stringify(aggregates)}, junk ${junk}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
