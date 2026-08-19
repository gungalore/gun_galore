/* eslint-disable @typescript-eslint/no-require-imports */
// ────────────────────────────────────────────────────────────────────
// THE SCANNER'S CALIBRATION HARNESS.
//
//   node scripts/scan-diag.cjs <folder-of-photos>
//
// Runs the REAL detector — the same compiled code the phone runs — against a
// folder of photographs, and for each one reports the score, why it passed or
// failed, and writes two files beside it in an `out/` subfolder:
//
//   <name>.quad.jpg   the photo with the detected corners drawn on it
//   <name>.flat.jpg   the rectified, enhanced document — what extraction sees
//
// ⚠️ WHY THIS EXISTS. The detector's thresholds were tuned against synthetic
// scenes. The operator's real licence card, on a real desk, under a real
// ceiling light, is the ground truth those scenes approximated — and when the
// two disagree, the photos win. This harness is how a "it misses my card"
// report becomes "best candidate scored 0.41 against a floor of 0.55, area
// fraction 0.09 against a minimum of 0.15" — which is a fix, not a mystery.
//
// ⚠️ THE PHOTOS THEMSELVES ARE PII — a licence card carries a name, an ID
// number and serials. They live in scan-fixtures/, which is gitignored, and
// they must NEVER be committed. What gets committed instead is synthetic
// regression tests that reproduce the MEASURED conditions (area fraction,
// contrast, lighting slope) with generated content.
// ────────────────────────────────────────────────────────────────────

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(frontendRoot, '.scan-diag-cache');

// Compile the scan modules fresh each run, so the harness can never test
// stale code — the whole point is that this IS what the phone runs.
execSync(
  'npx tsc lib/scan/detect.ts lib/scan/geometry.ts lib/scan/warp.ts lib/scan/enhance.ts ' +
    '--module commonjs --target es2020 --skipLibCheck --outDir .scan-diag-cache',
  { cwd: frontendRoot, stdio: 'inherit' },
);

const { detectQuad, toLuma, ACCEPT_SCORE } = require(
  path.join(cacheDir, 'detect.js'),
);
const { outputSize, quadArea } = require(path.join(cacheDir, 'geometry.js'));
const { rectify } = require(path.join(cacheDir, 'warp.js'));
const { enhance, inspect } = require(path.join(cacheDir, 'enhance.js'));

const sharp = require('sharp');

async function main() {
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(folder)) {
    console.error('Usage: node scripts/scan-diag.cjs <folder-of-photos>');
    process.exit(1);
  }
  const outDir = path.join(folder, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs
    .readdirSync(folder)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (!files.length) {
    console.error(`No photos in ${folder}`);
    process.exit(1);
  }

  console.log(
    `\n${'file'.padEnd(28)} ${'size'.padEnd(11)} ${'score'.padEnd(6)} ` +
      `${'pass'.padEnd(5)} ${'area%'.padEnd(6)} ${'contr'.padEnd(6)} ms`,
  );

  for (const f of files) {
    const t0 = Date.now();
    // .rotate() honours the EXIF orientation — a phone photo is usually
    // stored sideways with a rotation flag, and ignoring it would hand the
    // detector a landscape frame the member never saw.
    const img = sharp(path.join(folder, f)).rotate();
    const meta = await img.metadata();
    const cap = 3000 / Math.max(meta.width ?? 1, meta.height ?? 1);
    const resized =
      cap < 1 ? img.resize(Math.round((meta.width ?? 1) * cap)) : img;
    const { data, info } = await resized
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;

    const gray = toLuma(new Uint8ClampedArray(data), w, h);
    // Floor 0 so a miss still reports its best candidate — the score of the
    // rectangle it ALMOST accepted is the tuning instruction.
    const best = detectQuad(gray, { acceptScore: 0 });
    const passes = best !== null && best.score >= ACCEPT_SCORE;
    const areaFrac = best
      ? Math.abs(quadArea(best.quad)) / (w * h)
      : 0;

    console.log(
      `${f.slice(0, 27).padEnd(28)} ${`${w}x${h}`.padEnd(11)} ` +
        `${best ? best.score.toFixed(2).padEnd(6) : 'none  '} ` +
        `${(passes ? 'YES' : 'no').padEnd(5)} ` +
        `${(areaFrac * 100).toFixed(0).padEnd(6)} ` +
        `${best ? String(Math.round(best.contrast)).padEnd(6) : '-     '} ` +
        `${Date.now() - t0}`,
    );

    if (!best) continue;

    // The photo with the corners drawn on it.
    const marked = Buffer.from(data);
    drawQuad(marked, w, h, best.quad, passes ? [0, 200, 80] : [255, 60, 60]);
    await sharp(marked, { raw: { width: w, height: h, channels: 4 } })
      .jpeg({ quality: 80 })
      .toFile(path.join(outDir, `${f}.quad.jpg`));

    // What extraction would actually be handed.
    const raster = { data: new Uint8ClampedArray(data), width: w, height: h };
    const size = outputSize(best.quad, 2000);
    const flat = rectify(raster, best.quad, size.w, size.h);
    if (flat) {
      const better = enhance(flat);
      const rep = inspect(better);
      await sharp(Buffer.from(better.data.buffer), {
        raw: { width: better.width, height: better.height, channels: 4 },
      })
        .jpeg({ quality: 85 })
        .toFile(path.join(outDir, `${f}.flat.jpg`));
      if (rep.glare > 0.015 || rep.sharpness < 3.5) {
        console.log(
          `  └ verdicts: glare ${(rep.glare * 100).toFixed(1)}%  sharpness ${rep.sharpness.toFixed(1)}`,
        );
      }
    }
  }
  console.log(
    `\nfloor is ${ACCEPT_SCORE}. Annotated copies are in ${outDir}\n` +
      'green corners = would be accepted, red = found but below the floor.\n',
  );
}

/** Thick lines along the quad's edges, straight into the RGBA buffer. */
function drawQuad(buf, w, h, quad, rgb) {
  const put = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const i = (py * w + px) * 4;
        buf[i] = rgb[0];
        buf[i + 1] = rgb[1];
        buf[i + 2] = rgb[2];
      }
    }
  };
  for (let e = 0; e < 4; e++) {
    const a = quad[e];
    const b = quad[(e + 1) % 4];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let s = 0; s <= steps; s++) {
      put(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
