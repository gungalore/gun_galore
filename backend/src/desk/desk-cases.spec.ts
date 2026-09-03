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
function makePrisma(
  o: {
    complaints?: unknown[];
    tickets?: unknown[];
    stale?: unknown[];
    /** Overdue rows in the email retry queue — the outbox-stalled finding. */
    outboxStalled?: number;
    /** FAILED SMS with no retry pending — the dead-letter finding. */
    smsDeadLetters?: number;
    /** `warden:ack:*` Setting rows, i.e. findings already seen today. */
    wardenAcks?: { key: string; value: string }[];
  } = {},
) {
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
    // Warden reads the two outbound queues this process owns, and the Setting
    // table for what the operator has already acknowledged today.
    emailOutbox: { count: jest.fn().mockResolvedValue(o.outboxStalled ?? 0) },
    smsLog: { count: jest.fn().mockResolvedValue(o.smsDeadLetters ?? 0) },
    setting: {
      findMany: jest.fn().mockResolvedValue(o.wardenAcks ?? []),
      upsert: jest.fn().mockResolvedValue({}),
    },
    // The dead-inventory card goes through queryFreshnessGraveyard, which is
    // raw SQL shared with /admin/freshness-graveyard so the two cannot rank
    // the same listings differently.
    $queryRawUnsafe: jest.fn().mockResolvedValue(o.stale ?? []),
  };
}

/**
 * ⚠️ THE GATE CARDS ARE READ OUT OF process.env, SO EVERY TEST IN THIS FILE
 * NEEDS A KNOWN BASELINE. Without this the pile grows or loses a red-gate
 * card depending on whose shell ran jest, and a test that counts housekeeping
 * cards passes on one machine and fails on the next.
 */
const REAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VERIFYNOW_MODE = 'production';
  delete process.env.ALLOW_LOCAL_ORIGINS;
});

afterEach(() => {
  process.env = { ...REAL_ENV };
});

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

/* ────────────────────────────────────────────────────────────────────────
 * Warden
 *
 * 🚨 THE SAME FAILURE AS THE CASE DRAWER, CAUGHT A SECOND TIME. 'warden' and
 * 'whatsapp_reply' were both in DeskCardType, both had icons wired in
 * components/desk/icons.tsx, and DeskService emitted neither — so the two
 * Warden faces the catalogue draws could not be reached from any pile, and no
 * type error on either side of the wire said so.
 *
 * Every test below is written to FAIL if a card stops reaching the wire,
 * rather than to describe how it is rendered. That is the regression this
 * project keeps shipping.
 * ──────────────────────────────────────────────────────────────────────── */

