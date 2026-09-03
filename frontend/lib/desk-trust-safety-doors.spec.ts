import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RejectionRow,
  RepeatOffenderRow,
  ReportedListingRow,
  ReportedQuestionRow,
  ReportedSellerRow,
} from './desk-site';

// ────────────────────────────────────────────────────────────────────
// TRUST AND SAFETY: THE REPORTS MUST STAY CONNECTED TO THE DECISIONS.
//
// 🚨 THE BUG CLASS THIS PROJECT KEEPS HITTING IS "BUILT BUT NEVER
// CONNECTED" — a card type nothing emits, a drawer nothing opens. This
// section was the worst instance of it, because what it lost was a safety
// control rather than a convenience.
//
// Every row on the legacy /admin/trust-safety page was a link: offenders,
// reported sellers and the rejecting user to /admin/users/[id]; reported
// listings and reported questions to /admin/listings/[id]. It was a queue
// you worked FROM. The Desk rebuilt all five feeds as text, so it became a
// page you could only read — a member could be reported for a LIVE listing
// and there was no route anywhere on the Desk to open it, let alone take it
// down. Both drawers already existed and both already handled the case; the
// wiring was simply absent, and absent wiring is invisible to tsc, to the
// unit suite and to a clean production build.
//
// So it is asserted on the source, which is where it is visible. Two halves,
// and BOTH are needed: the type half catches the wire shape drifting out
// from under a door (no `listing.id` on the row means the door opens on
// undefined), and the source half catches the door being dropped.
// ────────────────────────────────────────────────────────────────────

const PAGE = readFileSync(join(process.cwd(), 'app/admin/desk/site/page.tsx'), 'utf8');

/**
 * The Trust and Safety component only — not the other ~20 cards on Site.
 *
 * ⚠️ BOUNDED BY BRACE MATCHING, NOT BY "THE NEXT TOP-LEVEL DECLARATION".
 * The first version of this scanned forward for `\n(function|const|/** )`
 * and over-ran the end of the function, swallowing the next component's doc
 * comment — so an assertion could have been satisfied by text belonging to
 * a different component entirely. Counting braces from the opening one is
 * exact, and it fails loudly rather than silently returning too much.
 */
function trustSafetySource(): string {
  const start = PAGE.indexOf('function TrustSafety()');
  expect(start, 'TrustSafety component not found — was it renamed?').toBeGreaterThan(-1);
  const open = PAGE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < PAGE.length; i += 1) {
    if (PAGE[i] === '{') depth += 1;
    else if (PAGE[i] === '}') {
      depth -= 1;
      if (depth === 0) return PAGE.slice(start, i + 1);
    }
  }
  throw new Error('TrustSafety braces never balanced — the scan would be meaningless');
}

describe('the ids the doors are built on are still on the wire', () => {
  // Compile-checked: if the backend drops a field and desk-site.ts follows,
  // these stop type-checking and tsc fails before any test runs.
  it('a reported listing carries the listing id the Listing drawer opens on', () => {
    const row: ReportedListingRow = {
      id: 'rep_1',
      reason: 'counterfeit',
      createdAt: '2026-09-03T00:00:00.000Z',
      listing: { id: 'lst_1', title: 'A rifle' },
    };
    expect(row.listing?.id).toBe('lst_1');
  });

  it('a reported question carries its listing id', () => {
    const row: ReportedQuestionRow = {
      id: 'q_1',
      question: 'is this stolen',
      reportedCount: 3,
      status: 'PENDING_REVIEW',
      createdAt: '2026-09-03T00:00:00.000Z',
      listing: { id: 'lst_2', title: 'A scope' },
      asker: { username: 'boet' },
    };
    expect(row.listing.id).toBe('lst_2');
  });

  it('a reported seller and a repeat offender carry a user id', () => {
    const seller: ReportedSellerRow = {
      id: 'rep_2',
      reason: 'no delivery',
      createdAt: '2026-09-03T00:00:00.000Z',
      seller: { id: 'usr_1', username: 'boet' },
    };
    const offender: RepeatOffenderRow = {
      userId: 'usr_2',
      username: 'boet',
      rejectionCount: 4,
      lastRejectionAt: '2026-09-03T00:00:00.000Z',
    };
    expect(seller.seller?.id).toBe('usr_1');
    expect(offender.userId).toBe('usr_2');
  });

  it('a contact block carries a user id, and tolerates not having one', () => {
    // ⚠️ NULL IS A REAL STATE, NOT A DEFECT: the contact filter runs on
    // anonymous traffic, so this row legitimately has nobody to open.
    const signedOut: RejectionRow = {
      id: 'rej_1',
      channel: 'message',
      category: 'phone-number',
      sampleText: '082…',
      createdAt: '2026-09-03T00:00:00.000Z',
      user: null,
    };
    expect(signedOut.user).toBeNull();
  });

  it('🚨 the asker of a reported question has NO id, so it must have no door', () => {
    // This is the one place a door would be a lie. The row type carries the
    // asker's username only; opening a Member drawer would need a cuid that
    // never came over the wire. If an id is ever added here, this test fails
    // and the door becomes worth building — that is the point of pinning it.
    const asker: ReportedQuestionRow['asker'] = { username: 'boet' };
    expect(Object.keys(asker)).toEqual(['username']);
  });
});

