import { DeskService } from './desk.service';

/**
 * THE DESK — complaints and support tickets reach the pile.
 *
 * 🚨 THIS IS THE TEST THAT SHOULD HAVE EXISTED BEFORE THE CASE DRAWER DID.
 * The drawer was built, styled and wired to two card types for weeks, and
 * DeskService emitted neither of them — so `/admin/complaints` and
 * `/admin/support` could not be retired however finished the drawer looked,
 * and nobody could tell by reading either file. A card type in the catalogue
 * that nothing emits is a feature no operator can reach.
 *
 * The card id is the whole contract with the client: `drawerTargetFor()` in
 * app/admin/desk/page.tsx splits on `<type>:` and hands the tail to the Case
 * drawer as the case id. Change the prefix and the drawer opens on a case
 * that does not exist, with no type error on either side of the wire.
 */

const NOW = new Date('2026-09-03T09:00:00.000Z');
const THREE_DAYS_AGO = new Date('2026-08-31T09:00:00.000Z');

/**
 * Everything the feed asks for, empty, so a test can put rows in one place and
 * read the pile back knowing where every card came from.
 */
function makePrisma(o: { complaints?: unknown[]; tickets?: unknown[]; stale?: unknown[] } = {}) {
  const noRows = jest.fn().mockResolvedValue([]);
  return {
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { buyerTotal: null, sellerPayout: null }, _count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    listing: { findMany: noRows },
    listingQuestion: { findMany: noRows },
    user: { findMany: noRows, count: jest.fn().mockResolvedValue(0) },
    adminAlert: { findMany: noRows },
    complaint: { findMany: jest.fn().mockResolvedValue(o.complaints ?? []) },
    supportTicket: { findMany: jest.fn().mockResolvedValue(o.tickets ?? []) },
    // The dead-inventory card goes through queryFreshnessGraveyard, which is
    // raw SQL shared with /admin/freshness-graveyard so the two cannot rank
    // the same listings differently.
    $queryRawUnsafe: jest.fn().mockResolvedValue(o.stale ?? []),
  };
}

const COMPLAINT = {
  id: 'cmpl_1',
  referenceNumber: 'CO000123',
  category: 'ITEM_NOT_AS_DESCRIBED',
  subject: 'Rifle arrived with a cracked stock',
  status: 'OPEN',
  drovePayoutHold: false,
  createdAt: THREE_DAYS_AGO,
  transactionId: 'tx_1',
  user: { username: 'boet' },
};

const TICKET = {
  id: 'tkt_1',
  subject: 'Cannot upload my competency certificate',
  category: 'account',
  createdAt: THREE_DAYS_AGO,
  transactionId: null,
  user: { username: 'skietrob' },
  _count: { replies: 0 },
};