describe('Warden red gates on the pile', () => {
  it('deals a card for a gate the Site board calls red', async () => {
    process.env.VERIFYNOW_MODE = 'sandbox';
    const feed = await new DeskService(makePrisma() as never).feed();

    const card = feed.cards.find((c) => c.id === 'warden:gate.VERIFYNOW_MODE');
    expect(card).toBeDefined();
    expect(card?.type).toBe('warden');
    expect(card?.band).toBe('housekeeping');
    expect(card?.tags?.[0]).toMatchObject({ kind: 'bad', label: 'red gate', icon: 'lock' });
  });

  it('says nothing while every gate is green', async () => {
    // The counterpart to the test above: a card that is always there is not a
    // signal. VERIFYNOW_MODE=production with no local origins is a clean box.
    const feed = await new DeskService(makePrisma() as never).feed();
    expect(feed.cards.filter((c) => c.id.startsWith('warden:gate.'))).toHaveLength(0);
  });

  it('follows the board rather than a second list of gate names', async () => {
    // ⚠️ NO GATE IS NAMED IN desk.service.ts. Adding a red gate to
    // DeskSiteService.gates() must start dealing a card the same day, with no
    // second place to remember. ALLOW_LOCAL_ORIGINS is a different gate from
    // the one above and gets a card for free.
    process.env.ALLOW_LOCAL_ORIGINS = 'true';
    const feed = await new DeskService(makePrisma() as never).feed();
    expect(feed.cards.some((c) => c.id === 'warden:gate.ALLOW_LOCAL_ORIGINS')).toBe(true);
  });

  it('carries no Later and no Acknowledge on its face', async () => {
    process.env.VERIFYNOW_MODE = 'sandbox';
    const feed = await new DeskService(makePrisma() as never).feed();
    const card = feed.cards.find((c) => c.id === 'warden:gate.VERIFYNOW_MODE');

    expect(card?.canLater).toBe(false);
    expect(card?.actions).toHaveLength(1);
    expect(card?.actions?.[0]).toMatchObject({ label: 'Open the chat', kind: 'link' });
    expect(card?.actions?.some((a) => a.key === 'acknowledge')).toBe(false);
  });

  it('refuses to be sunk, whatever the client posts', async () => {
    // 🚨 THE RULE, TESTED WHERE IT ACTUALLY HOLDS. Omitting the Later button
    // hides the door; POST /admin/desk/<id>/later takes any string at all.
    const desk = new DeskService(makePrisma() as never);
    expect(() => desk.later('warden:gate.VERIFYNOW_MODE')).toThrow(/red gate cannot be sunk/i);
    // ...and an ordinary card still sinks, so the guard is a rule and not a
    // broken Later.
    expect(desk.later('stale_listing:lst_1').laterUntil).toBeTruthy();
  });

  it('refuses to be acknowledged, whatever the client posts', async () => {
    const desk = new DeskService(makePrisma() as never);
    await expect(desk.act('warden:gate.VERIFYNOW_MODE', 'acknowledge')).rejects.toThrow(
      /red gate cannot be acknowledged/i,
    );
  });

  it('floats above everything else in housekeeping', async () => {
    // Housekeeping is the bottom band, and a listing dead for 91 days would
    // otherwise sort above the reason sellers are not really ID-verified.
    process.env.VERIFYNOW_MODE = 'sandbox';
    const feed = await new DeskService(makePrisma({ stale: [STALE] }) as never).feed();

    const housekeeping = feed.cards.filter((c) => c.band === 'housekeeping');
    expect(housekeeping.length).toBeGreaterThan(1);
    expect(housekeeping[0]?.id).toBe('warden:gate.VERIFYNOW_MODE');
  });

  it('quotes the gate the way the board does, and never a secret', async () => {
    // ⚠️ gates() promises a MODE STRING OR A BOOLEAN, never a value. The card
    // composes its meta out of that promise; if the promise ever loosens,
    // this is the line through which a key reaches a browser.
    process.env.VERIFYNOW_MODE = 'sandbox';
    process.env.PEACH_ENTITY_ID = '8ac7a4c8-not-for-the-pile';
    const feed = await new DeskService(makePrisma() as never).feed();
    const card = feed.cards.find((c) => c.id === 'warden:gate.VERIFYNOW_MODE');

    expect(card?.meta).toContain('VERIFYNOW_MODE=sandbox');
    expect(card?.meta).toContain('nags daily until it flips');
    expect(JSON.stringify(feed)).not.toContain('8ac7a4c8-not-for-the-pile');
  });

  it('keeps the id colon-free after the type, because act() splits on it', async () => {
    // act() destructures cardId.split(':') and keeps two segments, so
    // warden:gate:VERIFYNOW_MODE would silently lose its key.
    process.env.VERIFYNOW_MODE = 'sandbox';
    const feed = await new DeskService(makePrisma() as never).feed();
    const card = feed.cards.find((c) => c.type === 'warden');
    expect(card?.id.split(':')).toHaveLength(2);
  });
});

