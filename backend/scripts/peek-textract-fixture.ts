// Print what Textract saw on a fixture and what the extractor reads off it.
//   npx ts-node scripts/peek-textract-fixture.ts doc01 doc10
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocument, lines, pairs } from '../src/licence-centre/textract-document-extract';

const DIR = join(__dirname, '..', 'src', 'licence-centre', '__fixtures__', 'textract');
const kind = (process.env.KIND ?? 'PROFICIENCY') as never;
const material = (process.env.MATERIAL ?? 'certificate_number,holder_name,unit_standard').split(',');
for (const doc of process.argv.slice(2)) {
  const res = JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8'));
  console.log(`\n===== ${doc}`);
  console.log('LINES:', lines(res).join(' | '));
  console.log('PAIRS:', pairs(res).map((p) => `${p.key} => ${p.value} (${p.confidence.toFixed(0)})`).join(' ;; '));
  const r = extractDocument(res, kind, material);
  console.log('READ:', JSON.stringify({ ...r.reading, autoFillable: r.autoFillable, notes: r.notes }));
}
