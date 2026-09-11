// Node environment: this spec reads source text off disk and mounts nothing.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE DESK — the tab list and the routes must agree, in both directions.
 *
 * 🚨 A MISMATCH HERE FAILS SILENTLY AND THERE IS NO OTHER GATE FOR IT.
 * `DeskShell`'s `active` prop is typed `string`, and both bars pick the lit tab
 * with `t.key === active`. So a page passing `active="agnet"`, or a tab whose
 * key nobody passes, renders a bar with NO tab lit: no error, no type failure,
 * no build failure, and an operator who can no longer tell which board they are
 * standing on. The Agent tab and the Agent page landed in the same change
 * precisely because of this, and this spec is what stops them drifting apart.
 *
 * ⚠️ THE TAB LIST IS PARSED OUT OF THE SOURCE RATHER THAN IMPORTED, and that
 * is a deliberate trade. tabs.tsx is a 'use client' module that imports
 * next/link, which is not what this suite's node environment is for. The
 * parse is pinned by a count assertion below, so the regex going quiet fails
 * loudly instead of asserting nothing over an empty list — the exact failure
 * mode scripts/desk-cutover.cjs is living with today, where its own regex
 * matches 9 of 29 entries and reports "READY".
 */
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const TABS_SRC = read('components/desk/tabs.tsx');

interface ParsedTab {
  key: string;
  href: string;
}

function deskTabs(): ParsedTab[] {
  const body = TABS_SRC.slice(
    TABS_SRC.indexOf('export const DESK_TABS'),
    TABS_SRC.indexOf('/** Shared arrow-key handling'),
  );
  return [...body.matchAll(/\{\s*key:\s*'([\w-]+)',\s*label:\s*'[^']*',\s*href:\s*'([^']*)'/g)].map(
    (m) => ({ key: m[1], href: m[2] }),
  );
}

/** Every `page.tsx` under app/admin/desk, with the `active=` string it passes. */
function deskPages(): { file: string; active: string | null }[] {
  const out: { file: string; active: string | null }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'page.tsx') continue;
      const src = fs.readFileSync(full, 'utf8');
      const m = src.match(/active="([\w-]+)"/);
      out.push({
        file: path.relative(ROOT, full).replace(/\\/g, '/'),
        active: m ? m[1] : null,
      });
    }
  };
  walk(path.join(ROOT, 'app/admin/desk'));
  return out;
}

