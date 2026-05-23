// Standalone preview of the postal-entry PDF generator.
// Kept in sync by hand with src/raffles/postal-entry-pdf.ts.
//
// Usage (from backend/):
//   node scripts/preview-postal-pdf.mjs

import PDFDocument from 'pdfkit';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const POSTAL_ADDRESS_LINES = [
  'Gun Galore',
  'PO Box 4568',
  'Durbanville',
  'Cape Town',
  '7550',
];

const BRAND_RED = '#C8102E';
const INK_PRIMARY = '#111111';
const INK_SECONDARY = '#444444';
const INK_MUTED = '#777777';
const RULE_GREY = '#cccccc';

async function buildPostalEntryPdf(args) {
  return new Promise((resolveP, rejectP) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, left: 40, right: 40, bottom: 15 },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolveP(Buffer.concat(chunks)));
    doc.on('error', rejectP);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const M = 40;
    const CONTENT_W = pageWidth - M * 2;

    doc.fillColor(INK_PRIMARY).fontSize(20).font('Helvetica-Bold')
      .text('GUN GALORE', M, M, { width: CONTENT_W, align: 'center' });
    doc.fillColor(INK_SECONDARY).fontSize(10).font('Helvetica')
      .text('Free Postal Entry Form', M, doc.y + 1, {
        width: CONTENT_W, align: 'center', characterSpacing: 2,
      });

    const ruleY = doc.y + 8;
    doc.moveTo(M, ruleY).lineTo(M + CONTENT_W, ruleY)
      .lineWidth(2).strokeColor(BRAND_RED).stroke();
    doc.y = ruleY + 14;

    const refBoxY = doc.y;
    const refBoxH = 54;
    doc.rect(M, refBoxY, CONTENT_W, refBoxH)
      .lineWidth(0.8).strokeColor(INK_PRIMARY).stroke();
    doc.fillColor(INK_MUTED).fontSize(8).font('Helvetica')
      .text('RAFFLE REFERENCE', M + 12, refBoxY + 8, { characterSpacing: 1.5 });
    doc.fillColor(INK_PRIMARY).fontSize(18).font('Helvetica-Bold')
      .text(args.raffleReference, M + 12, refBoxY + 19, { width: CONTENT_W - 24 });
    doc.fillColor(INK_SECONDARY).fontSize(9).font('Helvetica')
      .text(args.raffleTitle, M + 12, refBoxY + 39, {
        width: CONTENT_W - 24, ellipsis: true, height: 12,
      });
    doc.y = refBoxY + refBoxH + 14;

    const colTop = doc.y;
    const colH = 110;
    const colGap = 14;
    const colW = (CONTENT_W - colGap) / 2;

    doc.fillColor(INK_PRIMARY).fontSize(10).font('Helvetica-Bold')
      .text('HOW TO ENTER', M, colTop, { characterSpacing: 1 });
    doc.fillColor(INK_SECONDARY).fontSize(8.5).font('Helvetica')
      .text(
        '1.  Fill in ALL fields below — entries with missing details cannot be processed.\n' +
          '2.  Do NOT alter the raffle reference printed above.\n' +
          '3.  Post the completed form to the address on the right.\n' +
          '4.  Each posted form earns ONE ticket. You may post multiple forms.\n' +
          '5.  Entries must arrive before tickets sell out.',
        M, colTop + 14, { width: colW, lineGap: 2 },
      );

    const rightX = M + colW + colGap;
    doc.rect(rightX, colTop, colW, colH)
      .lineWidth(0.8).strokeColor(INK_PRIMARY).stroke();
    doc.fillColor(INK_MUTED).fontSize(8).font('Helvetica')
      .text('POST TO', rightX + 12, colTop + 10, { characterSpacing: 1.5 });
    doc.fillColor(INK_PRIMARY).fontSize(11).font('Helvetica-Bold')
      .text(POSTAL_ADDRESS_LINES.join('\n'), rightX + 12, colTop + 24, {
        width: colW - 24, lineGap: 3,
      });
    doc.y = colTop + colH + 16;

    doc.fillColor(INK_PRIMARY).fontSize(10).font('Helvetica-Bold')
      .text('YOUR DETAILS', M, doc.y, { characterSpacing: 1 });
    doc.fillColor(INK_MUTED).fontSize(8).font('Helvetica')
      .text('Please print clearly in BLOCK letters', M, doc.y + 1);
    doc.y += 10;

    const FIELD_ROW_H = 32;
    const drawField = (label, width, x, y) => {
      doc.fillColor(INK_MUTED).fontSize(8).font('Helvetica')
        .text(label.toUpperCase(), x, y, { characterSpacing: 1 });
      const lineY = y + 22;
      doc.moveTo(x, lineY).lineTo(x + width, lineY)
        .lineWidth(0.7).strokeColor(INK_PRIMARY).stroke();
    };

    const halfW = (CONTENT_W - colGap) / 2;
    let y = doc.y;

    drawField('First name', halfW, M, y);
    drawField('Surname', halfW, M + halfW + colGap, y);
    y += FIELD_ROW_H;

    drawField('SA ID or Passport number', CONTENT_W, M, y);
    y += FIELD_ROW_H;

    drawField('Phone number (with country code)', halfW, M, y);
    drawField('Email address', halfW, M + halfW + colGap, y);
    y += FIELD_ROW_H;

    drawField('Postal or residential address', CONTENT_W, M, y);
    y += FIELD_ROW_H;

    doc.moveTo(M, y + 12).lineTo(M + CONTENT_W, y + 12)
      .lineWidth(0.7).strokeColor(INK_PRIMARY).stroke();
    y += 22;
    doc.y = y;

    doc.fillColor(INK_PRIMARY).fontSize(10).font('Helvetica-Bold')
      .text('DECLARATION', M, doc.y, { characterSpacing: 1 });
    doc.fillColor(INK_SECONDARY).fontSize(8.5).font('Helvetica')
      .text(
        'I confirm I am 18 years or older, the details above are mine, and I am entering ' +
          'the raffle of my own free will. I understand that this postal entry is free and ' +
          'carries the same odds of winning as a paid ticket. I agree to the Gun Galore ' +
          'terms & conditions published at gungalore.co.za/terms.',
        M, doc.y + 3, { width: CONTENT_W, lineGap: 2, align: 'justify' },
      );
    doc.y += 12;

    const sigY = doc.y;
    const sigW = (CONTENT_W - colGap * 2) * 0.62;
    const dateW = (CONTENT_W - colGap * 2) - sigW;

    doc.moveTo(M, sigY + 18).lineTo(M + sigW, sigY + 18)
      .lineWidth(0.8).strokeColor(INK_PRIMARY).stroke();
    doc.moveTo(M + sigW + colGap * 2, sigY + 18).lineTo(M + CONTENT_W, sigY + 18)
      .lineWidth(0.8).strokeColor(INK_PRIMARY).stroke();
    doc.fillColor(INK_MUTED).fontSize(8).font('Helvetica')
      .text('SIGNATURE', M, sigY + 22, { characterSpacing: 1 });
    doc.text('DATE (DD / MM / YYYY)', M + sigW + colGap * 2, sigY + 22, {
      width: dateW, characterSpacing: 1,
    });

    const footerRuleY = pageHeight - 40;
    doc.moveTo(M, footerRuleY).lineTo(M + CONTENT_W, footerRuleY)
      .lineWidth(0.4).strokeColor(RULE_GREY).stroke();
    doc.fillColor(INK_MUTED).fontSize(7.5).font('Helvetica')
      .text(
        `Ticket value: R${(args.ticketPriceCents / 100).toFixed(2)}   ·   ` +
          `Printed: ${new Date().toISOString().slice(0, 10)}   ·   ` +
          `Ref: ${args.raffleReference}`,
        M, footerRuleY + 6, { width: CONTENT_W, align: 'center' },
      );

    doc.end();
  });
}

const pdf = await buildPostalEntryPdf({
  raffleReference: 'RA000001',
  raffleTitle: 'Garmin Xero C2 Chronograph — brand new in box',
  ticketPriceCents: 8000,
});

const out = resolve(process.cwd(), '..', 'postal-entry-preview.pdf');
writeFileSync(out, pdf);
console.log(`✓ Wrote ${out}`);
