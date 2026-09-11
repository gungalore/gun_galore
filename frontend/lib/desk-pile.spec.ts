import { describe, it, expect } from 'vitest';
import {
  NOW_VIEWS,
  NOW_VIEW_LABEL,
  activeTabFor,
  drawerTargetFor,
  entityIdOf,
  feedFailure,
  ledgerRedirect,
  linkHrefFor,
  parseNowView,
  pileKeysSuspended,
} from './desk-pile';
import type { DeskCardData } from './desk-feed';

/**
 * THE DESK — the Now board's decisions, pinned.
 *
 * Every assertion below was watched go RED before it was left green: the bug
 * it names was reintroduced in lib/desk-pile.ts, `npx vitest run
 * lib/desk-pile.spec.ts` was run, the named case failed, and the file was
 * restored. A spec that has only ever been green is a claim about the code,
 * not a check on it — and two specs on this branch already passed on the exact
 * bug they were written for.
 */

function card(over: Partial<DeskCardData> & Pick<DeskCardData, 'id' | 'type'>): DeskCardData {
  return {
    typeLabel: 'Card',
    band: 'money_firearms',
    headline: 'A headline',
    tags: [],
    actions: [],
    canLater: true,
    ...over,
  } as DeskCardData;
}

describe('entityIdOf', () => {
  it('strips the card type, not everything up to the first colon', () => {
    // The failure this guards: `card.id.split(':')[1]` on an entity id that
    // itself contains a colon hands the drawer half an id, and the 404 reads
    // as a missing record rather than a parsing bug.
    expect(entityIdOf({ id: 'dispute:tx_ab:cd', type: 'dispute' })).toBe('tx_ab:cd');
  });

  it('leaves an id that carries no type prefix alone', () => {
    expect(entityIdOf({ id: 'bare-id', type: 'dispute' })).toBe('bare-id');
  });
});

describe('drawerTargetFor', () => {
  it('opens the Order drawer on the ENTITY half for the three Transaction cards', () => {
    // The failure this guards: passing `card.id` through instead of the entity
    // half opens OrderDrawer on "firearm_transfer:tx_1", which 404s.
    for (const type of ['firearm_transfer', 'dispute', 'dispatch_check'] as const) {
      expect(drawerTargetFor(card({ id: `${type}:tx_1`, type }))).toEqual({
        sort: 'order',
        transactionId: 'tx_1',
      });
    }
  });

  it('opens the run drawer for payout_run, which carries no entity id at all', () => {
    // `payout_run:today` is synthesised from moneySnapshot(); "today" is a
    // literal. Any target carrying an id would be carrying that word.
    const t = drawerTargetFor(card({ id: 'payout_run:today', type: 'payout_run' }));
    expect(t).toEqual({ sort: 'payout-run' });
    expect(JSON.stringify(t)).not.toContain('today');
  });

  it('passes the whole card id for a stale listing, not a rebuilt listing_review one', () => {
    // dropCard matches on the exact id; a rebuilt `listing_review:<id>` no-ops
    // and leaves a taken-down listing sitting on the pile.
    const t = drawerTargetFor(card({ id: 'stale_listing:l_9', type: 'stale_listing' }));
    expect(t).toMatchObject({ sort: 'listing', listingId: 'l_9', cardId: 'stale_listing:l_9' });
  });

  it('still returns null for the types with no drawer, so the caller can say so', () => {
    expect(drawerTargetFor(card({ id: 'warden:disk-low', type: 'warden' }))).toBeNull();
    expect(
      drawerTargetFor(card({ id: 'unanswered_question:q_1', type: 'unanswered_question' })),
    ).toBeNull();
  });
});

describe('pileKeysSuspended', () => {
  it('sleeps in a register lens — the cursor is always a pile card', () => {
    expect(pileKeysSuspended({ view: 'orders', stackDepth: 0 })).toBe(true);
    expect(pileKeysSuspended({ view: 'cases', stackDepth: 0 })).toBe(true);
  });

  it('sleeps while any drawer is open', () => {
    expect(pileKeysSuspended({ view: 'today', stackDepth: 1 })).toBe(true);
  });

  it('is awake on the pile with nothing over it', () => {
    expect(pileKeysSuspended({ view: 'today', stackDepth: 0 })).toBe(false);
  });
});

describe('parseNowView / activeTabFor', () => {
  it('falls back to the pile for anything unrecognised', () => {
    expect(parseNowView(null)).toBe('today');
    expect(parseNowView('run')).toBe('today');
    expect(parseNowView('orders')).toBe('orders');
  });

  it('lights the Ledger tab on the three money lenses and Desk everywhere else', () => {
    expect(activeTabFor('orders')).toBe('ledger');
    expect(activeTabFor('sales')).toBe('ledger');
    expect(activeTabFor('books')).toBe('ledger');
    expect(activeTabFor('today')).toBe('desk');
    expect(activeTabFor('cases')).toBe('desk');
  });
});

