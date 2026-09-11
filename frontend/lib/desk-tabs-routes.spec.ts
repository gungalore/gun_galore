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

/**
 * ⚠️ COMMENTS ARE STRIPPED BEFORE ANY SCAN FOR A LITERAL, AND THIS BRANCH HAS
 * ALREADY PAID FOR FORGETTING IT — scripts/desk-cutover.cjs's own regex counts
 * a literal that appears inside a comment. These files are 30-40% comment and
 * this codebase writes the rule out longhand beside the code that obeys it, so
 * shell.tsx QUOTES the banned default `{ tone: 'ok', word: 'Healthy' }` in the
 * prose explaining why it is banned. A raw scan for that string finds the
 * explanation and fails the file for documenting itself.
 *
 * ⚠️ A BLOCK COMMENT IS REPLACED BY ITS OWN NEWLINES, NOT BY NOTHING, so a
 * reported line number still points at the right place.
 */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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
    /**
     * Four since Phase 8 — Now, People, Health, Agent. The floor only has to
     * be high enough that a regex that stopped matching cannot masquerade as a
     * clean run, so it moves DOWN with the list rather than being deleted.
     *
     * ⚠️ THIS ASSERTION WENT RED ON THE FOUR-TAB COMMIT AND WAS LOWERED IN IT.
     * It read `toBeGreaterThanOrEqual(6)`, and the parse over the new tabs.tsx
     * returns 4: `expected 4 to be greater than or equal to 6`. That is the
     * guard working, not the guard being in the way — the same run over a
     * tabs.tsx whose object literals had changed shape would have returned 0
     * and failed identically.
     */
    expect(deskTabs().length).toBeGreaterThanOrEqual(4);
  });

  it('is exactly the four surfaces, in the order the bars draw them', () => {
    /**
     * ⚠️ THE ORDER IS PART OF THE CLAIM. Both bars map DESK_TABS in array
     * order and the phone bar is muscle memory — an operator reaches for the
     * second cell without reading it. A reorder is a real change and should
     * have to be made here as well as there.
     *
     * ⚠️ AND THE KEYS ARE NOT THE LABELS. `desk` is labelled "Now": the key is
     * a wire value that five pages and `activeTabFor()` in lib/desk-pile.ts
     * pass, so renaming it would light no tab on three of the pile's lenses.
     */
    expect(deskTabs().map((t) => t.key)).toEqual(['desk', 'people', 'health', 'agent']);
  });

  it('every key a board or a helper can pass lights a tab', () => {
    /**
     * 🚨 activeTabFor() RETURNS 'ledger' AND THERE IS NO LEDGER PILL. It is in
     * lib/desk-pile.ts, it answers 'ledger' for the orders, sales and books
     * lenses, and that file is not this track's — so tabs.tsx folds the
     * retired keys onto the surfaces that absorbed them (STANDS_IN_FOR).
     * Without it, three of the pile's six lenses would render a bar with
     * nothing lit: no error, no type failure, exactly the silent mismatch this
     * whole file exists for.
     */
    const keys = new Set(deskTabs().map((t) => t.key));
    const aliases = [...TABS_SRC.slice(
      TABS_SRC.indexOf('const STANDS_IN_FOR'),
      TABS_SRC.indexOf('function litKey'),
    ).matchAll(/(\w+):\s*'([\w-]+)'/g)].map((m) => ({ from: m[1], to: m[2] }));

    expect(aliases.map((a) => a.from)).toContain('ledger');
    expect(aliases.filter((a) => !keys.has(a.to))).toEqual([]);
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
    //
    // ⚠️ SINCE PHASE 8 THE PROP IS AN OVERRIDE RATHER THAN THE SOURCE — the
    // shared poll reads the same gates on every board — but the rule it
    // enforces is unchanged and is why this test is rewritten rather than
    // deleted: a second board passing a dot it computed from something else
    // would be two lights disagreeing about one box.
    const passers = deskPages().filter((p) => /(\n|\s)site=\{/.test(read(p.file)));
    expect(passers.map((p) => p.file)).toEqual(['app/admin/desk/health/page.tsx']);
  });

  it('the shell takes the dot from the shared poll and defaults to nothing', () => {
    /**
     * 🚨 THE ONE THING THAT MUST NEVER COME BACK IS A FALLBACK. `site` used to
     * default to `{ tone: 'ok', word: 'Healthy' }`, which is a green light
     * wired to nothing — it reads OK straight through an outage. The provider
     * makes that failure easier to reintroduce, not harder, because now there
     * IS something to fall back to, so the rule is pinned in three parts: the
     * shell reads the provider, a page's own value wins over it, and no
     * literal tone is written in the shell at all.
     */
    const shell = strip(read('components/desk/shell.tsx'));
    expect(shell).toMatch(/useDeskStatus\(\)/);
    expect(shell).toMatch(/const dot = site \?\? status\.dot/);
    expect(shell).not.toMatch(/word:\s*'Healthy'/);
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
   * ⚠️ COMMENTS ARE STRIPPED BEFORE SCANNING (see `strip` at the top of this
   * file), AND THAT IS NOT TIDINESS — the same rule
   * components/desk/safe-area-clamp.spec.tsx follows, for the same reason. The
   * Agent page NAMES the PAUSE_INSTRUCTION hack in prose while not containing
   * it, so scanning raw text fails on the explanation of the rule.
   */
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