describe('the Desk tab list', () => {
  it('parses at all — a passing check over an empty list proves nothing', () => {
    // Six at the time of writing. The floor only has to be high enough that a
    // regex that stopped matching cannot masquerade as a clean run.
    expect(deskTabs().length).toBeGreaterThanOrEqual(6);
  });

  it('every tab leads somewhere that answers', () => {
    /**
     * ⚠️ A page.tsx OR A route.ts, AND THE FIRST VERSION OF THIS CHECKED ONLY
     * THE FIRST — which reported the Ledger tab as a 404. It is not one:
     * app/admin/desk/ledger is a route HANDLER that 307s onto the pile,
     * written that way on purpose because a page calling redirect() under this
     * layout streams the Desk chrome first and answers 200 with the
     * destination buried in the RSC payload. /admin/desk/site is now the same
     * shape for the same reason, so a rule that only knows about pages would
     * call both of them broken.
     */
    const missing = deskTabs().filter((t) => {
      const dir = path.join(ROOT, 'app', t.href);
      return !fs.existsSync(path.join(dir, 'page.tsx')) && !fs.existsSync(path.join(dir, 'route.ts'));
    });
    expect(
      missing.map((t) => `${t.key} -> ${t.href}`),
      'A tab pointing at a route that does not exist is a 404 in the primary navigation.',
    ).toEqual([]);
  });

  it('every board passes an `active` that matches a tab key', () => {
    const keys = new Set(deskTabs().map((t) => t.key));
    const wrong = deskPages().filter((p) => p.active !== null && !keys.has(p.active));
    expect(
      wrong.map((p) => `${p.file} passes active="${p.active}"`),
      'DeskShell types `active` as string and both bars match on equality, so a ' +
        'typo lights no tab at all — silently, with no error anywhere.',
    ).toEqual([]);
  });

  it('the two new tabs are each claimed by a board', () => {
    /**
     * ⚠️ THE OTHER DIRECTION IS NOT ASSERTABLE IN GENERAL, AND THE FIRST
     * VERSION OF THIS TEST FAILED ON EXACTLY THAT. "Every tab key is passed by
     * some page" reports `desk` and `ledger` as orphans, and both are correct:
     * the pile passes `active={activeTabFor(view)}` — a function in
     * lib/desk-pile.ts that returns 'desk' or 'ledger' depending on the lens —
     * and app/admin/desk/ledger/page.tsx is a redirect that renders no shell at
     * all. A literal scan cannot see either. So this pins the narrow claim it
     * can prove: the two keys added with this split have a page passing them,
     * which is the mismatch that was actually at risk.
     */
    const claimed = new Set(deskPages().map((p) => p.active));
    expect([...claimed].sort()).toEqual(expect.arrayContaining(['agent', 'health']));
  });

  it('the board that owns the config gates is the only one passing a site dot', () => {
    // ⚠️ DeskShell's own comment records what happened when this was not
    // true: `site` used to default to `{ tone: 'ok', word: 'Healthy' }` and
    // every surface carried a green dot no probe had produced. The dot is
    // derived from the red-gate count, so exactly one board may pass one.
    const passers = deskPages().filter((p) => /(\n|\s)site=\{/.test(read(p.file)));
    expect(passers.map((p) => p.file)).toEqual(['app/admin/desk/health/page.tsx']);
  });
});

/**
 * THE FOUR WARDEN ROUTES THAT SHIPPED WITH NO CALLER.
 *
 * 🚨 THE API SERVES TEN WARDEN ROUTES AND frontend/ REACHED FOUR. audit, sweep,
 * pause and resume were built, audited and documented, and nothing anywhere
 * called them — while the Site board's "Pause Warden" button posted a chat
 * message the daemon classifies as a question, so it stopped nothing.
 *
 * desk-guard's rule 3 catches a lib/desk-* binding that is imported and never
 * used, which is half of this. It does NOT catch the import and the call being
 * deleted together, which is how a wired feature becomes an unwired one.
 */
describe('the Warden routes are reachable from the Agent board', () => {
  /**
   * ⚠️ COMMENTS ARE STRIPPED BEFORE SCANNING, AND THAT IS NOT TIDINESS — the
   * same rule components/desk/safe-area-clamp.spec.tsx follows, for the same
   * reason. These files are 30-40% comment and this codebase writes the rule
   * out longhand beside the code that obeys it, so the Agent page NAMES the
   * PAUSE_INSTRUCTION hack in prose while not containing it. Scanning raw text
   * fails on the explanation of the rule.
   *
   * ⚠️ A BLOCK COMMENT IS REPLACED BY ITS OWN NEWLINES, NOT BY NOTHING, so a
   * reported line number still points at the right place.
   */
  const strip = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const AGENT = ['page.tsx', 'queue.tsx', 'runs.tsx', 'thread.tsx']
    .map((f) => strip(read(`app/admin/desk/agent/${f}`)))
    .join('\n');

  it.each(['pauseWarden', 'resumeWarden', 'sweepWarden', 'fetchWardenAudit'])(
    '%s is called',
    (fn) => {
      expect(AGENT).toMatch(new RegExp(`\\b${fn}\\(`));
    },
  );

  it('nothing posts a pause as a chat message any more', () => {
    // The replaced hack, by name. PAUSE_INSTRUCTION was a chat string sent
    // through sendWardenChat with a confirm that admitted it did nothing.
    expect(AGENT).not.toContain('PAUSE_INSTRUCTION');
  });

  it('the chat type carries `paused`, which the wire has always sent', () => {
    const lib = read('lib/desk-site.ts');
    expect(lib).toMatch(/paused:\s*WardenPause \| null;/);
    expect(lib).toMatch(/paused:\s*normalisePause\(raw\?\.paused\)/);
  });
});

/**
 * `dropped` AND `truncated` ARE DIFFERENT FACTS WITH DIFFERENT FIXES.
 *
 * Truncated means "there is more, ask for the next page". Dropped means "there
 * is more and neither side of the wire could render it, so go and read the
 * daemon's own store on the box". One is a click; the other is ssh. A badge
 * that adds them together throws away the only half that says which — and an
 * incomplete record of what executed on a production box then looks exactly
 * like a complete one.
 */
describe('the run log keeps dropped separate from truncated', () => {
  const RUNS = read('app/admin/desk/agent/runs.tsx');

  it('renders both', () => {
    expect(RUNS).toMatch(/audit\?\.truncated/);
    expect(RUNS).toMatch(/audit\.dropped > 0/);
  });

  it('never sums them', () => {
    /**
     * ⚠️ THE FIRST VERSION OF THIS REGEX WAS `dropped\s*\+\s*\w*truncated`,
     * AND IT DID NOT BITE. Proved by writing the bug: `audit.dropped +
     * Number(audit.truncated)` is a sum of exactly these two fields and has a
     * call between them, so `\w*` could never span it — the assertion passed
     * over the defect it exists for, and only the companion "renders both"
     * test noticed. Anything on one line between the two names counts now.
     */
    const near = (a: string, b: string) => new RegExp(`${a}[^;\\n]{0,60}\\+[^;\\n]{0,60}${b}`, 'i');
    expect(RUNS).not.toMatch(near('dropped', 'truncated'));
    expect(RUNS).not.toMatch(near('truncated', 'dropped'));
  });
});
