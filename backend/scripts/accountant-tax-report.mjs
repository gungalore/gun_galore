// Generates the accountant-facing PDF from docs/tax/accountant-report.md.
// Run from backend/: npx tsx is not needed for this .mjs file:
//   node scripts/accountant-tax-report.mjs [output.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const sourcePath = path.join(repo, 'docs', 'tax', 'accountant-report.md');
const outputPath =
  process.argv[2] ??
  path.join(repo, 'docs', 'tax', 'ALL-Outdoor-Tax-and-Accounting-Report.pdf');

const markdown = fs.readFileSync(sourcePath, 'utf8');
const lines = markdown.split(/\r?\n/);

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 54, bottom: 54, left: 54, right: 54 },
  bufferPages: true,
  info: {
    Title: 'ALL Outdoor — Tax and Accounting Wiring Report',
    Author: 'ALL Outdoor',
    Subject: 'Accounting and tax treatment for external accountant review',
  },
});
doc.pipe(fs.createWriteStream(outputPath));

const M = 54;
const W = doc.page.width - M * 2;
const footerY = doc.page.height - 72;
let firstHeading = true;

function clean(text) {
  return String(text)
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, '-')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureSpace(height) {
  if (doc.y + height > doc.page.height - 64) {
    doc.addPage();
    doc.x = M;
  }
}

function heading(level, text) {
  const size = level === 1 ? 20 : level === 2 ? 15 : 12;
  ensureSpace(size + 18);
  doc.x = M;
  if (!firstHeading) doc.moveDown(0.55);
  firstHeading = false;
  doc
    .font('Helvetica-Bold')
    .fontSize(size)
    .fillColor('#141414')
    .text(clean(text), M, doc.y, { width: W });
  doc.moveDown(level === 1 ? 0.65 : 0.35);
}

function paragraph(text) {
  const body = clean(text);
  if (!body) return;
  ensureSpace(18);
  doc.x = M;
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor('#222222')
    .text(body, M, doc.y, { width: W, lineGap: 2 });
  doc.moveDown(0.35);
}

function bullet(text) {
  ensureSpace(16);
  doc.x = M;
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor('#222222')
    .text(`-  ${clean(text)}`, M, doc.y, { width: W, indent: 10, lineGap: 2 });
  doc.moveDown(0.18);
}

function table(rows) {
  if (!rows.length) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const firstWidth = cols >= 3 ? W * 0.32 : W * 0.42;
  const restWidth = cols > 1 ? (W - firstWidth) / (cols - 1) : W;
  const widths = Array.from({ length: cols }, (_, i) =>
    i === 0 ? firstWidth : restWidth,
  );
  const pad = 4;

  for (const row of rows) {
    const heights = row.map((cell, i) => {
      doc.font('Helvetica').fontSize(8);
      return doc.heightOfString(clean(cell), {
        width: widths[i] - pad * 2,
        lineGap: 1,
      }) + pad * 2;
    });
    const rowHeight = Math.max(16, ...heights);
    ensureSpace(rowHeight + 4);
    const y = doc.y;
    let x = M;
    doc.rect(M, y, W, rowHeight).fill('#f4f2ee');
    for (let i = 0; i < cols; i++) {
      const cell = clean(row[i] ?? '');
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#222222')
        .text(cell, x + pad, y + pad, {
          width: widths[i] - pad * 2,
          lineGap: 1,
        });
      x += widths[i];
    }
    doc.y = y + rowHeight;
    doc.x = M;
    doc
      .moveTo(M, doc.y)
      .lineTo(M + W, doc.y)
      .lineWidth(0.4)
      .strokeColor('#d8d2c8')
      .stroke();
    doc.moveDown(0.15);
  }
  doc.x = M;
  doc.moveDown(0.45);
}

let paragraphBuffer = [];
let tableBuffer = [];
let inTable = false;

function flushParagraph() {
  if (paragraphBuffer.length) {
    paragraph(paragraphBuffer.join(' '));
    paragraphBuffer = [];
  }
}
function flushTable() {
  if (tableBuffer.length) {
    table(tableBuffer);
    tableBuffer = [];
  }
  inTable = false;
}

for (const raw of lines) {
  const line = raw.trimEnd();
  const isTable = line.trim().startsWith('|') && line.trim().endsWith('|');
  if (isTable) {
    flushParagraph();
    if (/^\|[\s:|-]+\|$/.test(line.trim())) {
      inTable = true;
      continue;
    }
    tableBuffer.push(
      line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
    continue;
  }
  if (inTable) flushTable();

  if (!line.trim()) {
    flushParagraph();
    continue;
  }
  if (line.startsWith('# ')) {
    flushParagraph();
    heading(1, line.slice(2));
    continue;
  }
  if (line.startsWith('## ')) {
    flushParagraph();
    heading(2, line.slice(3));
    continue;
  }
  if (line.startsWith('### ')) {
    flushParagraph();
    heading(3, line.slice(4));
    continue;
  }
  if (/^\s*[-*]\s+/.test(line)) {
    flushParagraph();
    bullet(line.replace(/^\s*[-*]\s+/, ''));
    continue;
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    flushParagraph();
    bullet(line.replace(/^\s*/, ''));
    continue;
  }
  paragraphBuffer.push(line);
}
flushParagraph();
flushTable();

// Page numbers. Buffer pages so the total is known.
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc.x = M;
  doc.y = footerY;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#777777')
    .text(
      `ALL Outdoor - Tax & Accounting Report  -  ${i + 1} of ${range.count}`,
      M,
      footerY,
      { width: W, align: 'center', lineBreak: false },
    );
}

doc.end();
console.log(`wrote ${outputPath}`);
