import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CLOSURE_REASONS,
  confirmAccepted,
  isClosureReason,
  normaliseEligibility,
} from './users-api';

// The two gates on the close-account screen and the parser that decides
// which screen renders at all. Everything here is pure — vitest runs in a
// node environment (vitest.config.ts) so there is no DOM to render the
// component in, and these are the parts where being wrong is destructive
// rather than ugly.

describe('confirmAccepted', () => {
  it('accepts the literal word', () => {
    expect(confirmAccepted('CLOSE')).toBe(true);
  });

  it('trims, because a phone keyboard appends a space after autocomplete', () => {
    expect(confirmAccepted(' CLOSE ')).toBe(true);
    expect(confirmAccepted('CLOSE\n')).toBe(true);
  });

  it('⚠️ REFUSES lower case — the gate must not be passable by reflex', () => {
    // "close" is the word on the button they just pressed. Case-folding
    // here would let a member confirm an irreversible action by typing
    // back what the UI just said to them.
    expect(confirmAccepted('close')).toBe(false);
    expect(confirmAccepted('Close')).toBe(false);
  });

  it('refuses anything that is not exactly the word', () => {
    expect(confirmAccepted('')).toBe(false);
    expect(confirmAccepted('CLOSE ACCOUNT')).toBe(false);
    expect(confirmAccepted('CLOS')).toBe(false);
  });
});

