/* eslint-disable @typescript-eslint/no-require-imports */
// ────────────────────────────────────────────────────────────────────
// DOES THE AIM BOX REJECT WHAT THE DETECTOR GOT WRONG?
//
//   node scripts/aim-check.cjs <folder> <shape>
//
// The detector alone cannot tell a licence card from the desk it is lying on:
// on the operator's IMG_4947 it picked out the fabric and the ruler, scored
// it 0.68 against a floor of 0.55, and would have photographed that. Nothing
// IN the image says which rectangle is the document.
//
// The member says, by putting it inside the corners. This measures whether
// that actually separates the two — run it whenever the aim threshold or the
// box size moves.
// ────────────────────────────────────────────────────────────────────
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.scan-diag-cache');
execSync(
  'npx tsc lib/scan/detect.ts lib/scan/geometry.ts lib/scan/aim.ts lib/scan/shapes.ts ' +
    '--module commonjs --target es2020 --skipLibCheck --outDir .scan-diag-cache',
  { cwd: root, stdio: 'inherit' },
);
const { detectQuad } = require(path.join(cache, 'detect.js'));
const { aimBox, aimAgreement } = require(path.join(cache, 'aim.js'));
const { expectAspect } = require(path.join(cache, 'shapes.js'));
const sharp = require('sharp');

const [folder, shape = 'card'] = process.argv.slice(2);
if (!folder) {
  console.error('Usage: node scripts/aim-check.cjs <folder> [shape]');
  process.exit(1);
}

const DETECT_WIDTH = 320;
const THRESHOLD = 0.35;

(async () => {
  const files = fs
    .readdirSync(folder)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  console.log(`shape=${shape}  aim threshold=${THRESHOLD}\n`);
  console.log('file                 score  area%  blind  aim   verdict');
  let kept = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(folder, f));
    const meta = await sharp(buf).rotate().metadata();
    const w = DETECT_WIDTH;
    const h = Math.round((meta.height / meta.width) * w);
    const { data } = await sharp(buf).rotate().greyscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const box = aimBox(shape, { width: w, height: h });
    // BOTH WAYS: what the detector picks blind, and what it picks when it is
    // told where the member aimed. The difference is the whole question.
    const gray = { data: new Uint8ClampedArray(data), width: w, height: h };
    const blind = detectQuad(gray, { expectAspect: expectAspect(shape) });
    const found = detectQuad(gray, { expectAspect: expectAspect(shape), aimBox: box });
    if (!found) {
      console.log(`${f.padEnd(20)} —      —      —     no detection`);
      continue;
    }
    const xs = found.quad.map((p) => p.x);
    const ys = found.quad.map((p) => p.y);
    const bounds = {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    const aim = aimAgreement(bounds, box);
    let blindAim = 0;
    if (blind) {
      const bxs = blind.quad.map((p) => p.x), bys = blind.quad.map((p) => p.y);
      blindAim = aimAgreement({
        x: Math.min(...bxs), y: Math.min(...bys),
        width: Math.max(...bxs) - Math.min(...bxs),
        height: Math.max(...bys) - Math.min(...bys),
      }, box);
    }
    const ok = aim >= THRESHOLD;
    if (ok) kept++;
    const moved = Math.abs(aim - blindAim) > 0.02 ? (aim > blindAim ? '  BETTER' : '  worse') : '';
    console.log(
      `${f.padEnd(20)} ${found.score.toFixed(2)}   ${String(Math.round(found.areaFraction * 100)).padStart(3)}   ${blindAim.toFixed(2)}  ${aim.toFixed(2)}   ${ok ? 'AUTO-CAPTURE' : 'held back'}${moved}`,
    );
  }
  console.log(`\n${kept}/${files.length} would auto-capture.`);
})();
