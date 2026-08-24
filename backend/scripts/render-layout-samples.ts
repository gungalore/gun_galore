// ─────────────────────────────────────────────────────────────
// LOOK AT THE FIVE DOCUMENTS.
//
// Written 2026-08-24, after five layouts shipped that rendered a byte-identical
// cover. The tests said they differed, and they did — by heading style, which
// changed the length of the PDF. Nobody had put the pages side by side.
//
// ⚠️ THE POINT IS THE LOOKING. Every assertion in motivation-pdf-layouts.spec
// was written by somebody who had never seen the output; three of the five
// things a layout varies were wired to nothing, and the picker advertised all
// five to members. A rendering test can only check what it was told to check.
//
//   npx ts-node --transpile-only -P tsconfig.json //     scripts/render-layout-samples.ts <out-dir> [colourway]
//
// Then rasterise and look — poppler's pdftoppm, or PyMuPDF:
//   python -c "import fitz,sys; d=fitz.open(sys.argv[1]); //     [d[i].get_pixmap(dpi=110).save(f'p{i+1}.png') for i in range(2)]" out/banner.pdf
// ─────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MotivationPdfService } from '../src/motivations/motivation-pdf.service';
import { LAYOUT_KEYS } from '../src/motivations/motivation-pdf-layouts';

const OUT = process.argv[2] || path.join(process.cwd(), 'layout-samples');
const SCHEME = (process.argv[3] || 'eucalyptus') as never;

const body = [
  'Introduction:',
  'I am a dedicated hunter accredited with the South African Hunters and Game Conservation Association, membership 44120, and I apply in terms of section 16 of the Firearms Control Act 60 of 2000 for a licence to possess a Marlin 1895 lever-action rifle in .45-70 Government.',
  'Experience and training:',
  'I completed my competency in respect of a rifle in March 2018 at Bushveld Training Academy, accreditation SAPS/T/1188, and have hunted plains game every season since. My hunting record for the past four seasons is annexed, endorsed by the professional hunter who accompanied each hunt.',
  'Why this particular firearm:',
  'The .45-70 Government in a lever action is the standard tool for close-quarters follow-up in thick bushveld, where shots are taken inside forty metres and a fast second shot matters more than reach. My existing .308 is a bolt-action fitted with a six-power scope and is unsuited to that work; it is a plains rifle and I use it as one.',
  'Storage and safety:',
  'The firearm will be stored in a SABS 953-1 approved safe bolted through the brickwork of an interior wall at the address on this application. The safe is not visible from any window and the keys are held on my person. Photographs of the installation are annexed.',
  'Conclusion:',
  'I respectfully submit that this application meets the requirements of section 16, and I undertake to comply with every condition the Registrar may impose.',
].join('\n\n');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const svc = new MotivationPdfService();
  for (const layout of LAYOUT_KEYS) {
    const out = await svc.render({
      referenceNumber: 'MO000123',
      applicantName: 'Gerhard Fourie',
      licenceTypeLabel: 'Section 16 — Dedicated Hunter',
      body,
      disclaimer:
        'This document was prepared with assistance from All Outdoor. It is not legal advice and no outcome is promised. The applicant is responsible for the accuracy of every fact stated in it.',
      templateVersion: 'tpl-2026-08-24',
      layout,
      colourway: SCHEME,
      idNumber: '8001015009087',
      firearmLine: 'Marlin 1895 lever-action rifle, .45-70 Government, serial MR44120',
      ownedFirearms: [
        { make: 'Howa 1500', calibre: '6.5mm Creedmoor', type: 'Rifle', section: 'Section 16' },
        { make: 'Beretta 686', calibre: '12 Gauge', type: 'Shotgun', section: 'Section 16' },
      ],
      firearmSpec: [
        { label: 'Action', value: 'Lever action' },
        { label: 'Barrel length', value: '457 mm' },
        { label: 'Overall length', value: '940 mm' },
        { label: 'Magazine', value: '4 rounds, tubular' },
      ],
      annexures: [
        { letter: 'A', title: 'Copy of identity document', note: 'Certified' } as never,
        { letter: 'B', title: 'Competency certificate — rifle', note: 'Certified' } as never,
        { letter: 'C', title: 'Association letter of good standing', note: 'Dated within 90 days' } as never,
        { letter: 'D', title: 'Photographs of the safe installation', note: '' } as never,
      ],
      generatedAt: new Date('2026-08-24T08:00:00Z'),
    } as never);
    const f = path.join(OUT, `${layout}.pdf`);
    fs.writeFileSync(f, out.pdf);
    console.log(`${layout.padEnd(9)} ${(out.pdf.length / 1024).toFixed(0)} KB  ${f}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
