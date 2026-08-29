import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ────────────────────────────────────────────────────────────────────
// A HELPER THAT CALLS ITSELF TOOK THE MOTIVATION CENTRE DOWN.
//
// ⚠️ THIS SHIPPED TO PRODUCTION ON 2026-08-29 AND EVERY APPLICATION READ
// "We could not open this application."
//
// Seven call sites wrote `setDocuments(up.documents)`. Collapsing them onto
// one `applyUploads` helper was right; doing it with a blanket
// find-and-replace was not, because the SEVENTH occurrence was inside the body
// of the new helper:
//
//     const applyUploads = useCallback((up) => {
//       applyUploads(up);            // ← was setDocuments(up.documents)
//       setProficiency(up.proficiency ?? null);
//     }, []);
//
// Infinite recursion. The stack overflow was swallowed by the page loader's
// catch, so there was NO console error, and every network request returned
// 200 — the page simply refused to open, and nothing on screen or in the
// devtools said why. It survived tsc, the unit suite and a clean production
// build, because all of those are happy with a function that calls itself.
//
// So it is asserted here, on the source, which is the only place it is
// visible. Cheap, and it covers the whole class rather than the one instance.
// ────────────────────────────────────────────────────────────────────

const ROOTS = ['app', 'components', 'hooks', 'lib'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** `const NAME = useCallback(` or `useMemo(` — the two that took us down. */
const DECL = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(useCallback|useMemo)\s*\(/g;

/**
 * The function body, exactly — brace-balanced from the arrow.
 *
 * ⚠️ A FIXED-SIZE WINDOW IS NOT GOOD ENOUGH, AND THE FIRST VERSION OF THIS
 * TEST PROVED IT: reading 1200 characters forward flagged 101 helpers, nearly
 * all of them a `load` defined here and legitimately called by a useEffect
 * further down the file. A guard that cries wolf a hundred times is a guard
 * somebody deletes, so this reads the real body and nothing else.
 */
function bodyOf(src: string, from: number): string {
  const arrow = src.indexOf('=>', from);
  if (arrow < 0) return '';
  const open = src.indexOf('{', arrow);
  const eol = src.indexOf('\n', arrow);
  // A concise body — `(x) => setThing(x)` — ends at the newline.
  if (open < 0 || open > eol) return src.slice(arrow + 2, eol);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

describe('⚠️ no helper calls itself', () => {
  const files = ROOTS.flatMap((r) => sourceFiles(r));

  it('found the source tree', () => {
    // If this reads zero, every assertion below passes for the wrong reason.
    expect(files.length).toBeGreaterThan(50);
  });

  it('no useCallback/useMemo helper invokes its own name in its own body', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(DECL)) {
        const name = m[1];
        // ⚠️ COMMENTS OUT FIRST. The fix for the original bug carries a note
        // quoting the broken line — `applyUploads(up)` — and matching that
        // would make this test fail on the very comment explaining why it
        // exists. Only executable code counts as a call.
        const body = bodyOf(src, m.index ?? 0)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/[^\n]*/g, '');
        if (!body) continue;
        // A CALL, not a mention: a name in a dependency array or passed as a
        // prop is ordinary and must not fire this.
        if (!new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(body)) continue;

        // A genuinely recursive helper is legitimate — a tree walker, a retry
        // loop. It must SAY so just above, so the next reader knows it was
        // meant. The bug that prompted this test had no such marker.
        const line = src.slice(0, m.index ?? 0).split('\n').length;
        const prior = src
          .split('\n')
          .slice(Math.max(0, line - 5), line)
          .join('\n');
        if (/recursi|calls itself on purpose|self-call/i.test(prior)) continue;

        offenders.push(`${file}:${line} — ${name}() calls itself`);
      }
    }

    // Named, not counted: the failure has to say WHICH helper.
    expect(offenders).toEqual([]);
  });
});
