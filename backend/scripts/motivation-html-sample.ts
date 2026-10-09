import 'reflect-metadata';
import * as fs from 'node:fs';
import { renderMotivationHtml } from '../src/motivations/motivation-html.service';
import { ChromiumPdfService } from '../src/motivations/chromium-pdf.service';
import { MotivationPdfInput } from '../src/motivations/motivation-pdf.service';

// Dev utility: render a sample motivation through the HTML/Chromium path and
// write the PDF. Not part of the served pipeline. Usage:
//   npx ts-node scripts/motivation-html-sample.ts <out.pdf>

// A hand-built sample, loosely typed for a dev smoke run.
const input = {
  referenceNumber: 'MO999999',
  applicantName: 'Gerhard Johan Petrus Fourie',
  idNumber: '890512 5220 089',
  licenceTypeLabel: 'Section 13 — Self-defence',
  firearmLine: 'Glock handgun, 9mm Parabellum, serial ZABA01892',
  body: [
    '1. Application',
    '',
    'I, Gerhard Johan Petrus Fourie, identity number 890512 5220 089, apply under section 13 of the Firearms Control Act 60 of 2000 for a licence to possess a Glock handgun in 9mm Parabellum, serial number ZABA01892, for self-defence.',
    '',
    'I live at 36 Sterappel Crescent, Langeberg Glen, Kraaifontein, and work as an electrician.',
    '',
    '2. Why I need a firearm',
    '',
    'I live in the Kraaifontein policing precinct. SAPS published figures for the station for April to June 2026 record 95 burglaries at residential premises and 241 robberies with aggravating circumstances.',
    '',
    'My work takes me through Dunoon and Elsiesrivier at hours when the street is empty.',
    '',
    '3. What I have already done',
    '',
    'My property is enclosed by a wall with an electric fence, a guarded entrance, an alarm with armed response, burglar bars and security gates. These protect the house while I am inside it. A firearm is the one measure that goes with me.',
    '',
    '4. The firearm and how I would keep it',
    '',
    'A handgun is the only firearm that can be carried on the person and kept out of sight. At home it is stored in a rifle safe bolted to the floor, to which only I hold the key.',
    '',
    '5. Conclusion',
    '',
    'I respectfully request that a licence be issued to me under section 13.',
  ].join('\n'),
  disclaimer:
    'Prepared with assistance. The applicant signs this document as their own.',
  templateVersion: 'html-poc-1',
  coverParticulars: [
    ['Section applied for', 'Section 13 — licence to possess a firearm for self-defence'],
    ['Submitted to', 'The Registrar of Firearms, through the Designated Firearms Officer'],
    ['Date', '8 October 2026'],
  ],
  ownedFirearms: [
    {
      make: 'Ceska Zbrojovka Model 557',
      calibre: '.308 Winchester',
      serial: '81815',
      expiry: '2031-06-30',
      type: 'Rifle',
      section: 'Section 16',
      status: 'Dedicated hunting',
    },
  ],
  firearmSpec: [
    { label: 'Make', value: 'Glock' },
    { label: 'Calibre', value: '9mm Parabellum (9x19mm)' },
    { label: 'Action', value: 'Safe action, striker-fired' },
    { label: 'Barrel', value: '114 mm' },
  ],
  batteryHeading: '5. Firearms already licensed to me',
  annexures: [
    { letter: 'A', label: 'A copy of your identity document' },
    { letter: 'B', label: 'A copy of your competency certificate' },
    { letter: 'C', label: 'Proof of address' },
  ],
  takeWithYou: [
    { label: 'Your identity document, original', note: 'not a copy' },
    { label: 'Your competency certificate, original' },
  ],
  watermark: true,
  generatedAt: new Date('2026-10-08T22:00:00Z'),
} as unknown as MotivationPdfInput;

(async () => {
  const html = renderMotivationHtml(input);
  const out = process.argv[2] ?? 'motivation-html-sample.pdf';
  fs.writeFileSync(out + '.html', html);
  const pdf = await new ChromiumPdfService().printHtml(html);
  fs.writeFileSync(out, pdf);
  // eslint-disable-next-line no-console
  console.log(`html ${html.length} bytes -> ${out}.html`);
  // eslint-disable-next-line no-console
  console.log(`pdf  ${pdf.length} bytes -> ${out}`);
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
