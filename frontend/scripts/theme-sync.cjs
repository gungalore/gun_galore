#!/usr/bin/env node
/**
 * THE SHOP'S LAUNCH COLOUR — two values, named in three files each.
 *
 * Light arm: `--bg` in `:root` of app/globals.css == `background_color` +
 *   `theme_color` in app/manifest.ts == light `themeColor` in app/layout.tsx.
 * Dark arm:  `--bg` in `[data-theme="dark"]` of app/globals.css == dark
 *   `themeColor` in app/layout.tsx.
 *
 * When they disagree the installed app launches in one colour and settles
 * into another — a visible flash on every single launch, on the surface a
 * user sees before anything else.
 *
 * 🚨 WHY THIS IS A SCRIPT AND NOT A COMMENT. It was a comment. manifest.ts
 * said, in capitals, "Three places name this colour; they must not disagree
 * again" — and nineteen hours later --bg moved to #FFFFFF for "white
 * background only on the whole website" while the manifest and the viewport
 * stayed on the Winkel cream #F6F5F1. Nobody was careless; the comment simply
 * was not in the path of the person changing the CSS. This is.
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

// Light arm — globals.css :root --bg, manifest.ts, layout.tsx light themeColor.
const bgLight = extract('globals.css :root --bg', 'app/globals.css', /:root\s*\{[\s\S]*?--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/g);
const manifestBg = extract(
  'manifest.ts background_color',
  'app/manifest.ts',
  /background_color:\s*'(#[0-9a-fA-F]{3,8})'/g,
  { expect: 1 },
);
const manifestTheme = extract(
  'manifest.ts theme_color',
  'app/manifest.ts',
  /theme_color:\s*'(#[0-9a-fA-F]{3,8})'/g,
  { expect: 1 },
);
const viewportLight = extract(
  'layout.tsx viewport light',
  'app/layout.tsx',
  /prefers-color-scheme:\s*light\)',\s*color:\s*'(#[0-9a-fA-F]{3,8})'/g,
  { expect: 1 },
);

// Dark arm — globals.css [data-theme="dark"] --bg, layout.tsx dark themeColor.
const bgDark = extract('globals.css [data-theme] --bg', 'app/globals.css', /\[data-theme="dark"\]\s*\{[\s\S]*?--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/g);
const viewportDark = extract(
  'layout.tsx viewport dark',
  'app/layout.tsx',
  /prefers-color-scheme:\s*dark\)',\s*color:\s*'(#[0-9a-fA-F]{3,8})'/g,
  { expect: 1 },
);

const lightValues = { bg: bgLight, manifestBg, manifestTheme, viewportLight };
const darkValues = { bg: bgDark, viewport: viewportDark };

const lightPresent = Object.entries(lightValues).filter(([, v]) => v);
const lightDistinct = [...new Set(lightPresent.map(([, v]) => v))];

const darkPresent = Object.entries(darkValues).filter(([, v]) => v);
const darkDistinct = [...new Set(darkPresent.map(([, v]) => v))];

if (lightPresent.length >= 3 && lightDistinct.length > 1) {
  problems.push(
    'The light launch colour disagrees across the files that name it:\n' +
      Object.entries(found)
        .filter(([k]) => k.includes('light') || k.includes('bg') || k.includes('manifest'))
        .map(([k, v]) => `      ${v}   ${k}`)
        .join('\n') +
      '\n    --bg (globals.css :root) is the one that is actually painted; the others must follow it.\n',
  );
}

if (darkPresent.length >= 2 && darkDistinct.length > 1) {
  problems.push(
    'The dark launch colour disagrees:\n' +
      Object.entries(found)
        .filter(([k]) => k.includes('dark') || k.includes('globals'))
        .map(([k, v]) => `      ${v}   ${k}`)
        .join('\n') +
      '\n    --bg (globals.css [data-theme="dark"]) must match the dark viewport themeColor.\n',
  );
}

if (problems.length > 0) {
  console.error(`\n  Theme sync found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`  Theme sync: clean (light=${lightDistinct[0]}, dark=${darkDistinct[0] || 'N/A'})`);
