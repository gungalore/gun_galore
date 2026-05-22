// Print-ready postal-entry PDF for the CPA Section 36 free-entry route.
//
// Layout goals:
//   * Single A4 page so it fits in a standard envelope folded in thirds.
//   * Big, obvious posting address — Gun Galore's PO Box, pre-filled
//     so the entrant just has to drop the envelope.
//   * Hand-fill fields with thick black underlines so people can write
//     legibly with a pen.
//   * Pre-stamped raffle reference (RAxxxxxx) so the operator can match
//     incoming envelopes back to the right raffle without ambiguity.
//   * Clear "free entry" framing at the top so the postal route reads
//     as the no-purchase alternative it is.
//
// Generated with pdfkit (synchronous Buffer output). PDFKit pulls in a
// few Helvetica variants by default; we keep to those so no font files
// have to ship with the repo.

import PDFDocument from 'pdfkit';

interface BuildArgs {
  raffleReference: string;       // RAxxxxxx
  raffleTitle: string;           // human title shown at top of form
  ticketPriceCents: number;      // shown for context — does NOT apply to postal entry
}

// Where the operator wants the envelopes sent. Hardcoded per spec.
const POSTAL_ADDRESS_LINES = [
  'Gun Galore',
  'PO Box 4568',
  'Durbanville',
  'Cape Town',
  '7550',
];

export async function buildPostalEntryPdf(args: BuildArgs): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;

    // --- Header band -------------------------------------------------------
    doc
      .fillColor('#111111')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('Gun Galore — Free Postal Entry', { align: 'center' });

    doc.moveDown(0.2);
    doc
      .fillColor('#666666')
      .fontSize(10)
      .font('Helvetica')
      .text(
        'CPA Section 36 alternative entry route. No purchase necessary.',
        { align: 'center' },
      );

    doc.moveDown(0.6);

    // Reference block (boxed, large, hard to miss).
    const refBoxY = doc.y;
    doc
      .rect(36, refBoxY, pageWidth - 72, 56)
      .lineWidth(1)
      .strokeColor('#111111')
      .stroke();
    doc
      .fillColor('#666666')
      .fontSize(9)
      .font('Helvetica')
      .text('RAFFLE REFERENCE', 48, refBoxY + 8);
    doc
      .fillColor('#111111')
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(args.raffleReference, 48, refBoxY + 22, {
        width: pageWidth - 96,
      });
    doc
      .fillColor('#444444')
      .fontSize(10)
      .font('Helvetica')
      .text(args.raffleTitle, 48, refBoxY + 22 + 22, {
        width: pageWidth - 96,
        ellipsis: true,
        height: 14,
      });

    doc.y = refBoxY + 56 + 16;

    // --- Instructions ------------------------------------------------------
    doc
      .fillColor('#111111')
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('How to enter');
    doc.moveDown(0.2);
    doc
      .fillColor('#222222')
      .fontSize(10)
      .font('Helvetica')
      .text(
        '1.  Fill in ALL fields below — entries with missing details cannot be processed.\n' +
          '2.  Do NOT alter the raffle reference printed above.\n' +
          '3.  Post the completed form to the address on the right.\n' +
          '4.  Each posted form earns ONE ticket. You may post multiple forms.\n' +
          '5.  Entries must arrive before tickets sell out — track sell-through on the site.',
        { width: pageWidth / 2 - 48, lineGap: 2 },
      );

    // Posting address — boxed to the right of the instructions
    const addressX = pageWidth / 2 + 12;
    const addressBoxY = doc.y - 80;
    doc
      .rect(addressX, addressBoxY, pageWidth - addressX - 36, 88)
      .lineWidth(1)
      .strokeColor('#111111')
      .stroke();
    doc
      .fillColor('#666666')
      .fontSize(9)
      .font('Helvetica')
      .text('POST TO', addressX + 12, addressBoxY + 8);
    doc
      .fillColor('#111111')
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(POSTAL_ADDRESS_LINES.join('\n'), addressX + 12, addressBoxY + 22, {
        lineGap: 2,
      });

    doc.y = addressBoxY + 88 + 20;

    // --- Hand-fill fields --------------------------------------------------
    doc
      .fillColor('#111111')
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('Your details (please print clearly)');

    doc.moveDown(0.4);

    const drawField = (label: string, lineCount = 1) => {
      const startY = doc.y;
      doc
        .fillColor('#444444')
        .fontSize(9)
        .font('Helvetica')
        .text(label, { underline: false });
      doc.moveDown(0.2);

      for (let i = 0; i < lineCount; i += 1) {
        const lineY = doc.y + 14;
        doc
          .moveTo(36, lineY)
          .lineTo(pageWidth - 36, lineY)
          .lineWidth(0.8)
          .strokeColor('#111111')
          .stroke();
        doc.y = lineY + 8;
      }

      doc.moveDown(0.4);
      // returnY unused but kept to make layout intent clear
      void startY;
    };

    drawField('First name');
    drawField('Surname');
    drawField('SA ID / Passport number');
    drawField('Phone number (with country code)');
    drawField('Email address');
    drawField('Postal / residential address', 3);

    doc.moveDown(0.4);

    // --- Declaration -------------------------------------------------------
    doc
      .fillColor('#111111')
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('Declaration');
    doc.moveDown(0.2);
    doc
      .fillColor('#222222')
      .fontSize(9)
      .font('Helvetica')
      .text(
        'I confirm I am 18 years or older, the details above are mine, and I am entering ' +
          'the raffle of my own free will. I understand that this postal entry is free and ' +
          'carries the same odds of winning as a paid ticket. I agree to the Gun Galore ' +
          'terms & conditions published at gungalore.co.za/terms.',
        { width: pageWidth - 72, lineGap: 2 },
      );

    doc.moveDown(1.2);

    // Signature + date strip
    const sigY = doc.y;
    doc.fontSize(9).fillColor('#444444');
    doc.text('Signature', 36, sigY);
    doc
      .moveTo(36, sigY + 32)
      .lineTo(pageWidth / 2 - 24, sigY + 32)
      .lineWidth(0.8)
      .strokeColor('#111111')
      .stroke();

    doc.text('Date', pageWidth / 2 + 12, sigY);
    doc
      .moveTo(pageWidth / 2 + 12, sigY + 32)
      .lineTo(pageWidth - 36, sigY + 32)
      .lineWidth(0.8)
      .strokeColor('#111111')
      .stroke();

    // Footer — ticket-price context so the entrant knows the "value" of
    // the free entry they're using, plus a printed-on timestamp so the
    // operator can flag forms printed from really stale PDFs.
    const footerY = doc.page.height - 56;
    doc
      .fillColor('#888888')
      .fontSize(8)
      .font('Helvetica')
      .text(
        `Paid ticket equivalent value: R${(args.ticketPriceCents / 100).toFixed(2)} ` +
          `· Printed: ${new Date().toISOString().slice(0, 10)} · ` +
          `Reference: ${args.raffleReference}`,
        36,
        footerY,
        { width: pageWidth - 72, align: 'center' },
      );

    doc.end();
  });
}
