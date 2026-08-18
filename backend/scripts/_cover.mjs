// Enumerate EVERY widget in the template by walking each page's /Annots,
// which is authoritative — a widget's /P back-pointer is optional and 14 of
// them lack it, which is why an earlier pass reported them as "page 0".
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument, PDFName } = require('pdf-lib');

const pdf = await PDFDocument.load(fs.readFileSync(process.argv[2]), { ignoreEncryption: true });
const form = pdf.getForm();
const byRef = new Map();
for (const f of form.getFields()) {
  const kind = f.constructor.name === 'PDFCheckBox' ? 'check'
    : f.constructor.name === 'PDFSignature' ? 'SIG' : 'text';
  for (const w of f.acroField.getWidgets()) byRef.set(w.dict, { name: f.getName(), kind, w });
}
const rows = [];
pdf.getPages().forEach((pg, i) => {
  const annots = pg.node.Annots();
  if (!annots) return;
  for (let k = 0; k < annots.size(); k++) {
    const d = annots.lookup(k);
    const hit = byRef.get(d);
    if (!hit) continue;
    const r = hit.w.getRectangle();
    rows.push({ page: i + 1, name: hit.name, kind: hit.kind,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
});
rows.sort((a,b)=> a.page-b.page || b.y-a.y || a.x-b.x);
const lo = Number(process.argv[3] ?? 1), hi = Number(process.argv[4] ?? 12);
for (const r of rows) if (r.page>=lo && r.page<=hi)
  console.log(`p${String(r.page).padStart(2)} y${String(r.y).padStart(4)}-${String(r.y+r.h).padStart(4)} x${String(r.x).padStart(3)} w${String(r.w).padStart(3)} ${r.kind.padEnd(5)} ${r.name}`);
console.log(`\nTOTAL widgets on pages: ${rows.length}`);
const perPage = {};
for (const r of rows) perPage[r.page] = (perPage[r.page] ?? 0) + 1;
console.log('per page:', JSON.stringify(perPage));
