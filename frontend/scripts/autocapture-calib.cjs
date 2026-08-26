/* eslint-disable @typescript-eslint/no-require-imports */
// ────────────────────────────────────────────────────────────────────
// WHERE TO PUT THE AUTO-CAPTURE INK FLOOR.
//
//   node scripts/autocapture-calib.cjs <folder-of-photos> [shape]
//
// Auto-capture fires when three things are true, and the first of them is "is
// there a document in the aim box" — measured as `inkiness()` over the box,
// against INK_AT in lib/scan/autocapture.ts. That number decides whether the
// scanner sits there doing nothing (too high) or photographs a desk (too low),
// and both of those are failures the operator has actually reported.
//
// So it is measured, not guessed. For every photograph this prints TWO numbers:
//
//   box     ink over the aim box, where the document is
//   corner  ink over a box of the SAME SIZE parked in a corner of the frame,
//           which is desk, carpet or tablecloth
//
// The floor belongs between the two populations: comfortably under the lowest
// `box`, comfortably over the highest `corner`. If those two overlap, no single
// threshold works and the gate needs a second signal — that is the finding, and
// it is worth knowing before shipping rather than after.
//
// ⚠️ THE PHOTOS THEMSELVES ARE PII — a licence card carries a name, an ID
// number and serials. They live in scan-fixtures/, which is gitignored, and
// must NEVER be committed. This script prints STATISTICS ONLY: it never writes
// an image out and never reports anything that could identify a document.
// ────────────────────────────────────────────────────────────────────

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(frontendRoot, '.scan-diag-cache');

// Compile fresh, so this can never measure stale code — the whole point is
// that these are the functions the phone runs.
execSync(
  'npx tsc lib/scan/detect.ts lib/scan/geometry.ts lib/scan/aim.ts lib/scan/shapes.ts ' +
    '--module commonjs --target es2020 --skipLibCheck --outDir .scan-diag-cache',
  { cwd: frontendRoot, stdio: 'inherit' },
);

const { inkiness, edgeContrast, toLuma } = require(
  path.join(cacheDir, 'detect.js'),
);
const { aimBox } = require(path.join(cacheDir, 'aim.js'));

/**
 * How UNEVENLY ink is spread across a region, 0-1.
 *
 * ⚠️ THE POINT OF THIS. Mean ink cannot tell a printed card from patterned
 * fabric — measured on the operator's eighteen photographs, the two
 * populations overlap completely, and on IMG_4947 the fabric is inkier than
 * the card. But they are not spread the same way: a document is mostly FLAT
 * with print on part of it, while fabric is textured edge to edge. So the
 * spread of ink across sub-tiles may separate what its mean cannot.
 */
function meanLuma(gray, rect) {
  let sum = 0, n = 0;
  const x1 = Math.min(gray.width - 1, Math.round(rect.x + rect.width));
  const y1 = Math.min(gray.height - 1, Math.round(rect.y + rect.height));
  for (let y = Math.max(0, Math.round(rect.y)); y < y1; y += 3) {
    for (let x = Math.max(0, Math.round(rect.x)); x < x1; x += 3) {
      sum += gray.data[y * gray.width + x]; n++;
    }
  }
  return n ? sum / n : 0;
}

function inkSpread(gray, rect, tiles = 4) {
  const vals = [];
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const x = rect.x + (rect.width * i) / tiles;
      const y = rect.y + (rect.height * j) / tiles;
      const w = rect.width / tiles;
      const h = rect.height / tiles;
      vals.push(
        inkiness(gray, [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ]),
      );
    }
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varc =
    vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
  return Math.sqrt(varc);
}

const sharp = require('sharp');

const rectQuad = (r) => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];

