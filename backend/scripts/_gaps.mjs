// Which widgets in the template does our map NOT cover, and what are they?
// Each uncovered widget is labelled with the nearest printed text to its left
// (or above), so the report reads like the form rather than like coordinates.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { getDocument } = await import('file:///C:/dev/gun-galore/backend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');

const ts = fs.readFileSync('src/motivations/saps271-coords.ts', 'utf8');
const COORDS = JSON.parse(ts.match(/export const SAPS271_COORDS = ([\s\S]*?) as const satisfies/)[1]);
const used = new Set();
for (const f of Object.values(COORDS)) {
  if (f.field) used.add(f.field);
  for (const n of f.fields ?? []) used.add(n);
}

const bytes = fs.readFileSync('assets/saps271-fillable.pdf');
const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
const form = pdf.getForm();
const byRef = new Map();
for (const f of form.getFields()) {
  const kind = f.constructor.name === 'PDFCheckBox' ? 'check'
    : f.constructor.name === 'PDFSignature' ? 'SIG' : 'text';
  for (const w of f.acroField.getWidgets()) byRef.set(w.dict, { name: f.getName(), kind, w });
}
const widgets = [];
pdf.getPages().forEach((pg, i) => {
  const annots = pg.node.Annots();
  if (!annots) return;
  for (let k = 0; k < annots.size(); k++) {
    const hit = byRef.get(annots.lookup(k));
    if (!hit) continue;
    const r = hit.w.getRectangle();
    widgets.push({ page: i + 1, name: hit.name, kind: hit.kind, x: r.x, y: r.y, w: r.width, h: r.height });
  }
});

const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
const textByPage = [];
for (let p = 1; p <= doc.numPages; p++) {
  const tc = await (await doc.getPage(p)).getTextContent();
  textByPage[p] = tc.items.filter(i => i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width }));
}
const labelFor = (wd) => {
  const items = textByPage[wd.page] ?? [];
  const cy = wd.y + wd.h / 2;
  const sameRow = items.filter(i => Math.abs(i.y + 4 - cy) < 12 && i.x < wd.x);
  if (sameRow.length) return sameRow.sort((a,b)=>b.x-a.x)[0].s;
  const above = items.filter(i => i.y > cy && i.y < cy + 26);
  return above.length ? above.sort((a,b)=>a.y-b.y)[0].s : '(no nearby label)';
};

// Group runs of adjacent character cells so 13 ID boxes read as one entry.
const missing = widgets.filter(w => !used.has(w.name)).sort((a,b)=> a.page-b.page || b.y-a.y || a.x-b.x);
const groups = [];
for (const m of missing) {
  const g = groups[groups.length - 1];
  if (g && g.page === m.page && Math.abs(g.y - m.y) < 4 && m.x - (g.x2) < 8) {
    g.x2 = m.x + m.w; g.n++; g.names.push(m.name);
  } else groups.push({ page: m.page, y: Math.round(m.y), x: Math.round(m.x), x2: m.x + m.w, n: 1, kind: m.kind, names: [m.name], label: labelFor(m) });
}
console.log(`template widgets: ${widgets.length}   covered by our map: ${widgets.length - missing.length}   NOT covered: ${missing.length}`);
console.log(`uncovered groups: ${groups.length}\n`);
for (const g of groups) {
  console.log(`p${String(g.page).padStart(2)} y${String(g.y).padStart(4)} x${String(g.x).padStart(3)} ${String(g.n).padStart(2)}x ${g.kind.padEnd(5)} ${g.label.slice(0, 78)}`);
}