describe('complaints on the pile', () => {
  it('emits a card the Case drawer can open', async () => {
    const prisma = makePrisma({ complaints: [COMPLAINT] });
    const feed = await new DeskService(prisma as never).feed();

    const card = feed.cards.find((c) => c.type === 'complaint');
    expect(card).toBeDefined();
    // The id the client splits on. `complaint:` + the cuid, never the
    // reference number — fetchCase takes either, but the drawer is handed
    // whatever follows the colon and the rest of the Desk uses the id.
    expect(card?.id).toBe('complaint:cmpl_1');
    expect(card?.reference).toBe('CO000123');
    expect(card?.actions?.[0]?.kind).toBe('drawer');
  });

  it('asks only for cases the operator can move today', async () => {
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();

    const where = prisma.complaint.findMany.mock.calls[0][0].where;
    // AWAITING_USER is the member's turn; RESOLVED and CLOSED are done.
    expect(where.status).toEqual({ in: ['OPEN', 'UNDER_REVIEW'] });
  });

  it('names the member by username and never by anything else', async () => {
    const prisma = makePrisma({ complaints: [COMPLAINT] });
    const feed = await new DeskService(prisma as never).feed();
    const card = feed.cards.find((c) => c.type === 'complaint');

    expect(card?.meta).toContain('@boet');
    // ⚠️ The select must not even ASK for a real name. A complaint is a
    // member's own account of a bad experience and the pile is a scannable
    // list — see the username rule.
    const select = prisma.complaint.findMany.mock.calls[0][0].select;
    for (const forbidden of ['firstName', 'lastName', 'email', 'phone']) {
      expect(JSON.stringify(select)).not.toContain(forbidden);
    }
  });

  it('leads with the frozen payout, because that is what changes the urgency', async () => {
    const prisma = makePrisma({
      complaints: [{ ...COMPLAINT, drovePayoutHold: true, status: 'UNDER_REVIEW' }],
    });
    const feed = await new DeskService(prisma as never).feed();
    const card = feed.cards.find((c) => c.type === 'complaint');

    expect(card?.tags?.[0]).toMatchObject({ kind: 'bad', label: 'payout frozen' });
    expect(card?.tags?.[1]).toMatchObject({ label: 'under review' });
  });

  it('sits in the disputes band, not below the housekeeping', async () => {
    const prisma = makePrisma({ complaints: [COMPLAINT] });
    const feed = await new DeskService(prisma as never).feed();
    expect(feed.cards.find((c) => c.type === 'complaint')?.band).toBe('disputes');
  });

  it('reads the category the same way the drawer does', async () => {
    // prettyCategory in lib/desk-case.ts does exactly this. One complaint must
    // not read two ways on one screen.
    const prisma = makePrisma({ complaints: [COMPLAINT] });
    const feed = await new DeskService(prisma as never).feed();
    expect(feed.cards.find((c) => c.type === 'complaint')?.meta).toContain(
      'Item not as described',
    );
  });
});

describe('support tickets on the pile', () => {
  it('emits a card the Case drawer can open', async () => {
    const prisma = makePrisma({ tickets: [TICKET] });
    const feed = await new DeskService(prisma as never).feed();

    const card = feed.cards.find((c) => c.type === 'support');
    expect(card?.id).toBe('support:tkt_1');
    expect(card?.actions?.[0]?.kind).toBe('drawer');
  });

  it('prints no reference, because a support ticket has no number', async () => {
    // ⚠️ It carries a cuid and nothing else. Showing it would look like a case
    // number an operator could quote back to a member and match to nothing.
    const prisma = makePrisma({ tickets: [TICKET] });
    const feed = await new DeskService(prisma as never).feed();
    expect(feed.cards.find((c) => c.type === 'support')?.reference).toBeUndefined();
  });

  it('waits on us only — a ticket we already answered is not work', async () => {
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();
    expect(prisma.supportTicket.findMany.mock.calls[0][0].where.status).toBe('OPEN');
  });

  it('flags a ticket nobody has ever replied to', async () => {
    const prisma = makePrisma({ tickets: [TICKET] });
    const feed = await new DeskService(prisma as never).feed();
    const card = feed.cards.find((c) => c.type === 'support');
    expect(card?.tags?.some((t) => t.label === 'never answered')).toBe(true);
  });

  it('drops that flag once somebody has answered', async () => {
    const prisma = makePrisma({ tickets: [{ ...TICKET, _count: { replies: 2 } }] });
    const feed = await new DeskService(prisma as never).feed();
    const card = feed.cards.find((c) => c.type === 'support');
    expect(card?.tags?.some((t) => t.label === 'never answered')).toBe(false);
  });

  it('sits below the disputes, because a question is not a frozen payout', async () => {
    const prisma = makePrisma({ tickets: [TICKET] });
    const feed = await new DeskService(prisma as never).feed();
    expect(feed.cards.find((c) => c.type === 'support')?.band).toBe('reviews_cases');
  });
});

