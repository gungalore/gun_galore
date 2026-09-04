#!/usr/bin/env node
/**
 * THE SHOP'S LAUNCH COLOUR — one value, named in three files.
 *
 * `--bg` in app/globals.css is what the page actually paints.
 * `background_color` + `theme_color` in app/manifest.ts are what Android
 * paints behind the install splash and into the status bar / task switcher.
 * `viewport.themeColor` in app/layout.tsx is what colours the browser chrome.
 *
 * When they disagree the installed app launches in one colour and settles into
 * another — a visible flash on every single launch, on the surface a user sees
 * before anything else.
 *
 * 🚨 WHY THIS IS A SCRIPT AND NOT A COMMENT. It was a comment. manifest.ts
 * said, in capitals, "Three places name this colour; they must not disagree
 * again" — and nineteen hours later --bg moved to #FFFFFF for "white
 * background only on the whole website" while the manifest and the viewport
 * stayed on the Winkel cream #F6F5F1. Nobody was careless; the comment simply
 * was not in the path of the person changing the CSS. This is.
 *
 * ⚠️ The Desk is deliberately NOT checked. app/admin/desk/layout.tsx overrides
 * themeColor to the Desk ground (#101312) on purpose — it is a different
 * surface with a different skin, not a drift.
 *
 * Wired into `npm run build`, because there is no CI in this repo and
 * `next build` is the only gate that actually runs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const problems = [];
const found = {};

/** Pull one value out, or record WHY we could not and refuse to pass. */
function extract(label, file, re, opts = {}) {
  let src;
  try {
    src = read(file);
  } catch {
    problems.push(`${label}: cannot read ${file}`);
    return null;
  }
  const matches = [...src.matchAll(re)].map((m) => m[1].toUpperCase());
  if (matches.length === 0) {
    // A silently-unmatched regex is how a check starts reporting "clean" about
    // a file it no longer understands. Fail instead.
    problems.push(
      `${label}: no match in ${file} — this check no longer understands that ` +
        `file and is refusing to report it as in sync. Fix the pattern in ` +
        `scripts/theme-sync.cjs.`,
    );
    return null;
  }
  if (opts.expect && matches.length !== opts.expect) {
    problems.push(
      `${label}: expected ${opts.expect} value(s) in ${file}, found ${matches.length}`,
    );
  }
  const distinct = [...new Set(matches)];
  if (distinct.length > 1) {
    problems.push(`${label}: disagrees with itself in ${file} — ${distinct.join(' vs ')}`);
    return null;
  }
  found[label] = distinct[0];
  return distinct[0];
}

const bg = extract('globals.css --bg', 'app/globals.css', /--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/g, {
  expect: 1,
});
const manifest = extract(
  'manifest.ts',
  'app/manifest.ts',
  /(?:background_color|theme_color):\s*'(#[0-9a-fA-F]{3,8})'/g,
  { expect: 2 },
);
const viewport = extract(
  'layout.tsx viewport',
  'app/layout.tsx',
  /prefers-color-scheme: (?:dark|light)\)',\s*color:\s*'(#[0-9a-fA-F]{3,8})'/g,
  { expect: 2 },
);

const values = { bg, manifest, viewport };
const present = Object.entries(values).filter(([, v]) => v);
const distinct = [...new Set(present.map(([, v]) => v))];

if (present.length === 3 && distinct.length > 1) {
  problems.push(
    'The shop launch colour disagrees across the three files that name it:\n' +
      Object.entries(found)
        .map(([k, v]) => `      ${v}   ${k}`)
        .join('\n') +
      '\n    --bg is the one that is actually painted; the other two must follow it.\n' +
      '    ⚠️ The iOS launch images in public/splash/ are ALSO baked to this colour.\n' +
      '    Regenerate them when it changes, or the iOS splash keeps the old one:\n' +
      '      npx pwa-asset-generator public/logo-mark-dark.svg public/splash \\\n' +
      '        --background "<colour>" --splash-only --portrait-only --opaque false \\\n' +
      '        --padding "30%" --quality 90 --type jpeg',
  );
}

if (problems.length > 0) {
  console.error(`\n  Theme sync found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`  Theme sync: clean (${distinct[0]} in globals.css, manifest.ts, layout.tsx)`);
