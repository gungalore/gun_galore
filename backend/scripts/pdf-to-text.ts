/**
 * Extract per-page text from a PDF into JSONL ({page, text} per line), using
 * the same pdf-parse the manual ingester uses. Local prep for building the
 * ManualLoad seed from the curated reloading manuals — no server AI.
 *
 *   npx ts-node scripts/pdf-to-text.ts "in.pdf" "out.jsonl"
 */
import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';

async function main() {
  const [inp, outp] = process.argv.slice(2);
  if (!inp || !outp) {
    console.error('usage: pdf-to-text.ts <in.pdf> <out.jsonl>');
    process.exit(1);
  }
  const buf = fs.readFileSync(inp);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    const lines = res.pages.map((p) =>
      JSON.stringify({ page: p.num, text: (p.text ?? '').replace(/\r/g, '') }),
    );
    fs.writeFileSync(outp, lines.join('\n'));
    console.log(`${res.pages.length} pages -> ${outp}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
