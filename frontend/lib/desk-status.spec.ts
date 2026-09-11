import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE DESK — the chrome's counts, and the three states they can be in.
 *
 * 🚨 A BADGE IS A CLAIM, AND THE CLAIM THAT MATTERS IS THE ONE NOBODY MEANT TO
 * MAKE. "0 red gates" and "I could not read the gates" are acted on
 * differently — one means stand down and the other means go and look — so
 * every function here keeps `number` and `null` apart, and mergeCounts keeps a
 * THIRD state (an arm absent from the sweep) apart from both. This suite is
 * where those three are pinned, because the provider that uses them is a React
 * component and nothing under components/ is collected as a `.spec.ts`.
 */
import {
  NOTHING_READ,
  gatesReading,
  mergeCounts,
  pendingProposals,
  pileCounts,
  redGateCount,
  statusDot,
} from './desk-status';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

/**
 * ⚠️ THE FUNCTIONS BEING RIGHT IS HALF OF IT — the other half is which value
 * gets handed to which one, and that wiring lives in a 'use client' component
 * this node suite cannot mount. So the provider is read as TEXT, the way
 * lib/desk-tabs-routes.spec.ts reads the shell, for the same reason and with
 * the same rule attached:
 *
 * 🚨 COMMENTS ARE STRIPPED FIRST. The narrow truth, because the wider one was
 * tempting and is false: no comment in either scanned file matches any pattern
 * below TODAY — the negative pattern was run against the unstripped source and
 * finds nothing. The strip is here because the provider's comment already says
 * "`gates`, NOT `counts.redGates`", a few characters short of the literal this
 * spec forbids, so the first person to write that rule out in full fails the
 * file for documenting itself. lib/desk-tabs-routes.spec.ts is not being
 * cautious about that — it is living it: shell.tsx quotes the banned green
 * default inside the prose explaining why it is banned.
 */
const ROOT = path.resolve(__dirname, '..');
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const readSource = (rel: string) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

describe('the pile count', () => {
  it('counts cards, and takes overdue from the pile block', () => {
    expect(
      pileCounts({ cards: [{}, {}, {}] as never, pile: { overdue: 2, sunk: 9 } }),
    ).toEqual({ now: 3, overdue: 2 });
  });

  it('reads the same array the board prints its sub-line from', () => {
    // app/admin/desk/page.tsx renders `${visible.length} things need you` off
    // feed.cards. A badge computed from the band totals instead would differ
    // the moment the server caps a band, and the two numbers sit inches apart.
    expect(pileCounts({ cards: [] as never, pile: { overdue: 0, sunk: 0 } }).now).toBe(0);
  });
});

describe('red gates', () => {
  it('counts only the bad ones', () => {
    expect(
      redGateCount({ gates: [{ tone: 'bad' }, { tone: 'warn' }, { tone: 'ok' }, { tone: 'bad' }] }),
    ).toBe(2);
  });

  it('a board with no bad gate is a real zero, not a silence', () => {
    expect(redGateCount({ gates: [{ tone: 'ok' }] })).toBe(0);
  });
});

describe('Warden proposals', () => {
  it('counts the pending ones only', () => {
    expect(
      pendingProposals({
        present: true,
        proposals: [
          { status: 'pending' },
          { status: 'approved' },
          { status: 'pending' },
          { status: 'declined' },
        ] as never,
      }),
    ).toBe(2);
  });

  it('an absent daemon is null, never zero', () => {
    /**
     * 🚨 THE EMPTY ARRAY IS NOT AN ANSWER WHEN `present` IS FALSE. It is empty
     * because nothing was READ — lib/desk-site.ts's comment on `absence`
     * records the approval queue saying "nothing is waiting on you" about a
     * list it never saw. A badge is the same sentence in one character.
     */
    expect(pendingProposals({ present: false, proposals: [] })).toBeNull();
  });

  it('a live daemon with an empty queue IS a zero', () => {
    expect(pendingProposals({ present: true, proposals: [] })).toBe(0);
  });
});

describe('the header dot', () => {
  it('draws nothing at all before anything has been read', () => {
    // The rule DeskShellProps.site records: a status light wired to nothing is
    // worse than no light, because it reads OK through an outage.
    expect(statusDot(undefined)).toBeUndefined();
  });

  it('says so in words when the read asked for the gates and did not get them', () => {
    expect(statusDot(null)).toEqual({ tone: 'unknown', word: 'Not read' });
  });

  it('is green only for a measured zero', () => {
    expect(statusDot(0)).toEqual({ tone: 'ok', word: 'Healthy' });
    expect(statusDot(3)).toEqual({ tone: 'bad', word: 'Attention' });
  });
});

