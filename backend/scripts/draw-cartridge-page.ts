/**
 * Render a pack page carrying the cartridge drawing, as PNG. Development only.
 *
 *   npx ts-node -T scripts/draw-cartridge-page.ts <out.png>
 */
import * as fs from 'fs';
import sharp from 'sharp';
import { MotivationPdfService } from '../src/motivations/motivation-pdf.service';
import {
  cartridgeDrawing,
  completeDims,
} from '../src/motivations/motivation-cartridge-drawing';

const LUGER = {
  R: 1.27, R1: 9.96, E: 2.98, E1: 8.79, P1: 9.93, P2: null,
  L1: null, L2: null, L3: 19.15, L6: 29.69, H1: null, H2: 9.65, G1: 9.03,
};

void (async () => {
  const c = completeDims(LUGER)!;
  const d = cartridgeDrawing(
    c.dims,
    { name: '9 mm Luger', pmaxBar: 2350 },
    { derived: c.derived },
  );
  const png = await sharp(Buffer.from(d.svg), { density: 300 })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();

  const svc = new MotivationPdfService();
  const out = await svc.render({
    referenceNumber: 'MO000123',
    applicantName: 'Gerhard Johan Petrus Fourie',
    licenceTypeLabel: 'Section 13 — Self-defence',
    format: 'comprehensive',
    body: [
      'The firearm and why it suits the purpose:',
      'The pistol I am applying for is chambered in 9 mm Luger. That chambering is what the ' +
        'argument in this section turns on, and the drawing above it is the round itself, drawn ' +
        'to scale from the dimensions on record rather than described from memory.',
      'The cartridge:',
      'A 9 mm Luger round is 29.69 mm long overall and seats a 9.03 mm bullet in a 19.15 mm ' +
        'case. The case is tapered, so it feeds and extracts reliably from a self-loading ' +
        'pistol, and the round is short enough that a magazine of practical size holds enough ' +
        'of them to answer an attack without a reload. The pressure the round is built to ' +
        'contain is what gives it its performance in a barrel of the length a handgun carries.',
      'Safe storage:',
      'The firearm will be stored in a SABS-approved safe bolted to a brick wall in a locked ' +
        'room at my residence. No other person has the combination.',
    ].join('\n\n'),
    firearmSpec: [
      { label: 'Make', value: 'Česká zbrojovka' },
      { label: 'Model', value: 'P-10 C' },
      { label: 'Calibre', value: '9 mm Luger' },
    ],
    cartridgeDrawing: {
      png,
      widthMm: d.widthMm,
      heightMm: d.heightMm,
      texts: d.texts,
      label: 'The cartridge — 9 mm Luger',
    },
    disclaimer: 'Prepared by All Outdoor.',
    templateVersion: 'tpl-2026-09-a',
    generatedAt: new Date('2026-09-09T08:00:00Z'),
  } as never);

  const target = process.argv[2] ?? 'cartridge-page';
  fs.writeFileSync(`${target}.pdf`, out.pdf);

  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(out.pdf, { scale: 2.2 });
  let n = 0;
  for await (const page of doc) {
    n += 1;
    fs.writeFileSync(`${target}-p${n}.png`, page);
  }
  console.log('pages', n, '->', `${target}-p*.png`);
})();