describe('every feed that can open something does', () => {
  const src = trustSafetySource();

  it('mounts both drawers', () => {
    // ⚠️ MATCH THE ELEMENT BOUNDARY, NOT A SUBSTRING. `toContain('<ListingDrawer')`
    // is satisfied by `<ListingDrawerXX`, which is exactly how this test was
    // caught not biting: the mount was renamed out of existence and the
    // assertion still passed. The trailing \s pins a real JSX tag.
    expect(src).toMatch(/<ListingDrawer\s/);
    expect(src).toMatch(/<MemberDrawer\s/);
  });

  it('opens the Member drawer from the three feeds that carry a user id', () => {
    // offender, reported seller, rejecting user.
    const opens = src.match(/setOpenMemberId\(/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(3);
  });

  it('opens the Listing drawer from the two feeds that carry a listing id', () => {
    // reported listing, and the listing a reported question was asked on.
    const opens = src.match(/setOpenListingId\(/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(2);
  });

  it('reloads the feeds after either drawer acts', () => {
    // A listing taken down or a member banned should stop being the top of
    // the queue. Both drawer callbacks must refresh.
    // No /s flag: `[^}]` already crosses newlines, and dotAll is not
    // available at this tsconfig target (TS1501).
    expect(src).toMatch(/onDecided=\{[^}]*load\(\)/);
    expect(src).toMatch(/onChanged=\{[^}]*load\(\)/);
  });

  it('a subject that has since been deleted renders no door', () => {
    // `undefined` for onOpen is what makes OpenName fall back to a plain
    // span. Passing a handler that dereferences a null subject would both
    // crash and, worse, make a dead row look actionable.
    expect(src).toContain('r.listing ? () => setOpenListingId');
    expect(src).toContain('r.seller ? () => setOpenMemberId');
    expect(src).toContain('r.user ? () => setOpenMemberId');
  });

  it('🚨 no subject name is left as a bare styled span', () => {
    // The regression shape: someone edits a row and reverts its name to the
    // span it used to be. Every name slot in this section is 12.5px ink; if
    // one appears with flex:1 and no OpenName around it, a feed has gone
    // back to being unclickable.
    const bareNameSlots =
      src.match(/<span style=\{\{ fontSize: 12\.5, color: 'var\(--dk-ink\)', minWidth: 0, flex: 1 \}\}>/g) ??
      [];
    expect(bareNameSlots).toHaveLength(0);
  });
});

describe('the copy tells the truth about what the section now does', () => {
  const src = trustSafetySource();

  it('no longer calls itself read-only', () => {
    // It said: "Read-only. Warning, banning and removing all happen where
    // the person or the listing is." That was accurate and is now false.
    expect(src).not.toMatch(/footer="Read-only\./);
  });

  it('says a name that does not open is a deleted subject, not a broken link', () => {
    expect(src).toMatch(/footer="[^"]*deleted/);
  });
});