describe("the gates arm's own answer, sweep by sweep", () => {
  it('is the count when the arm answered', () => {
    expect(gatesReading({ counts: { redGates: 2 }, failed: [] })).toBe(2);
    expect(gatesReading({ counts: { redGates: 0 }, failed: [] })).toBe(0);
  });

  it('is null when the arm did not answer, even though the key is merely absent', () => {
    /**
     * ⚠️ THE ONE PLACE ABSENT COLLAPSES INTO null. Everywhere else in this
     * module the third state means "keep what you had"; the dot has nothing to
     * keep, because it is being asked about THIS read.
     */
    expect(gatesReading({ counts: { now: 4, overdue: 0 }, failed: ['gates'] })).toBeNull();
  });
});

describe('a green dot cannot outlive the read that produced it', () => {
  /**
   * 🚨 THIS IS THE BUG, AND IT SURVIVED TWO REVIEWS BECAUSE EVERY PART OF IT
   * LOOKED CORRECT ON ITS OWN. The dot was fed the MERGED red-gate count plus
   * a flag meaning "some sweep has run at some point". mergeCounts holds a
   * count whose arm went quiet — deliberately, and it still does — and the
   * flag latched true on the first sweep and never fell. So the gates endpoint
   * could return 500 to every request for an afternoon and the header kept
   * printing "Healthy" off a number measured before lunch, on all six boards.
   * Green means stand down.
   *
   * The fix is not to stop holding the count. It is that a COUNT and a VERDICT
   * decay differently: "3 was the last figure read" stays true as it ages,
   * "this box is healthy" does not. So the badge keeps the old number and the
   * dot refuses to, and the two are allowed to contradict each other on
   * screen — which is the honest reading of the situation.
   */
  const FIRST = { counts: { now: 7, overdue: 0, redGates: 0, proposals: 1 }, failed: [] };
  const GATES_DOWN = { counts: { now: 7, overdue: 0, proposals: 1 }, failed: ['gates'] };

  it('holds the count and drops the verdict when the gates stop answering', () => {
    const held = mergeCounts(NOTHING_READ, FIRST.counts);
    expect(statusDot(gatesReading(FIRST))).toEqual({ tone: 'ok', word: 'Healthy' });

    const stillHeld = mergeCounts(held, GATES_DOWN.counts);
    // The badge is entitled to the last figure anyone read…
    expect(stillHeld.redGates).toBe(0);
    // …and the dot is not entitled to the last health anyone read.
    expect(statusDot(gatesReading(GATES_DOWN))).toEqual({ tone: 'unknown', word: 'Not read' });
  });

  it('stays unknown however long the outage lasts', () => {
    // The latched flag made the SECOND failure indistinguishable from the
    // fiftieth. Ten sweeps of nothing is still nothing.
    let counts = mergeCounts(NOTHING_READ, FIRST.counts);
    for (let i = 0; i < 10; i += 1) {
      counts = mergeCounts(counts, GATES_DOWN.counts);
      expect(statusDot(gatesReading(GATES_DOWN))).toEqual({ tone: 'unknown', word: 'Not read' });
    }
    expect(counts.redGates).toBe(0);
  });

  it('goes green again the moment a read answers zero', () => {
    // And it must actually recover — a dot stuck on "Not read" after the
    // endpoint comes back is the same failure pointing the other way.
    expect(statusDot(gatesReading({ counts: { redGates: 0 }, failed: [] }))).toEqual({
      tone: 'ok',
      word: 'Healthy',
    });
  });
});

describe('folding a sweep over what is already on screen', () => {
  const HELD = { now: 7, overdue: 2, redGates: 1, proposals: 4 };

  it('keeps a count whose arm did not answer', () => {
    /**
     * ⚠️ THIS IS THE INSTRUCTION THE PROVIDER WAS BUILT TO. A poll that errors
     * must leave the tabs carrying their last known counts rather than
     * dropping to silence, because silence reads as an all-clear and an
     * all-clear is the one answer nobody should be given by accident.
     */
    expect(mergeCounts(HELD, { redGates: 0 })).toEqual({
      now: 7,
      overdue: 2,
      redGates: 0,
      proposals: 4,
    });
  });

  it('an explicit null DOES overwrite — it is an answer, not a silence', () => {
    // Warden went away between sweeps. Holding the old 4 would print a figure
    // from before the daemon stopped answering.
    expect(mergeCounts(HELD, { proposals: null }).proposals).toBeNull();
  });

  it('an empty sweep changes nothing', () => {
    expect(mergeCounts(HELD, {})).toEqual(HELD);
  });

  it('starts from nothing read, not from zero', () => {
    expect(NOTHING_READ).toEqual({ now: null, overdue: null, redGates: null, proposals: null });
  });
});