async function main() {
  const folder = process.argv[2];
  const shape = process.argv[3] ?? 'card';
  if (!folder || !fs.existsSync(folder)) {
    console.error(
      'Usage: node scripts/autocapture-calib.cjs <folder-of-photos> [shape]',
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(folder)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  if (!files.length) {
    console.error(`No photos in ${folder}`);
    process.exit(1);
  }

  console.log(`\nshape: ${shape}   photos: ${files.length}\n`);
  console.log(
    `${'file'.padEnd(20)} ${'box'.padEnd(7)} ${'corner'.padEnd(7)} ` +
      `${'spreadB'.padEnd(8)} ${'spreadC'.padEnd(8)} ${'contrast'.padEnd(8)} ${'lumaB'.padEnd(6)} lumaC`,
  );

  const boxInk = [];
  const cornerInk = [];
  const spreadBox = [];
  const spreadCorner = [];
  const contrast = [];

  for (const f of files) {
    // .rotate() honours EXIF — a phone photo is stored sideways with a flag,
    // and ignoring it measures a frame the member never saw.
    const img = sharp(path.join(folder, f)).rotate();
    const meta = await img.metadata();
    const cap = 3000 / Math.max(meta.width ?? 1, meta.height ?? 1);
    const resized =
      cap < 1 ? img.resize(Math.round((meta.width ?? 1) * cap)) : img;
    const { data, info } = await resized
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const gray = toLuma(new Uint8ClampedArray(data), info.width, info.height);
    const box = aimBox(shape, { width: info.width, height: info.height });

    // Same-sized box parked top-left, well clear of a centred document. This
    // stands in for "the member is pointing at their desk".
    const pad = Math.round(Math.min(info.width, info.height) * 0.02);
    const corner = {
      x: pad,
      y: pad,
      width: Math.min(box.width, box.x - pad * 2),
      height: Math.min(box.height, box.y - pad * 2),
    };

    const bi = inkiness(gray, rectQuad(box));
    boxInk.push(bi);
    const sb = inkSpread(gray, box);
    const ec = edgeContrast(gray, rectQuad(box));
    spreadBox.push(sb);
    contrast.push(ec);

    let ci = null;
    let sc = null;
    if (corner.width > 20 && corner.height > 20) {
      ci = inkiness(gray, rectQuad(corner));
      cornerInk.push(ci);
      sc = inkSpread(gray, corner);
      spreadCorner.push(sc);
    }

    console.log(
      `${f.padEnd(20)} ${bi.toFixed(3).padEnd(7)} ${
        ci === null ? '-'.padEnd(7) : ci.toFixed(3).padEnd(7)
      } ${sb.toFixed(3).padEnd(8)} ${
        sc === null ? '-'.padEnd(8) : sc.toFixed(3).padEnd(8)
      } ${ec.toFixed(1).padEnd(8)} ${meanLuma(gray, box).toFixed(0).padEnd(6)} ${sc === null ? "-" : meanLuma(gray, corner).toFixed(0)}`,
    );
  }

  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return {
      min: s[0],
      max: s[s.length - 1],
      median: s[Math.floor(s.length / 2)],
    };
  };

  const b = stat(boxInk);
  console.log(
    `\nbox     min ${b.min.toFixed(3)}  median ${b.median.toFixed(3)}  max ${b.max.toFixed(3)}`,
  );
  if (cornerInk.length) {
    const c = stat(cornerInk);
    console.log(
      `corner  min ${c.min.toFixed(3)}  median ${c.median.toFixed(3)}  max ${c.max.toFixed(3)}`,
    );
    const gap = b.min - c.max;
    console.log(
      gap > 0
        ? `\nSEPARATED by ${gap.toFixed(3)} — a floor anywhere in ` +
            `(${c.max.toFixed(3)}, ${b.min.toFixed(3)}) admits every document ` +
            `and refuses every desk.\nSuggested INK_AT: ${(c.max + gap / 2).toFixed(3)}`
        : `\n⚠️ OVERLAP of ${(-gap).toFixed(3)} — the lowest document (${b.min.toFixed(3)}) ` +
            `scores below the busiest desk (${c.max.toFixed(3)}).\nNo single ink ` +
            `floor separates them; the gate needs a second signal.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
