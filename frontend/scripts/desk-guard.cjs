#!/usr/bin/env node
/**
 * THE DESK — the build guard.
 *
 * Two rules from the build plan, enforced mechanically rather than by
 * memory, because both are the kind that erode one reasonable-looking commit
 * at a time:
 *
 *   1. NOTHING IN THE DESK IMPORTS FROM THE LEGACY ADMIN. The Desk is a
 *      rebuild, not a reskin. The first time a legacy component is wrapped
 *      instead of replaced, the old panel's vocabulary is back inside the new
 *      one and the cutover can never delete anything.
 *
 *   2. NO RAW COLOUR IN THE DESK. Every colour comes from a --dk-* token.
 *      A hex that matches the palette today is a hex that silently stops
 *      matching it the day the palette moves — and on this surface the
 *      palette IS the meaning, because colour is reserved for state.
 *
 * Wired into `npm run build`, so it fails the deploy rather than printing a
 * warning nobody reads. There is no CI in this repo — `next build` is the
 * only real gate, so the guard has to stand in front of it.
 *
 * At cutover this file inverts: rule 1 becomes "the legacy admin paths must
 * not exist at all".
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Trees the Desk owns, and which these rules police.
 *
 * ⚠️ THE lib/ ENTRIES ARE DISCOVERED, NOT LISTED. A hand-maintained list is
 * the same erosion this guard exists to stop, one module at a time: every
 * lib/desk-*.ts written after the list was typed is unpoliced, and the guard
 * still prints "clean" — which is worse than no guard, because someone read
 * it and believed it. desk-case, desk-listing, desk-member and desk-order all
 * shipped into exactly that blind spot.
 */
function deskLibs() {
  try {
    return fs
      .readdirSync(path.join(ROOT, 'lib'))
      .filter((n) => /^desk-.*\.tsx?$/.test(n) && !/\.(spec|test)\.tsx?$/.test(n))
      .map((n) => `lib/${n}`);
  } catch {
    return [];
  }
}

const GUARDED = ['components/desk', 'app/admin/desk', 'app/admin/desk-kit', ...deskLibs()];

/**
 * Imports the Desk may not make.
 *
 * lib/admin-auth is on the list deliberately: lib/desk-auth exists precisely
 * because the old one leaves a live JWT in localStorage after sign-out, and
 * importing the old one back in would reintroduce that hole.
 */
/*
 * ⚠️ THE GUARD INVERTED AT CUTOVER. Before it, this list stopped the Desk
 * IMPORTING the legacy admin. The legacy admin is now deleted, so the risk is
 * no longer a bad import — it is somebody reintroducing the tree, and the
 * import rules below become unreachable dead law the day nothing matches them.
 * The check that matters now is that these paths STAY GONE.
 *
 * CUTOVER IS DONE. If one of these exists again, either a revert went wrong or
 * a page was rebuilt in the wrong place; either way the Desk is no longer the
 * only admin and that is worth failing a build over.
 */
const MUST_NOT_EXIST = [
  { path: "app/admin/(protected)", why: "the legacy admin pages were deleted at cutover" },
  { path: "components/admin", why: "the legacy admin components were deleted at cutover" },
  { path: "lib/admin-auth.ts", why: "replaced by lib/desk-auth.ts, which does not leak a live JWT after sign-out" },
];

const FORBIDDEN_IMPORTS = [
  { pattern: /components\/admin\//, why: 'the legacy admin kit — the Desk builds its own' },
  { pattern: /app\/admin\/\(protected\)/, why: 'the legacy admin pages' },
  { pattern: /lib\/admin-auth/, why: 'the legacy auth lib — use lib/desk-auth (honest sign-out)' },
];

/**
 * Colours that must come from a token instead.
 *
 * ⚠️ tokens.css IS EXEMPT AND MUST BE. It is the one file whose whole job is
 * to hold the literal values; a guard that cannot express its own exception
 * blocks the thing it is protecting. Nothing else gets an exemption.
 *
 * ⚠️ AND SPEC FILES ARE NOT WALKED, for a reason worth writing down: a Desk
 * support reference is `#ABC123` — six characters that are also a valid hex
 * colour — so a fixture asserting one would fail the build with a message
 * about the palette. Specs render no pixels, so the colour rule has no work
 * to do in them; if that ever changes, the exception has to shrink, not the
 * rule.
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const HEX_EXEMPT = new Set(['components/desk/tokens.css']);

/** Storefront tokens. Correct on the shop, wrong on the Desk. */
const STOREFRONT_TOKEN = /var\(\s*--(bg|bg-card|bg-deep|bg-inset|text-primary|text-secondary|text-tertiary|gold|red|border|hairline|elev-\d)\b/;

/** Tailwind utilities the global box-shadow kill switch renders inert. */
const DEAD_UTILITY = /\b(shadow-(sm|md|lg|xl|2xl|inner)|ring-\d|ring-offset-\d)\b/;

const problems = [];

for (const entry of MUST_NOT_EXIST) {
  if (fs.existsSync(path.join(ROOT, entry.path))) {
    problems.push(entry.path + " exists again — " + entry.why);
  }
}


function walk(dir) {
  /**
   * ⚠️ A GUARDED ENTRY IS OFTEN A FILE, NOT A TREE. readdirSync on a file
   * throws ENOTDIR, and the catch below swallowed it — so every single-file
   * entry was printed in the "clean" line and never opened. Proven with a
   * planted `#abc123` in a lib/desk-*.ts: the guard listed the file and
   * passed. A guard that names a file it did not read is worse than no guard,
   * because someone read the name and believed it.
   */
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return; // a guarded path that does not exist yet is not a failure
  }
  if (stat.isFile()) {
    if (/\.(tsx?|jsx?|css)$/.test(dir)) check(dir);
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a guarded tree that does not exist yet is not a failure
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (/\.(tsx?|jsx?|css)$/.test(e.name)) {
      check(full);
    }
  }
}

function check(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    // Comments are prose, and prose is allowed to name the thing it warns
    // about — several of these files explain the rule by quoting it.
    const code = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '');
    const trimmed = code.trim();
    if (!trimmed || trimmed.startsWith('*')) return;

    if (/^\s*(import|export)\s|require\(/.test(code)) {
      for (const f of FORBIDDEN_IMPORTS) {
        if (f.pattern.test(code)) {
          problems.push(`${at}  imports ${f.why}\n    ${trimmed}`);
        }
      }
    }

    if (!HEX_EXEMPT.has(rel) && HEX.test(code)) {
      problems.push(`${at}  raw hex colour — use a --dk-* token\n    ${trimmed}`);
    }

    if (STOREFRONT_TOKEN.test(code)) {
      problems.push(`${at}  storefront token on the Desk — use a --dk-* token\n    ${trimmed}`);
    }

    if (DEAD_UTILITY.test(code)) {
      problems.push(
        `${at}  shadow-*/ring-* does nothing here (globals.css kills box-shadow); use outline\n    ${trimmed}`,
      );
    }
  });
}

for (const tree of GUARDED) walk(path.join(ROOT, tree));

if (problems.length > 0) {
  console.error(`\n  The Desk guard found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('  See components/desk/tokens.css for the palette, and the build plan for the rules.\n');
  process.exit(1);
}

console.log(`  Desk guard: clean (${GUARDED.join(', ')})`);