describe('linkHrefFor', () => {
  /**
   * The failure this guards: /admin/desk/site is a 307 onto /admin/desk/health
   * (app/admin/desk/site/route.ts), Health kept the gates and the vitals, and
   * the chat and the approval queue are app/admin/desk/agent — thread.tsx and
   * queue.tsx. The server mints the retired path on all three Warden faces, so
   * Enter on a proposal, its "Open the chat" button and the "Approve the fix…"
   * fallthrough all landed on a board with no composer and no Approve on it.
   */
  const warden = { type: 'warden' } as Pick<DeskCardData, 'type'>;

  it('sends a Warden card to the surface that actually has the chat and the queue', () => {
    expect(linkHrefFor(warden, '/admin/desk/site')).toBe('/admin/desk/agent');
  });

  it('never lets the retired path survive on a Warden card', () => {
    // The narrow assertion the one above cannot make: whatever the rewrite
    // produces, it is not the board that no longer exists.
    expect(linkHrefFor(warden, '/admin/desk/site')).not.toContain('/admin/desk/site');
  });

  it('carries a query string and a hash across rather than dropping them', () => {
    // The redirect this replaces passes nextUrl.search whole because deep
    // links onto that surface are live; a rewrite that dropped them would land
    // the operator on the right board with the drawer shut, which looks like
    // the drawer being broken.
    expect(linkHrefFor(warden, '/admin/desk/site?whatsapp=t_1')).toBe(
      '/admin/desk/agent?whatsapp=t_1',
    );
    expect(linkHrefFor(warden, '/admin/desk/site#queue')).toBe('/admin/desk/agent#queue');
  });

  it('leaves the same path alone on a card that is not Warden', () => {
    // /admin/desk/site is also a health bookmark and the Desk manifest's "Site
    // health" shortcut, and those genuinely mean Health — which is what the
    // 307 gives them. Only a Warden card's link is about the chat.
    expect(linkHrefFor({ type: 'dispute' }, '/admin/desk/site')).toBe('/admin/desk/site');
  });

  it('leaves every other href alone, including on a Warden card', () => {
    expect(linkHrefFor(warden, '/admin/desk/health')).toBe('/admin/desk/health');
    expect(linkHrefFor(warden, 'https://example.com/admin/desk/site')).toBe(
      'https://example.com/admin/desk/site',
    );
  });
});

describe('feedFailure', () => {
  it('names the register it did NOT break, by the word on that register’s own chip', () => {
    // The failure this guards: a red box above a list, with nothing saying
    // whether the list is suspect too. Every register owns its own fetch and
    // its own FailedRegion, so a dead feed leaves it correct.
    for (const view of NOW_VIEWS) {
      if (view === 'today') continue;
      const note = feedFailure({ view, stale: false }).scopeNote;
      expect(note).toContain(NOW_VIEW_LABEL[view]);
      expect(note).toContain('unaffected');
    }
  });

  it('claims nothing about a register on the pile lens, where there is none', () => {
    const note = feedFailure({ view: 'today', stale: false }).scopeNote;
    expect(note).not.toContain('register');
    expect(note).not.toContain('unaffected');
  });

  it('says the figures are stale when they are still on screen, and missing when they are not', () => {
    // The two states are different claims. A region saying "missing" over four
    // visible figures teaches the operator to disbelieve the region; one
    // saying "last good read" over an empty row teaches them to disbelieve the
    // board.
    const stale = feedFailure({ view: 'today', stale: true });
    const gone = feedFailure({ view: 'today', stale: false });
    expect(stale.scopeNote).toContain('last good read');
    expect(gone.scopeNote).not.toContain('last good read');
    expect(stale.title).not.toBe(gone.title);
  });

  it('keeps the sibling promise in the stale state too', () => {
    const note = feedFailure({ view: 'books', stale: true }).scopeNote;
    expect(note).toContain('Books');
    expect(note).toContain('unaffected');
  });

  it('says the money line is what went, on a lens where the cards are not on screen', () => {
    // "today's cards" is a true thing to lose on the pile and a confusing one
    // to name on Orders, where no card is rendered at all.
    expect(feedFailure({ view: 'orders', stale: false }).title).toContain('money line');
    expect(feedFailure({ view: 'today', stale: false }).scopeNote).toContain('cards');
  });
});

describe('NOW_VIEW_LABEL', () => {
  it('carries a word for every lens, so no chip and no failure region is blank', () => {
    // app/admin/desk/page.tsx builds its chips from this map. A lens added to
    // NOW_VIEWS without a label would draw an empty chip and a failure region
    // promising that "the  register below" is fine.
    for (const view of NOW_VIEWS) {
      expect(NOW_VIEW_LABEL[view]).toBeTruthy();
    }
  });
});

describe('ledgerRedirect', () => {
  it('keeps ?txn= without switching lens — a single sale is not a cart', () => {
    expect(ledgerRedirect('?txn=tx_7')).toBe('/admin/desk?txn=tx_7');
  });

  it('keeps ?order= and switches to the orders lens', () => {
    expect(ledgerRedirect('?order=o_3')).toBe('/admin/desk?view=orders&order=o_3');
  });

  it('carries the legacy /admin/orders status and page names through verbatim', () => {
    // These two are why the redirect exists: dropping them lands an operator
    // on an unfiltered page one that looks like it worked.
    expect(ledgerRedirect('?view=orders&status=PAID&page=3')).toBe(
      '/admin/desk?view=orders&status=PAID&page=3',
    );
  });

  it('keeps the health board filter and forces the sales lens', () => {
    expect(ledgerRedirect('?status=HELD&filter=dispatch-overdue')).toBe(
      '/admin/desk?filter=dispatch-overdue&view=sales',
    );
  });

  it('ignores a filter it does not know rather than passing it on', () => {
    expect(ledgerRedirect('?filter=nonsense')).toBe('/admin/desk?view=orders');
  });

  it('sends a bare Ledger visit and the retired run lens to Orders', () => {
    expect(ledgerRedirect('')).toBe('/admin/desk?view=orders');
    expect(ledgerRedirect('?view=run')).toBe('/admin/desk?view=orders');
  });

  it('keeps ?view=books and ?view=sales', () => {
    expect(ledgerRedirect('?view=books')).toBe('/admin/desk?view=books');
    expect(ledgerRedirect('?view=sales')).toBe('/admin/desk?view=sales');
  });
});