describe('what the provider actually hands the dot', () => {
  /**
   * 🚨 REVERTING THE WIRING IS A ONE-WORD EDIT AND EVERY UNIT TEST ABOVE STAYS
   * GREEN THROUGH IT. statusDot(counts.redGates) type-checks, renders, and is
   * wrong — it is the exact line that shipped the green dot through the
   * outage. The functions cannot catch it because the mistake is not inside
   * one of them; it is which value crosses between them.
   *
   * ⚠️ WHAT THIS DOES NOT CATCH, stated rather than implied: it pins the call
   * and the state that feeds it, not that the state is set once per sweep, and
   * a source scan can be satisfied by text that never runs. It is a tripwire
   * on a known revert, not a proof of behaviour. The proof would be mounting
   * the provider, which needs a jsdom `.spec.tsx` beside it.
   */
  const PROVIDER = 'components/desk/desk-status.tsx';

  it('gives the dot the sweep-by-sweep reading and not the merged count', () => {
    const src = readSource(PROVIDER);
    expect(src).toMatch(/setGates\(gatesReading\(read\)\)/);
    expect(src).toMatch(/dot:\s*statusDot\(gates\)/);
    // The revert, named so the failure says what went wrong.
    expect(src).not.toMatch(/statusDot\(counts\.redGates/);
  });

  it('the merged counts still feed the badges, which is the part that is allowed to be old', () => {
    expect(readSource(PROVIDER)).toMatch(/setCounts\(\(prev\) => mergeCounts\(prev, read\.counts\)\)/);
  });

  it('Health hands the shell its own reading and withholds it on a failure', () => {
    /**
     * ⚠️ THE OVERRIDE IS THE DANGEROUS DIRECTION. DeskShell prefers a board's
     * `site` over the shared sweep, so a board that passes a verdict it cannot
     * stand behind does not merely mislead — it SUPPRESSES a live reading.
     * `ownVerdict` is undefined whenever this board's own read failed, and
     * statusDot(undefined) is undefined, which hands the dot back to the poll.
     */
    const src = readSource('app/admin/desk/health/page.tsx');
    expect(src).toMatch(/const ownVerdict = error !== null \|\| redGates === null \? undefined : redGates/);
    expect(src).toMatch(/site=\{statusDot\(ownVerdict\)\}/);
    // And it re-reads, or the value it passes is frozen at mount and beats a
    // poll that is not.
    expect(src).toMatch(/setInterval\(\(\) => void load\(\), BOARD_RELOAD_MS\)/);
    expect(src).toMatch(/addEventListener\('focus', onFocus\)/);
  });
});

describe('one sweep, three independent failures', () => {
  /**
   * 🚨 allSettled, NEVER Promise.all. `all` rejects on the first failure and
   * discards the answers that arrived, so a Warden that is merely not deployed
   * would take the pile count and the gate count down with it — on every
   * board, for as long as it stayed down.
   */
  async function sweepWith(feed: unknown, gates: unknown, chat: unknown) {
    vi.resetModules();
    vi.doMock('./desk-feed', () => ({
      fetchDeskFeed: () => (feed instanceof Error ? Promise.reject(feed) : Promise.resolve(feed)),
    }));
    vi.doMock('./desk-site', () => ({
      fetchWardenChat: () => (chat instanceof Error ? Promise.reject(chat) : Promise.resolve(chat)),
    }));
    vi.doMock('./desk-auth', () => ({
      deskFetch: () => (gates instanceof Error ? Promise.reject(gates) : Promise.resolve(gates)),
    }));
    const mod = await import('./desk-status');
    return mod.readDeskStatus();
  }

  const FEED = { cards: [{}, {}], pile: { overdue: 1 } };
  const GATES = { gates: [{ tone: 'bad' }] };
  const CHAT = { present: true, proposals: [{ status: 'pending' }] };

  it('reports every arm on a clean sweep', async () => {
    const out = await sweepWith(FEED, GATES, CHAT);
    expect(out.failed).toEqual([]);
    expect(out.counts).toEqual({ now: 2, overdue: 1, redGates: 1, proposals: 1 });
  });

  it('a dead Warden costs the Warden count and nothing else', async () => {
    const out = await sweepWith(FEED, GATES, new Error('ECONNREFUSED'));
    expect(out.failed).toEqual(['warden']);
    // ⚠️ ABSENT, not null and not zero. An arm that threw has no answer, so
    // mergeCounts leaves whatever the tab was already showing.
    expect('proposals' in out.counts).toBe(false);
    expect(out.counts.now).toBe(2);
    expect(out.counts.redGates).toBe(1);
  });

  it('a dead feed costs the pile count and nothing else', async () => {
    const out = await sweepWith(new Error('500'), GATES, CHAT);
    expect(out.failed).toEqual(['pile']);
    expect('now' in out.counts).toBe(false);
    expect('overdue' in out.counts).toBe(false);
    expect(out.counts.redGates).toBe(1);
    expect(out.counts.proposals).toBe(1);
  });

  it('everything down reports everything down and claims no figure', async () => {
    const out = await sweepWith(new Error('a'), new Error('b'), new Error('c'));
    expect(out.failed).toEqual(['pile', 'gates', 'warden']);
    expect(out.counts).toEqual({});
  });
});
