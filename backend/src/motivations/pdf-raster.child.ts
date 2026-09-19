/**
 * Rasterise every page of ONE PDF to PNG — in its own process.
 *
 * ⚠️ IT IS A CHILD PROCESS BECAUSE THE RASTERISER CAN TAKE THE WHOLE SERVER
 * DOWN. `pdf-to-img` renders through pdf.js onto `@napi-rs/canvas`, and inside
 * a booted Nest process that combination has crashed node with an access
 * violation (0xC0000005) — no exception, no stack, nothing the caller's
 * try/catch can see. A native crash in a helper process costs one document and
 * the caller falls back; the same crash in the request process is an outage.
 * Reproduced 2026-09-15 on Node 24: boot the app, then rasterise a sheet, and
 * the process dies at the render call.
 *
 * ⚠️ NOTHING HERE MAY IMPORT NEST OR ANY SERVICE. The isolation only holds if
 * this process loads the rasteriser and almost nothing else, which is also why
 * it is a plain argv script rather than a provider.
 *
 * ⚠️ EVERY PAGE, NOT THE FIRST. This began as the C.I.P. inset's one-page
 * helper. It is now the shared rasteriser for uploaded PDF annexures too, and
 * those are routinely several pages — a bank statement behind proof of address
 * is eight. Writing only the first page would silently drop the rest of
 * somebody's evidence.
 *
 * Usage: node pdf-raster.child.js <in.pdf> <outDir> <scale>
 * Exit 0, `<outDir>/page-1.png` … `<outDir>/page-N.png` written, and a single
 * `PAGES <n>` line on stdout. Non-zero on any failure, including the native
 * crash — which is the point.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** The half of `pdf-to-img` this uses: PDF bytes in, one PNG per page out. */
type PdfRasteriser = (
  input: Buffer,
  opts: { scale: number },
) => Promise<AsyncIterable<Buffer>>;

export async function rasterisePdfPagesToDir(
  inputPath: string,
  outDir: string,
  scale: number,
): Promise<number> {
  const bytes = await fs.readFile(inputPath);
  await fs.mkdir(outDir, { recursive: true });

  /**
   * ⚠️ THE ESM-ONLY MODULE, RESOLVED FROM A COMMONJS FILE. This compiles to
   * `require('pdf-to-img')`, which Node 22.12+ and 24 resolve for an ES module
   * — the same mechanism the renderer relied on before it moved out here.
   */
  const mod = (await import('pdf-to-img')) as unknown as {
    pdf?: PdfRasteriser;
    default?: { pdf?: PdfRasteriser };
  };
  const toImages = mod.pdf ?? mod.default?.pdf;
  if (!toImages) throw new Error('pdf-to-img exposed no pdf()');

  const pages = await toImages(bytes, { scale });
  let written = 0;
  for await (const page of pages) {
    written += 1;
    await fs.writeFile(path.join(outDir, `page-${written}.png`), page);
  }
  if (!written) throw new Error('the document produced no pages');
  return written;
}

async function main(): Promise<void> {
  const [inputPath, outDir, scaleArg] = process.argv.slice(2);
  if (!inputPath || !outDir) {
    throw new Error('usage: pdf-raster.child <in.pdf> <outDir> <scale>');
  }
  const parsed = Number(scaleArg);
  const scale = Number.isFinite(parsed) && parsed > 0 ? parsed : 4;

  const written = await rasterisePdfPagesToDir(inputPath, outDir, scale);
  process.stdout.write(`PAGES ${written}\n`);
}

/**
 * ⚠️ ONLY WHEN RUN AS THE SCRIPT. A spec imports this module to exercise
 * `rasterisePdfPagesToDir`, and an unguarded `main()` would then run with
 * Jest's own argv, throw on the missing arguments, and `process.exit(1)` the
 * whole test run.
 */
if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
