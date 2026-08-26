import * as fs from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import {
  ACCOUNT_CLOSED_MESSAGE,
  assertAccountNotClosed,
  isAccountClosed,
} from './account-standing';

describe('account-standing helper', () => {
  it('lets an open account through', () => {
    expect(() => assertAccountNotClosed({ accountClosedAt: null })).not.toThrow();
    expect(isAccountClosed({ accountClosedAt: null })).toBe(false);
    expect(isAccountClosed(null)).toBe(false);
  });

  it('refuses a closed account with a 403', () => {
    expect(() =>
      assertAccountNotClosed({ accountClosedAt: new Date() }),
    ).toThrow(ForbiddenException);
    expect(isAccountClosed({ accountClosedAt: new Date() })).toBe(true);
  });

  // ⚠️ THE WHOLE POINT OF A SEPARATE MESSAGE. A member who closed their own
  // account and came back to a stale tab must never be told they were
  // suspended or banned — we would be accusing them of something over an
  // action they took themselves, and that wording outlives the tab in their
  // screenshot and in the support ticket.
  it('never uses the ban vocabulary', () => {
    expect(ACCOUNT_CLOSED_MESSAGE).toMatch(/has been closed/);
    expect(ACCOUNT_CLOSED_MESSAGE).not.toMatch(/suspend|ban|restrict/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// EVERY BAN GATE ALSO REFUSES A CLOSED ACCOUNT.
//
// ⚠️ THIS IS A SOURCE SWEEP, NOT A UNIT TEST, AND THAT IS DELIBERATE — the
// same reasoning as api-route-contract.spec.ts. There are six of these gates
// across four services (listings ×3, auctions, offers, transactions), they are
// one line each, and nothing in the compiler connects `if (user.isBanned)
// throw` to "…and closed too". The failure mode is not that today's gates are
// wrong; it is that the seventh gate gets added six months from now, next to
// an `isBanned` line that was copied from one of these, and a closed account
// silently keeps trading.
//
// It was ELEVEN gates across seven services until 2026-08-26, when Swop,
// Featured slots, the PRO subscription and Hunting Packages were removed and
// took their five gates with them. The floor below moved 11 → 6 for that
// reason and no other: the companion test — that every gate found is preceded
// by assertAccountNotClosed — kept passing throughout, so no surviving gate
// was touched. If this floor ever needs lowering again, check that the same
// companion test is still green before you believe the drop is benign.
// ────────────────────────────────────────────────────────────────────

/** Every .ts under src/, minus the tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('write gates: banned implies closed is checked too', () => {
  const src = path.join(__dirname, '..');
  // `if (<var>.isBanned) throw …` — the simple refuse-outright gate. The
  // compound eligibility filters (`!bidder || bidder.isBanned || …`) are a
  // different shape and are covered by their own service tests.
  const GATE = /^[ \t]*if \((\w+)\.isBanned\)[ \t]*throw\b/;

  const gates: { file: string; line: number; varName: string; prev: string }[] =
    [];
  for (const file of sourceFiles(src)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      const m = GATE.exec(text);
      if (!m) return;
      // Walk back past comment lines to the previous statement.
      let j = i - 1;
      while (j >= 0 && /^[ \t]*(\/\/|\/\*|\*)/.test(lines[j])) j--;
      gates.push({
        file: path.relative(src, file).replace(/\\/g, '/'),
        line: i + 1,
        varName: m[1],
        prev: (lines[j] ?? '').trim(),
      });
    });
  }

  it('finds the gates at all (the regex has not gone stale)', () => {
    expect(gates.length).toBeGreaterThanOrEqual(6);
  });

  it.each(
    gates.map((g) => [`${g.file}:${g.line}`, g] as const),
  )('%s is preceded by assertAccountNotClosed', (_label, g) => {
    expect(g.prev).toBe(`assertAccountNotClosed(${g.varName});`);
  });
});
