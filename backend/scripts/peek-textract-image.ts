// Run Textract on a local photo and print what the extractor reads off it.
// Needs AWS credentials in backend/.env. Nothing is stored.
//   KIND=PROFICIENCY npx ts-node scripts/peek-textract-image.ts path/to/photo.jpg
import * as dotenv from 'dotenv';
dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { extractDocument, lines, pairs } from '../src/licence-centre/textract-document-extract';
import { LicenceCentreTextractService } from '../src/licence-centre/licence-centre-textract.service';
import { WANTED } from '../src/licence-centre/licence-centre-extract.service';

const kind = (process.env.KIND ?? 'PROFICIENCY') as keyof typeof WANTED;
(async () => {
  const svc = new LicenceCentreTextractService();
  for (const file of process.argv.slice(2)) {
    const bytes = readFileSync(file);
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    const res = await svc.analyse(bytes, mime);
    console.log(`\n===== ${file}`);
    if (!res) {
      console.log('Textract returned nothing (credentials? size?)');
      continue;
    }
    console.log('LINES:', lines(res as never).join(' | '));
    console.log('PAIRS:', pairs(res as never).map((p) => `${p.key} => ${p.value}`).join(' ;; '));
    const r = extractDocument(res as never, kind as never, (WANTED as Record<string, string[]>)[kind] ?? []);
    console.log('READ:', JSON.stringify({ ...r.reading, notes: r.notes }));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