describe('the two together', () => {
  it('orders the complaint above the ticket', async () => {
    const prisma = makePrisma({ complaints: [COMPLAINT], tickets: [TICKET] });
    const feed = await new DeskService(prisma as never).feed();

    const kinds = feed.cards.map((c) => c.type);
    expect(kinds.indexOf('complaint')).toBeLessThan(kinds.indexOf('support'));
  });

  it('counts both in their bands', async () => {
    const prisma = makePrisma({ complaints: [COMPLAINT], tickets: [TICKET] });
    const feed = await new DeskService(prisma as never).feed();

    const count = (key: string) => feed.bands.find((b) => b.key === key)?.count ?? 0;
    expect(count('disputes')).toBe(1);
    expect(count('reviews_cases')).toBe(1);
  });

  it('carries nothing off the row that the card does not show', async () => {
    // The dossier is the drawer's job. A pile card that quietly ships a
    // complaint's body is a privacy leak nobody would look for on a list page.
    const prisma = makePrisma({
      complaints: [{ ...COMPLAINT, body: 'the whole account of what went wrong' }],
      tickets: [TICKET],
    });
    const feed = await new DeskService(prisma as never).feed();
    expect(JSON.stringify(feed)).not.toContain('the whole account of what went wrong');
  });
});

// NOW is referenced so the ageing tags have a stable frame if this file grows
// a clock-dependent case; the emitters read createdAt only through ageLabel.
void NOW;

/* ────────────────────────────────────────────────────────────────────────
 * Dead inventory
 * ──────────────────────────────────────────────────────────────────────── */

const STALE = {
  id: 'lst_1',
  referenceNumber: 'UM000441',
  title: 'Sako 85 Bavarian .308',
  priceCents: 4_500_000,
  ageDays: 91.4,
  staleScore: 411_300,
  sellerId: 'usr_1',
  sellerUsername: 'boet',
  sellerEmail: 'boet@example.com',
  categoryName: 'Rifles',
  listingType: 'BUY_NOW',
};

describe('dead inventory on the pile', () => {
  it('opens the Listing drawer, which is where take-down lives', async () => {
    // ⚠️ THIS IS THE POINT OF THE CARD. canTakeDown() wants an ACTIVE listing,
    // and until this card the only door into the Listing drawer was a
    // PENDING_REVIEW review card — so no listing that could be taken down
    // could be opened from the Desk at all.
    const prisma = makePrisma({ stale: [STALE] });
    const feed = await new DeskService(prisma as never).feed();

    const card = feed.cards.find((c) => c.type === 'stale_listing');
    expect(card?.id).toBe('stale_listing:lst_1');
    expect(card?.actions?.[0]?.kind).toBe('drawer');
    expect(card?.band).toBe('housekeeping');
  });

  it('asks for five, not the report’s fifty', async () => {
    // Fifty housekeeping cards would bury the money band under inventory
    // nobody has to act on today.
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();

    const args = prisma.$queryRawUnsafe.mock.calls[0];
    expect(args[2]).toBe(5);
  });

  it('waits longer than the report before calling a listing dead', async () => {
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();

    // The cutoff is passed as a Date; 60 days back, not 30.
    const cutoff = prisma.$queryRawUnsafe.mock.calls[0][1] as Date;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(60);
  });

  it('keeps the stale score off the screen', async () => {
    // It is age × price in rands — a ranking number with no meaning to a
    // human. An operator reading "411 300" beside a rifle would take it for
    // money.
    const prisma = makePrisma({ stale: [STALE] });
    const feed = await new DeskService(prisma as never).feed();
    const card = feed.cards.find((c) => c.type === 'stale_listing');

    expect(JSON.stringify(card)).not.toContain('411300');
    expect(JSON.stringify(card)).not.toContain('411 300');
  });

  it('shows the price, the age and why it is dead', async () => {
    const prisma = makePrisma({ stale: [STALE] });
    const feed = await new DeskService(prisma as never).feed();
    const card = feed.cards.find((c) => c.type === 'stale_listing');

    expect(card?.headline).toBe('Sako 85 Bavarian .308');
    expect(card?.reference).toBe('UM000441');
    expect(card?.meta).toContain('@boet');
    expect(card?.meta).toContain('no bids, offers or watchers');
    expect(card?.tags?.[0]?.label).toBe('91 days live');
  });

  it('never carries the seller’s email off the row', async () => {
    // queryFreshnessGraveyard selects sellerEmail for the report's own use.
    // The card must not ship it: the pile is a list, and the rule is
    // usernames on anything member-facing.
    const prisma = makePrisma({ stale: [STALE] });
    const feed = await new DeskService(prisma as never).feed();
    expect(JSON.stringify(feed)).not.toContain('boet@example.com');
  });
});
