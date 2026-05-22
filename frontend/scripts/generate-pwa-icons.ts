// Generates the 5 PWA icon PNGs from a single source image.
//
// Usage:
//   1. Drop a square source icon at one of:
//        frontend/icon-source.png
//        frontend/icon-source.svg
//        frontend/icon-source.jpg
//        frontend/icon-source.jpeg
//      (PNG with transparency preferred; SVG works too. Square is best.)
//   2. From the frontend directory:
//        npx ts-node scripts/generate-pwa-icons.ts
//
// Outputs (in frontend/public/):
//   icon-192.png            — 192x192, alpha preserved
//   icon-512.png            — 512x512, alpha preserved
//   icon-maskable-192.png   — 192x192, icon in inner 80% safe zone, brand bg
//   icon-maskable-512.png   — 512x512, icon in inner 80% safe zone, brand bg
//   apple-icon-180.png      — 180x180, icon in inner 90%, brand bg
//
// Re-run the script any time the source icon changes. It will overwrite
// the outputs in place.

import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Resolve paths from the current working directory — the script is
// meant to be run from the frontend dir, not the scripts subdir.
const FRONTEND_DIR = process.cwd();
const PUBLIC_DIR = path.join(FRONTEND_DIR, 'public');

// Brand dark background — matches manifest theme_color + background_color
// and the layout.tsx viewport themeColor. Keep these in sync.
const BRAND_BG = { r: 15, g: 15, b: 15, alpha: 1 } as const; // #0f0f0f
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

const SOURCE_CANDIDATES = [
  'icon-source.png',
  'icon-source.svg',
  'icon-source.jpg',
  'icon-source.jpeg',
];

// Look in both frontend/ and frontend/public/ — users naturally drop
// it in /public alongside the other static assets.
function findSource(): string {
  const searchDirs = [FRONTEND_DIR, PUBLIC_DIR];
  for (const dir of searchDirs) {
    for (const name of SOURCE_CANDIDATES) {
      const p = path.join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  throw new Error(
    `No source icon found. Drop one at frontend/icon-source.{png,svg,jpg,jpeg} or frontend/public/icon-source.{png,svg,jpg,jpeg}`,
  );
}

async function plainIcon(source: string, size: number, outName: string) {
  await sharp(source)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(path.join(PUBLIC_DIR, outName));
  console.log(`  wrote ${outName} (${size}x${size})`);
}

async function maskableIcon(source: string, size: number, outName: string) {
  // Inner 80% safe zone — Android adaptive icon masks (circle, squircle,
  // rounded square) crop anything outside this. The 20% padding is
  // filled with brand bg so cropping never reveals a hard edge.
  const inner = Math.round(size * 0.8);
  const scaled = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_BG },
  })
    .composite([{ input: scaled, gravity: 'center' }])
    .png()
    .toFile(path.join(PUBLIC_DIR, outName));
  console.log(`  wrote ${outName} (${size}x${size}, maskable, ${inner}px safe zone)`);
}

async function appleIcon(source: string) {
  // iOS rounds corners with a ~22% radius — fill 90% of the canvas so
  // the rounded corners don't clip the logo. Brand bg fills the rest;
  // iOS doesn't honour transparency on apple-touch-icon.
  const inner = Math.round(180 * 0.9);
  const scaled = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 180, height: 180, channels: 4, background: BRAND_BG },
  })
    .composite([{ input: scaled, gravity: 'center' }])
    .png()
    .toFile(path.join(PUBLIC_DIR, 'apple-icon-180.png'));
  console.log(`  wrote apple-icon-180.png (180x180)`);
}

async function main() {
  const source = findSource();
  console.log(`Source: ${path.relative(FRONTEND_DIR, source)}`);
  console.log(`Output: ${path.relative(FRONTEND_DIR, PUBLIC_DIR)}/\n`);

  await plainIcon(source, 192, 'icon-192.png');
  await plainIcon(source, 512, 'icon-512.png');
  await maskableIcon(source, 192, 'icon-maskable-192.png');
  await maskableIcon(source, 512, 'icon-maskable-512.png');
  await appleIcon(source);

  console.log('\nDone. 5 icons generated.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