describe('isClosureReason', () => {
  it('accepts every code the ticklist offers', () => {
    for (const [code] of ACCOUNT_CLOSURE_REASONS) {
      expect(isClosureReason(code)).toBe(true);
    }
  });

  it('⚠️ REJECTS FREE TEXT — the reason is a ticklist code, never prose', () => {
    // AccountClosure.reason is read by admins and, eventually, by a
    // law-enforcement request. A sentence there is unstructured and can
    // carry an accusation about another member that nobody moderates.
    expect(isClosureReason('I had a bad experience')).toBe(false);
    expect(isClosureReason('')).toBe(false);
    expect(isClosureReason(undefined)).toBe(false);
  });

  it('has no duplicate codes', () => {
    const codes = ACCOUNT_CLOSURE_REASONS.map(([c]) => c);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('normaliseEligibility', () => {
  it('lets a clean account through', () => {
    const e = normaliseEligibility({ eligible: true, blockers: [] });
    expect(e.eligible).toBe(true);
    expect(e.restricted).toBe(false);
    expect(e.blockers).toEqual([]);
  });

  it('accepts canClose as well as eligible', () => {
    // The service method behind the route is named canClose(); a route that
    // spreads its return value answers with that key.
    expect(normaliseEligibility({ canClose: true, blockers: [] }).eligible).toBe(
      true,
    );
  });

  it('⚠️ FAILS CLOSED on a payload it cannot read', () => {
    // The closure service and this screen were built in parallel. An
    // optimistic default here renders the irreversible screen over an
    // empty blocker list, so the member reads "nothing is outstanding"
    // off a response we did not understand.
    expect(normaliseEligibility(null).eligible).toBe(false);
    expect(normaliseEligibility({}).eligible).toBe(false);
    expect(normaliseEligibility('nope').eligible).toBe(false);
    expect(normaliseEligibility({ ok: true }).eligible).toBe(false);
  });

  it('⚠️ refuses eligibility whenever a blocker is present, even if the server said yes', () => {
    const e = normaliseEligibility({
      eligible: true,
      blockers: [{ code: 'OPEN_OFFER', message: 'You have 2 open offers' }],
    });
    expect(e.eligible).toBe(false);
    expect(e.blockers).toHaveLength(1);
  });

  it('fills in a destination for a known blocker code', () => {
    const [b] = normaliseEligibility({
      blockers: [{ code: 'PAYOUT_DUE', message: 'We still owe you on 1 order' }],
    }).blockers;
    expect(b.href).toBe('/my/earnings');
  });

  it("prefers the server's own href — it knows the ids", () => {
    const [b] = normaliseEligibility({
      blockers: [
        { code: 'OPEN_ORDER', message: 'One order is open', href: '/orders/abc' },
      ],
    }).blockers;
    expect(b.href).toBe('/orders/abc');
  });

  it('leaves an unknown code without a link rather than guessing one', () => {
    // Sending someone to the wrong page to fix the wrong thing is worse
    // than sending them nowhere.
    const [b] = normaliseEligibility({
      blockers: [{ code: 'SOMETHING_NEW', message: 'Something is open' }],
    }).blockers;
    expect(b.message).toBe('Something is open');
    expect(b.href).toBeNull();
  });

  it('keeps a bare string blocker rather than dropping it', () => {
    const [b] = normaliseEligibility({
      blockers: ['An auction of yours has bids on it'],
    }).blockers;
    expect(b.message).toBe('An auction of yours has bids on it');
  });

  it('drops an entry with no message — there is nothing to render', () => {
    expect(
      normaliseEligibility({ blockers: [{ code: 'OPEN_OFFER' }, null, 42] })
        .blockers,
    ).toEqual([]);
  });

  it('⚠️ reports a restriction separately from a blocker', () => {
    // isBanned / sellingBannedAt route to the support screen (§5.4). A
    // closure is not an enforcement action and must never render as one,
    // and the restriction must not also appear in the open-items list
    // underneath its own screen.
    const e = normaliseEligibility({
      restricted: true,
      blockers: [
        { code: 'ACCOUNT_RESTRICTED', message: 'Your account is restricted' },
        { code: 'OPEN_OFFER', message: 'You have 1 open offer' },
      ],
    });
    expect(e.restricted).toBe(true);
    expect(e.eligible).toBe(false);
    expect(e.blockers.map((b) => b.code)).toEqual(['OPEN_OFFER']);
  });

  it('infers a restriction from the blocker code alone', () => {
    // Belt-and-braces: the route may report the ban as a blocker without a
    // top-level flag, and that must not render as "finish this first".
    const e = normaliseEligibility({
      blockers: [{ code: 'SELLING_BANNED', message: 'Selling is restricted' }],
    });
    expect(e.restricted).toBe(true);
    expect(e.blockers).toEqual([]);
  });

  it('treats an already-closed account as its own state, not an error', () => {
    const e = normaliseEligibility({
      eligible: true,
      accountClosedAt: '2026-08-22T10:00:00.000Z',
      blockers: [],
    });
    expect(e.alreadyClosed).toBe(true);
    expect(e.eligible).toBe(false);
  });

  // ── The payloads AccountClosureService.canClose actually returns ──────
  //
  // Everything above tests shapes this parser tolerates. These four test the
  // shape it is given. They were added after the first cut of the parser
  // looked for keys the route does not send.

  it('⚠️ reads ALREADY_CLOSED off the blocker list — that is how the route says it', () => {
    // canClose() answers { canClose: false, restricted: false, blockers: [
    // { code: 'ALREADY_CLOSED', … } ] }. No accountClosedAt, no `closed`.
    // Missing it put a member whose Clerk deletion had failed on the §5.3
    // screen — "some things on your account are still open", one item, the
    // sentence "This account is already closed."
    const e = normaliseEligibility({
      canClose: false,
      restricted: false,
      blockers: [
        { code: 'ALREADY_CLOSED', message: 'This account is already closed.' },
      ],
    });
    expect(e.alreadyClosed).toBe(true);
    expect(e.eligible).toBe(false);
    // Its own screen says it; it must not also be listed as an open item.
    expect(e.blockers).toEqual([]);
  });

  it('reads the restricted payload the route sends for a banned member', () => {
    const e = normaliseEligibility({
      canClose: false,
      restricted: true,
      blockers: [],
    });
    expect(e.restricted).toBe(true);
    expect(e.eligible).toBe(false);
    expect(e.alreadyClosed).toBe(false);
  });

  it('⚠️ knows the blocker codes the service emits, not the ones we guessed', () => {
    // The service sends its own href today, so a wrong key here fails
    // silently. It stops being silent the first time a blocker ships without
    // one. Codes read off AccountClosureService.canClose.
    const hrefFor = (code: string) =>
      normaliseEligibility({ blockers: [{ code, message: 'x' }] }).blockers[0]
        .href;
    expect(hrefFor('FUNDS_IN_FLIGHT')).toBe('/my/orders');
    expect(hrefFor('PAYOUT_DUE')).toBe('/my/earnings');
    expect(hrefFor('UNDELIVERED')).toBe('/shipping');
    expect(hrefFor('FIREARM_TRANSFER')).toBe('/shipping');
    expect(hrefFor('OPEN_COMPLAINT')).toBe('/complaints');
    expect(hrefFor('LIVE_AUCTION')).toBe('/my/listings');
    expect(hrefFor('MID_CHECKOUT')).toBe('/my/listings');
    expect(hrefFor('OPEN_OFFERS')).toBe('/my/offers');
  });

  it('passes a real multi-blocker payload straight through, hrefs and all', () => {
    const e = normaliseEligibility({
      canClose: false,
      restricted: false,
      blockers: [
        {
          code: 'OPEN_COMPLAINT',
          count: 1,
          href: '/complaints',
          message:
            'There is an open complaint involving one of your orders. It has to be closed out first.',
        },
        {
          code: 'OPEN_OFFERS',
          count: 2,
          href: '/my/offers',
          message: 'You have 2 open offers.',
        },
      ],
    });
    expect(e.eligible).toBe(false);
    expect(e.alreadyClosed).toBe(false);
    expect(e.restricted).toBe(false);
    expect(e.blockers.map((b) => b.href)).toEqual([
      '/complaints',
      '/my/offers',
    ]);
  });

  // The example code here is incidental — what is under test is that a
  // WARNING passes through without blocking and still gets its href mapped.
  // It used ACTIVE_SUBSCRIPTION until 2026-08-26, when the PRO membership was
  // removed and that code went with it; PAYOUT_DUE exercises the same path.
  it('carries warnings through without blocking', () => {
    const e = normaliseEligibility({
      eligible: true,
      blockers: [],
      warnings: [
        { code: 'PAYOUT_DUE', message: 'A payout is still on its way to you' },
      ],
    });
    expect(e.eligible).toBe(true);
    expect(e.warnings).toHaveLength(1);
    expect(e.warnings[0].href).toBe('/my/earnings');
  });
});
