#!/usr/bin/env node
/**
 * THE DESK — the build guard.
 *
 * Three rules, enforced mechanically rather than by memory, because each is
 * the kind that erodes one reasonable-looking commit at a time:
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
 *   3. NO DESK LIB FUNCTION IMPORTED AND NEVER CALLED. This repo's most
 *      common defect is a finished feature nobody connected, and an unused
 *      import is its signature — see the note above the rule for the payout
 *      run that shipped that way, with passing tests and a cutover note
 *      recording the gap as closed.
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

/**
 * The one hex a Desk file may legitimately carry: a `themeColor`.
 *
 * ⚠️ A THEME-COLOR CANNOT BE A var(). It is a <meta> value read by the browser
 * chrome — the status bar, the tab strip, the pull-to-refresh gutter — long
 * before any stylesheet is parsed. `var(--dk-ground)` there resolves to
 * nothing and the tag is silently dropped, which is the failure mode this
 * guard exists to prevent, not an instance of it.
 *
 * Narrowed to the DECLARATION rather than exempting the file, so the same
 * layout still cannot smuggle a hex into an ordinary style. Same reasoning as
 * tokens.css's exemption above: a guard that cannot express its own exception
 * blocks the thing it is protecting.
 */
const THEME_COLOR_DECL = /\bthemeColor\s*:/;

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
    if (/\.(tsx?|jsx?|css)$/.test(dir)) {
      check(dir);
      checkUnusedDeskImports(dir);
    }
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
      checkUnusedDeskImports(full);
    }
  }
}

function check(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  // SPLIT ON /\r?\n/, NOT '\n'. Splitting on the newline alone leaves a
  // trailing \r on every line of a CRLF checkout, and JavaScript's `.` does
  // not match \r -- so the comment stripper below, whose `//.*$` carries no
  // `m` flag, silently fails to match and every comment is then scanned as
  // if it were code. That made this guard reject a hex colour QUOTED INSIDE
  // A COMMENT, but only on Windows: the same commit passed on an LF
  // checkout and failed on a CRLF one, which is the worst kind of build
  // failure to chase down.
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

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

    if (!HEX_EXEMPT.has(rel) && !THEME_COLOR_DECL.test(code) && HEX.test(code)) {
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

/**
 * RULE 3 — A DESK LIB FUNCTION IMPORTED AND NEVER CALLED.
 *
 * This repo's single most common defect is not a broken feature, it is a
 * finished one nobody connected: of 17 gaps closed in the cutover, sixteen
 * were endpoints or helpers that already existed and simply had no caller.
 *
 * 🚨 IT HAPPENED AGAIN AND SHIPPED. `runDuePayouts` and `describePayoutRun`
 * were written, unit-tested, and imported at the top of the Ledger — and the
 * confirm handler still set a hard-coded "not sent" and never called them. The
 * Ledger could say what every seller was owed and pay none of it, and the
 * cutover note recorded the gap as CLOSED. Nothing caught it: the lib had
 * tests (they passed — they tested the lib), `next/typescript` only WARNS on
 * an unused binding, and `npm run lint` is not part of `npm run build`.
 *
 * An unused import is the exact signature of that bug, so the build now
 * refuses it. A binding that is genuinely not needed should be deleted, not
 * left as a promise the screen does not keep.
 */
function checkUnusedDeskImports(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (!/\.tsx?$/.test(rel) || /\.(spec|test)\.tsx?$/.test(rel)) return;
  const src = fs.readFileSync(file, 'utf8');

  // Only value imports from the Desk's own lib. A type-only import is checked
  // by tsc in type position and is not what this rule is about.
  const IMPORT_RE = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]*desk-[\w-]+)['"];?/gm;

  // ⚠️ COMPUTED ONCE, AND WITH ITS OWN REGEX OBJECT. Calling
  // String.replace with a /g regex resets that regex's lastIndex to 0 —
  // so doing this inside the exec loop below restarted the scan from the
  // top on every iteration and hung the build. Caught by the guard taking
  // longer than two minutes on a tree it should cross in milliseconds.
  const body = src.replace(new RegExp(IMPORT_RE.source, 'gm'), '');

  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    if (/^import\s+type/.test(m[0])) continue;
    for (const raw of m[1].split(',')) {
      const spec = raw.trim();
      if (!spec || spec.startsWith('type ')) continue;
      // `a as b` binds b; a bare `a` binds a.
      const local = (spec.includes(' as ') ? spec.split(' as ')[1] : spec).trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(local)) continue;
      const used = new RegExp(`\\b${local.replace(/\$/g, '\\$')}\\b`).test(body);
      if (!used) {
        problems.push(
          `${rel}  imports \`${local}\` from ${m[2]} and never uses it\n` +
            '    A Desk lib function imported but not called is how "built but not wired"\n' +
            '    ships. Call it, or delete the import — do not leave it as a promise.',
        );
      }
    }
  }
}

for (const tree of GUARDED) walk(path.join(ROOT, tree));

if (problems.length > 0) {
  console.error(`\n  The Desk guard found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('  See components/desk/tokens.css for the palette, and the build plan for the rules.\n');
  process.exit(1);
}

console.log(`  Desk guard: clean (${GUARDED.join(', ')})`);
