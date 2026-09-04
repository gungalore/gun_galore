#!/usr/bin/env node
/**
 * ARTBOARD → EXACT SPEC.
 *
 * The five prototypes in docs/design/desk-pwa are runnable HTML, so every
 * value the design intends is already written down: hexes, pixel sizes,
 * weights, letter-spacing, radii, the order of the elements. Nothing about
 * matching them needs to be a judgement call.
 *
 * 🚨 THIS EXISTS BECAUSE THE PREVIOUS METHOD WAS PROSE. Implementation was
 * driven off agent-written "gap reports" — a list of differences somebody
 * thought worth mentioning — which is lossy by construction: it reports the
 * notable, not the complete, and it converts an exact value into a sentence
 * about an exact value. The result was repeatedly close and not right.
 *
 * This prints the artboard's own numbers so the implementation can be checked
 * against them one at a time, and maps every colour it finds back to the
 * --dk-* token that carries it, since the Desk may not hold a raw hex.
 *
 *   node scripts/artboard-spec.cjs Main
 *   node scripts/artboard-spec.cjs Main --classes
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', '..', 'docs', 'design', 'desk-pwa');
const TOKENS = path.resolve(__dirname, '..', 'components', 'desk', 'tokens.css');

/** Every --dk-* token, by its literal value, so a hex can be named. */
function tokenMap() {
  const css = fs.readFileSync(TOKENS, 'utf8');
  const map = new Map();
  for (const m of css.matchAll(/(--dk-[\w-]+):\s*([^;]+);/g)) {
    map.set(m[2].trim().toUpperCase(), m[1]);
  }
  return map;
}

const NAMED = tokenMap();

function nameColour(hex) {
  const t = NAMED.get(hex.toUpperCase());
  return t ? `var(${t})` : `${hex}  ⚠️ NO TOKEN — add one or map it by hand`;
}

function main() {
  const screen = process.argv[2];
  if (!screen) {
    console.error('usage: node scripts/artboard-spec.cjs <Main|Ledger|Order|People|More> [--classes]');
    process.exit(1);
  }
  const file = path.join(DIR, `${screen}.dc.html`);
  if (!fs.existsSync(file)) {
    console.error(`no such artboard: ${file}`);
    process.exit(1);
  }
  const src = fs.readFileSync(file, 'utf8');

  console.log(`\n  ${screen}.dc.html\n  ${'─'.repeat(60)}`);

  // 1. Every colour the artboard uses, and the token that carries it.
  const hexes = [...new Set([...src.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]))];
  console.log('\n  COLOURS');
  for (const h of hexes.sort()) console.log(`    ${h}  →  ${nameColour(h)}`);

  // 2. The class recipes — the design system of this screen, stated once.
  if (process.argv.includes('--classes')) {
    console.log('\n  CLASS RECIPES');
    for (const m of src.matchAll(/^\s*(\.[\w.-]+)\s*\{([^}]*)\}/gm)) {
      const decls = m[2]
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean);
      console.log(`\n    ${m[1]}`);
      for (const d of decls) console.log(`      ${d}`);
    }
  }

  // 3. The document order — what sits where, which is the half a gap report
  //    never carries.
  console.log('\n  STRUCTURE (in order, with the class or inline role)');
  const body = src.slice(src.indexOf('<div style="width: 390px'));
  let depth = 0;
  for (const m of body.matchAll(/<(\/?)(div|span|button|nav|section|svg)\b([^>]*)>/g)) {
    const closing = m[1] === '/';
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (m[2] === 'svg') continue;
    const attrs = m[3];
    const cls = (attrs.match(/class="([^"]+)"/) || [])[1];
    const style = (attrs.match(/style="([^"]+)"/) || [])[1];
    const hint = cls
      ? `.${cls.split(' ').join('.')}`
      : style
        ? style.replace(/\s+/g, ' ').slice(0, 74)
        : m[2];
    console.log(`    ${'  '.repeat(Math.min(depth, 8))}${hint}`);
    if (!/\/>$/.test(m[0])) depth += 1;
  }
  console.log('');
}

main();