describe('Warden findings on the pile', () => {
  it('deals a card when the email outbox stops draining', async () => {
    const feed = await new DeskService(makePrisma({ outboxStalled: 214 }) as never).feed();

    const card = feed.cards.find((c) => c.id === 'warden:outbox-stalled');
    expect(card).toBeDefined();
    expect(card?.type).toBe('warden');
    expect(card?.band).toBe('housekeeping');
    expect(card?.headline).toContain('214');
    expect(card?.tags?.[0]).toMatchObject({ kind: 'info', label: 'diagnosis', icon: 'bolt' });
  });

  it('waits three sweeps before calling the outbox stalled', async () => {
    // The retry cron runs every 10 minutes and its own comment says the table
    // should normally be empty. 30 minutes is three passes, not one slow send.
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();

    const cutoff = prisma.emailOutbox.count.mock.calls[0][0].where.nextAttemptAt.lt as Date;
    expect(Math.round((Date.now() - cutoff.getTime()) / 60_000)).toBe(30);
  });

  it('asks only for SMS nothing will retry', async () => {
    // A FAILED row with a nextRetryAt is a queue still working; a FAILED row
    // without one is a lost send. Only the second is a finding.
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();

    const where = prisma.smsLog.count.mock.calls[0][0].where;
    expect(where.status).toBe('FAILED');
    expect(where.nextRetryAt).toBeNull();
  });

  it('treats one dead SMS as a bad number and three as the provider', async () => {
    const quiet = await new DeskService(makePrisma({ smsDeadLetters: 2 }) as never).feed();
    expect(quiet.cards.some((c) => c.id === 'warden:sms-dead-letters')).toBe(false);

    const loud = await new DeskService(makePrisma({ smsDeadLetters: 3 }) as never).feed();
    expect(loud.cards.some((c) => c.id === 'warden:sms-dead-letters')).toBe(true);
  });

  it('offers Acknowledge, and never an Approve with no fix behind it', async () => {
    // 🚨 THE CATALOGUE DRAWS "Approve the fix" ON THIS FACE AND IT IS ABSENT
    // ON PURPOSE. Nothing stores an approvable command yet — there is no
    // WardenProposal model — so a money-grade Approve would open a confirm
    // that restates nothing and runs nothing. Delete this assertion when the
    // store lands, and not one commit before.
    const feed = await new DeskService(makePrisma({ outboxStalled: 4 }) as never).feed();
    const card = feed.cards.find((c) => c.id === 'warden:outbox-stalled');

    expect(card?.actions?.map((a) => a.key)).toEqual(['chat', 'acknowledge']);
    expect(JSON.stringify(feed)).not.toContain('Approve the fix');
  });

  it('goes quiet for a day once acknowledged, then comes back', async () => {
    const seenNow = {
      key: 'warden:ack:outbox-stalled',
      value: new Date(Date.now() - 60_000).toISOString(),
    };
    const quiet = await new DeskService(
      makePrisma({ outboxStalled: 9, wardenAcks: [seenNow] }) as never,
    ).feed();
    expect(quiet.cards.some((c) => c.id === 'warden:outbox-stalled')).toBe(false);

    // ⚠️ ACKNOWLEDGED, NOT RESOLVED. The outbox is still stalled, so the day
    // after, the finding is back on the pile.
    const seenYesterday = {
      key: 'warden:ack:outbox-stalled',
      value: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    };
    const loud = await new DeskService(
      makePrisma({ outboxStalled: 9, wardenAcks: [seenYesterday] }) as never,
    ).feed();
    expect(loud.cards.some((c) => c.id === 'warden:outbox-stalled')).toBe(true);
  });

  it('writes the acknowledgement where the next feed will look for it', async () => {
    // The suppression above is only real if act() writes the key feed() reads.
    // Both go through wardenAckKey(); this is the test that they agree.
    const prisma = makePrisma();
    await new DeskService(prisma as never).act('warden:outbox-stalled', 'acknowledge');

    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'warden:ack:outbox-stalled' } }),
    );
  });

  it('reads acknowledgements under the one prefix it writes', async () => {
    const prisma = makePrisma();
    await new DeskService(prisma as never).feed();
    expect(prisma.setting.findMany.mock.calls[0][0].where.key.startsWith).toBe('warden:ack:');
  });

  it('sits below the cases, because a stalled queue is not a frozen payout', async () => {
    const feed = await new DeskService(
      makePrisma({ outboxStalled: 4, complaints: [COMPLAINT] }) as never,
    ).feed();
    const kinds = feed.cards.map((c) => c.type);
    expect(kinds.indexOf('complaint')).toBeLessThan(kinds.indexOf('warden'));
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Warden proposals
 *
 * The catalogue's Warden face with a command behind it. The proposal comes
 * from the daemon on the box through WardenService — this process has no
 * shell and must never have one — so the fake below stands in for the daemon,
 * not for a table.
 * ──────────────────────────────────────────────────────────────────────── */

const PROPOSAL = {
  id: 'prop_40',
  kind: 'proposal' as const,
  status: 'pending' as const,
  headline: 'Proposed fix: raise the health-probe timeout 3s to 8s',
  diagnosis: 'nginx served 502s for 4 min while pm2 reloaded. The change touches warden.yml only.',
  command: 'warden apply proposal 40',
  gateKey: null,
  raisedAt: '2026-09-03T09:05:00.000Z',
};

/** A Warden daemon that is deployed and answering, with the given proposals. */
function makeWarden(proposals: unknown[] = []) {
  return {
    present: jest.fn().mockReturnValue(true),
    chat: jest.fn().mockResolvedValue({
      present: true,
      lastCheckAt: '2026-09-03T09:14:00.000Z',
      messages: [],
      proposals,
    }),
  };
}

/** DeskService with the daemon wired in; `site` keeps its own default. */
function deskWithWarden(prisma: unknown, warden: unknown) {
  return new DeskService(prisma as never, undefined as never, warden as never);
}

describe('Warden proposals on the pile', () => {
  it('deals a card for a proposal waiting on a decision', async () => {
    const feed = await deskWithWarden(makePrisma(), makeWarden([PROPOSAL])).feed();

    const card = feed.cards.find((c) => c.id === 'warden:prop_40');
    expect(card).toBeDefined();
    expect(card?.type).toBe('warden');
    expect(card?.band).toBe('housekeeping');
    expect(card?.headline).toBe(PROPOSAL.headline);
    expect(card?.tags?.[0]).toMatchObject({ kind: 'info', label: 'proposal', icon: 'bolt' });
  });

  it('carries the exact command the confirm has to restate', async () => {
    // ⚠️ A money-grade confirm that cannot say what will run is not a confirm.
    // FeedAction has nowhere to put a command, so it rides on note.
    const feed = await deskWithWarden(makePrisma(), makeWarden([PROPOSAL])).feed();
    expect(feed.cards.find((c) => c.id === 'warden:prop_40')?.note).toBe(
      'warden apply proposal 40',
    );
  });

  it('offers Approve as money-grade, never as an undo', async () => {
    // 🚨 Approve ends in a command running on a production box. The undo
    // window is a client-side delay; a fix already run cannot be taken back
    // by letting a timer expire.
    const feed = await deskWithWarden(makePrisma(), makeWarden([PROPOSAL])).feed();
    const card = feed.cards.find((c) => c.id === 'warden:prop_40');

    const approve = card?.actions?.find((a) => a.key === 'approve');
    expect(approve).toMatchObject({ label: 'Approve the fix…', kind: 'money' });
    expect(approve?.kind).not.toBe('undo');
    expect(card?.actions?.map((a) => a.key)).toEqual(['chat', 'approve', 'acknowledge']);
  });

  it('refuses to approve from the generic card-face dispatcher', async () => {
    // The one door is POST admin/warden/proposals/:id/approve, which re-reads
    // the proposal and compares the command against the confirmed one.
    const desk = deskWithWarden(makePrisma(), makeWarden([PROPOSAL]));
    await expect(desk.act('warden:prop_40', 'approve')).rejects.toThrow(/from the chat/i);
  });

  it('leaves a settled proposal off the pile', async () => {
    const settled = { ...PROPOSAL, status: 'approved' as const };
    const feed = await deskWithWarden(makePrisma(), makeWarden([settled])).feed();
    expect(feed.cards.some((c) => c.id === 'warden:prop_40')).toBe(false);
  });

  it('never deals a red gate twice, once from each side of the wire', async () => {
    // 🚨 WardenService.gates() reads its gate VALUES from DeskSiteService so
    // the daemon and the board cannot disagree — which means a daemon
    // red_gate proposal and the board's red gate are one fact. Dealing both
    // would put the same gate on the pile twice.
    process.env.VERIFYNOW_MODE = 'sandbox';
    const daemonGate = {
      ...PROPOSAL,
      id: 'prop_41',
      kind: 'red_gate' as const,
      command: null,
      gateKey: 'VERIFYNOW_MODE',
    };
    const feed = await deskWithWarden(makePrisma(), makeWarden([daemonGate])).feed();

    expect(feed.cards.some((c) => c.id === 'warden:prop_41')).toBe(false);
    expect(feed.cards.filter((c) => c.tags?.some((t) => t.label === 'red gate'))).toHaveLength(1);
  });

  it('stops speaking for itself once Warden is deployed', async () => {
    // ⚠️ Warden is the authority on what is wrong with the running system.
    // The outbox finding is what this process says while nobody better is
    // listening; two voices on one stalled queue is two cards.
    const prisma = makePrisma({ outboxStalled: 214, smsDeadLetters: 9 });

    const alone = await new DeskService(prisma as never).feed();
    expect(alone.cards.some((c) => c.id === 'warden:outbox-stalled')).toBe(true);
    expect(alone.cards.some((c) => c.id === 'warden:sms-dead-letters')).toBe(true);

    const deployed = await deskWithWarden(prisma, makeWarden([PROPOSAL])).feed();
    expect(deployed.cards.some((c) => c.id === 'warden:outbox-stalled')).toBe(false);
    expect(deployed.cards.some((c) => c.id === 'warden:sms-dead-letters')).toBe(false);
  });

  it('never waits on a socket for a Warden that was never configured', async () => {
    // 🚨 chat() is an HTTP hop to the box. Warden is unconfigured on every
    // environment today, so asking first is what keeps the whole pile from
    // waiting out a read timeout on every load.
    const warden = { present: jest.fn().mockReturnValue(false), chat: jest.fn() };
    await deskWithWarden(makePrisma(), warden).feed();

    expect(warden.present).toHaveBeenCalled();
    expect(warden.chat).not.toHaveBeenCalled();
  });

  it('still builds the whole pile with no Warden at all', async () => {
    // The daemon is optional and absent everywhere today. A feed that needed
    // it would be a Desk nobody could open.
    const feed = await new DeskService(makePrisma({ complaints: [COMPLAINT] }) as never).feed();
    expect(feed.cards.some((c) => c.type === 'complaint')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * WhatsApp reply
 *
 * 🚨 STILL UNREACHABLE, AND THIS IS THE MARKER THAT SAYS SO OUT LOUD.
 * 'whatsapp_reply' is in DeskCardType and has an icon wired, and nothing can
 * emit it: the schema has no inbound-WhatsApp table, there is no WABA, no
 * provider and no template registry. The 24-hour window the card's entire
 * clock is built on is opened by an inbound message this system cannot
 * receive.
 *
 * A card built on a fabricated source would be worse than no card — it is
 * exactly the failure this file exists to catch, wearing the fix as a
 * disguise. So the gap is recorded as pending rather than papered over, and
 * prints on every run until the store and the credentials exist.
 *
 * To close it: an inbound-message model (wa number, body, receivedAt,
 * transactionId, answeredAt) written by the provider webhook; WHATSAPP_* env
 * read fail-closed the way PEACH_* already is; and the whatsapp_enabled
 * Setting kill switch DeskSiteService.channels() already reads. None of those
 * files are this one's to write.
 * ──────────────────────────────────────────────────────────────────────── */

describe('WhatsApp reply on the pile', () => {
  it.todo('emits a card once an inbound WhatsApp store and a WABA exist');
  it.todo('clocks the remaining 24h window, warn under 6h and bad under 2h');
  it.todo('never deals while whatsapp_enabled is off or WHATSAPP_* is unset');
  it.todo('resolves the card as unanswered when the window closes');
});

/* ────────────────────────────────────────────────────────────────────────
 * Two bugs adversarial review found, pinned so they cannot return
 * ──────────────────────────────────────────────────────────────────────── */

describe('Acknowledge actually suppresses a Warden proposal', () => {
  /**
   * 🚨 FOUR REVIEW LENSES FOUND THIS SEPARATELY. The findings loop read the
   * acknowledgement rows and the proposals loop never did, so the card came
   * straight back on the next feed while its own toast promised "Warden will
   * raise it again tomorrow". A promise the code does not keep is worse than
   * no button, because the operator stops looking.
   */
  const ackRow = (entityId: string, whenIso: string) => ({
    key: `warden:ack:${entityId}`,
    value: whenIso,
  });

  it('drops the card once it has been acknowledged', async () => {
    const prisma = makePrisma();
    prisma.setting.findMany = jest
      .fn()
      .mockResolvedValue([ackRow('prop_40', new Date().toISOString())]);

    const feed = await deskWithWarden(prisma, makeWarden([PROPOSAL])).feed();
    expect(feed.cards.some((c) => c.id === 'warden:prop_40')).toBe(false);
  });

  it('brings it back once the window has passed', async () => {
    // The acknowledgement is "stop showing me today", not "never again".
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    const prisma = makePrisma();
    prisma.setting.findMany = jest.fn().mockResolvedValue([ackRow('prop_40', old)]);

    const feed = await deskWithWarden(prisma, makeWarden([PROPOSAL])).feed();
    expect(feed.cards.some((c) => c.id === 'warden:prop_40')).toBe(true);
  });

  it('ignores an unparseable acknowledgement rather than hiding the card forever', async () => {
    // A row nobody can read must not silently mute a proposal.
    const prisma = makePrisma();
    prisma.setting.findMany = jest.fn().mockResolvedValue([ackRow('prop_40', 'not a date')]);

    const feed = await deskWithWarden(prisma, makeWarden([PROPOSAL])).feed();
    expect(feed.cards.some((c) => c.id === 'warden:prop_40')).toBe(true);
  });
});

describe('a daemon proposal cannot impersonate a red gate', () => {
  /**
   * 🚨 THE PREFIX USED TO BE FORGEABLE. Warden mints proposal ids from
   * [A-Za-z0-9_-], so a proposal legitimately called "gate-nginx" arrived as
   * `warden:gate-nginx`, and isRedGate()'s prefix test branded it an
   * unsinkable, unacknowledgeable red gate with nothing on the card to say
   * why. The prefix is now `warden:gate.` — a dot is outside the daemon's
   * alphabet, so it cannot be minted by anything but us.
   */
  const HOSTILE = { ...PROPOSAL, id: 'gate-nginx' };

  it('deals it as an ordinary proposal', async () => {
    const feed = await deskWithWarden(makePrisma(), makeWarden([HOSTILE])).feed();
    const card = feed.cards.find((c) => c.id === 'warden:gate-nginx');
    expect(card).toBeDefined();
    expect(card?.tags?.[0]).toMatchObject({ label: 'proposal' });
  });

  it('lets it be sunk and acknowledged like any other proposal', () => {
    const desk = deskWithWarden(makePrisma(), makeWarden([HOSTILE]));
    expect(() => desk.later('warden:gate-nginx')).not.toThrow();
  });

  it('still refuses a genuine red gate', () => {
    const desk = deskWithWarden(makePrisma(), makeWarden([]));
    expect(() => desk.later('warden:gate.VERIFYNOW_MODE')).toThrow(/red gate cannot be sunk/i);
  });
});
