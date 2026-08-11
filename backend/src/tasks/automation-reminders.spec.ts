// Locks the 2026-07-24 automation batch: the reminder / nudge / watchdog
// passes that stand between a user and an automatic penalty (offer lapse,
// unpaid-win strike) or between a seller and their money (unconfirmed
// delivery). Every one of these is a cron pass, so the properties that
// matter are: the right population is selected, the one-shot guard is
// CAS-claimed (never double-sends), and a claim loss is silent.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';
import { DispatchSlaService } from '../payments/dispatch-sla.service';
import { WishlistAlertsService } from '../wishlist-alerts/wishlist-alerts.service';
import { SmsService } from '../sms/sms.service';
import { OfferStatus } from '@prisma/client';

const flush = () => new Promise((r) => setTimeout(r, 0));
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);
const agoHours = (h: number) => new Date(Date.now() - h * 3_600_000);

// ───────────────────────────────────────────────────────────────────
// Offers: remind before an offer lapses (seller) / before the pay
// window lapses + strikes (buyer).
// ───────────────────────────────────────────────────────────────────
describe('OffersService.remindExpiring', () => {
  function makeService(over: { pending?: unknown[]; accepted?: unknown[] } = {}) {
    const prisma = {
      offer: {
        findMany: jest
          .fn()
          // 1st call = PENDING pass, 2nd = ACCEPTED pass.
          .mockResolvedValueOnce(over.pending ?? [])
          .mockResolvedValueOnce(over.accepted ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new OffersService(
      prisma as never,
      { resolveByEntity: jest.fn() } as never,
      { check: jest.fn() } as never,
      { mint: jest.fn().mockResolvedValue('tok') } as never,
      { record: jest.fn() } as never,
    );
    const remindSeller = jest
      .spyOn(
        service as never as Record<string, () => Promise<void>>,
        'remindSellerOfferExpiring' as never,
      )
      .mockResolvedValue(undefined as never);
    const remindBuyer = jest
      .spyOn(
        service as never as Record<string, () => Promise<void>>,
        'remindBuyerToPay' as never,
      )
      .mockResolvedValue(undefined as never);
    return { service, prisma, remindSeller, remindBuyer };
  }

  it('reminds the seller on a PENDING offer inside the 12h window', async () => {
    const { service, prisma, remindSeller } = makeService({
      pending: [{ id: 'O1', expiresAt: inHours(5) }],
    });
    const res = await service.remindExpiring();
    await flush();
    expect(res.reminded).toBe(1);
    expect(remindSeller).toHaveBeenCalledWith('O1');
    // Only PENDING rows with the guard still null are selected.
    expect(prisma.offer.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: OfferStatus.PENDING,
          sellerRemindedAt: null,
        }),
      }),
    );
  });

  it('reminds the buyer to pay on an ACCEPTED offer near the pay deadline', async () => {
    const { service, remindBuyer } = makeService({
      accepted: [{ id: 'O2' }],
    });
    const res = await service.remindExpiring();
    await flush();
    expect(res.reminded).toBe(1);
    expect(remindBuyer).toHaveBeenCalledWith('O2');
  });

  // The whole point of the guard: an overlapping cron run must not send a
  // second SMS. updateMany returning 0 = another run claimed it first.
  it('does NOT send when the CAS claim is lost to a concurrent run', async () => {
    const { service, prisma, remindSeller } = makeService({
      pending: [{ id: 'O1', expiresAt: inHours(5) }],
    });
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const res = await service.remindExpiring();
    await flush();
    expect(res.reminded).toBe(0);
    expect(remindSeller).not.toHaveBeenCalled();
  });

  it('claims with a status + guard-null WHERE so a decision mid-sweep wins', async () => {
    const { service, prisma } = makeService({
      pending: [{ id: 'O1', expiresAt: inHours(2) }],
    });
    await service.remindExpiring();
    expect(prisma.offer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'O1',
          status: OfferStatus.PENDING,
          sellerRemindedAt: null,
        }),
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────
// Offers: a PENDING lapse must now tell the SELLER too (they were
// previously never told they'd lost a real sale).
// ───────────────────────────────────────────────────────────────────
describe('OffersService.expireStale — seller is told about a lapse', () => {
  it('notifies BOTH sides when a PENDING offer expires', async () => {
    const prisma = {
      offer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'O1', status: OfferStatus.PENDING, buyerId: 'B1', listingId: 'L1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new OffersService(
      prisma as never,
      { resolveByEntity: jest.fn() } as never,
      { check: jest.fn() } as never,
      { mint: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
    const buyerSpy = jest
      .spyOn(
        service as never as Record<string, () => Promise<void>>,
        'notifyOfferExpired' as never,
      )
      .mockResolvedValue(undefined as never);
    const sellerSpy = jest
      .spyOn(
        service as never as Record<string, () => Promise<void>>,
        'notifyOfferExpiredSeller' as never,
      )
      .mockResolvedValue(undefined as never);
    await service.expireStale();
    await flush();
    expect(buyerSpy).toHaveBeenCalledWith('O1');
    expect(sellerSpy).toHaveBeenCalledWith('O1');
  });
});

// ───────────────────────────────────────────────────────────────────
// Auctions: nudge the winner before the unpaid-win STRIKE lands.
// ───────────────────────────────────────────────────────────────────
describe('AuctionsService.remindUnpaidWinners', () => {
  function makeService(rows: unknown[]) {
    const prisma = {
      listing: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AuctionsService(
      prisma as never,
      {} as never,
      { mint: jest.fn().mockResolvedValue('tok') } as never,
      { record: jest.fn() } as never,
    );
    const notify = jest
      .spyOn(
        service as never as Record<string, () => Promise<void>>,
        'notifyWinnerPayReminder' as never,
      )
      .mockResolvedValue(undefined as never);
    return { service, prisma, notify };
  }

  it('reminds a PAYMENT_PENDING winner whose window closes within 6h', async () => {
    const { service, prisma, notify } = makeService([
      { id: 'L1', currentBidderId: 'U1', currentBid: 250000 },
    ]);
    const res = await service.remindUnpaidWinners();
    await flush();
    expect(res.reminded).toBe(1);
    expect(notify).toHaveBeenCalledWith('U1', 'L1', 250000);
    // Population = exactly sweepUnpaidWins' population, one window earlier:
    // expiresAt STILL SET means checkout never started (checkout CAS-nulls it).
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({
      listingType: 'AUCTION',
      status: 'PAYMENT_PENDING',
      winnerRemindedAt: null,
    });
    expect(where.expiresAt).toMatchObject({ not: null });
  });

  it('skips a listing with no high bidder (nobody to remind)', async () => {
    const { service, notify } = makeService([
      { id: 'L1', currentBidderId: null, currentBid: null },
    ]);
    const res = await service.remindUnpaidWinners();
    expect(res.reminded).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends nothing when the CAS claim is lost (no double SMS)', async () => {
    const { service, prisma, notify } = makeService([
      { id: 'L1', currentBidderId: 'U1', currentBid: 1000 },
    ]);
    prisma.listing.updateMany.mockResolvedValue({ count: 0 });
    const res = await service.remindUnpaidWinners();
    await flush();
    expect(res.reminded).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// Courier: 48h confirm-receipt nudge (sits under the 72h admin alert).
// ───────────────────────────────────────────────────────────────────
describe('DispatchSlaService.nudgeUnconfirmedReceipt', () => {
  function makeService(rows: unknown[]) {
    const prisma = {
      transaction: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const notifications = { confirmReceiptNudgeBuyer: jest.fn().mockResolvedValue(undefined) };
    const service = new DispatchSlaService(
      prisma as never,
      {} as never,
      notifications as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, notifications };
  }

  const tx = {
    id: 'TX1',
    deliveredAt: agoHours(50),
    listing: { title: 'Rifle scope' },
    buyer: { email: 'b@x.co', firstName: 'Bo', lastName: 'Buyer', phone: '0830000000' },
  };

  it('nudges a buyer who never confirmed 48h after delivery', async () => {
    const { service, prisma, notifications } = makeService([tx]);
    const res = await service.nudgeUnconfirmedReceipt();
    expect(res.nudged).toBe(1);
    expect(notifications.confirmReceiptNudgeBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'TX1', listingTitle: 'Rifle scope' }),
    );
    // Money-critical scoping: HELD, unconfirmed, courier legs only, no swaps.
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentStatus: 'HELD',
          confirmedDeliveryAt: null,
          buyerConfirmNudgedAt: null,
          swapId: null,
          shippingMethod: { in: ['PUDO', 'TCG'] },
        }),
      }),
    );
  });

  it('is one-shot — a lost CAS claim sends nothing', async () => {
    const { service, prisma, notifications } = makeService([tx]);
    prisma.transaction.updateMany.mockResolvedValue({ count: 0 });
    const res = await service.nudgeUnconfirmedReceipt();
    expect(res.nudged).toBe(0);
    expect(notifications.confirmReceiptNudgeBuyer).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// Wishlist: ending-soon alert for saved auctions.
// ───────────────────────────────────────────────────────────────────
describe('WishlistAlertsService.sweepEndingSoonAuctions', () => {
  function makeService(rows: unknown[], watchers: string[]) {
    const prisma = {
      listing: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      watchedListing: {
        findMany: jest
          .fn()
          .mockResolvedValue(watchers.map((userId) => ({ userId }))),
      },
    };
    const notifications = { persist: jest.fn().mockResolvedValue(undefined) };
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const service = new WishlistAlertsService(
      prisma as never,
      notifications as never,
      push as never,
    );
    return { service, prisma, notifications };
  }

  const auction = {
    id: 'L1',
    title: 'Sako 85',
    sellerId: 'S1',
    currentBidderId: 'HIGH',
    endTime: inHours(0.5),
  };

  it('alerts watchers but NEVER the seller or the current high bidder', async () => {
    const { service, notifications } = makeService(
      [auction],
      ['W1', 'S1', 'HIGH', 'W2'],
    );
    const res = await service.sweepEndingSoonAuctions();
    expect(res.alerted).toBe(1);
    const notified = notifications.persist.mock.calls.map(
      (c) => (c[0] as { userId: string }).userId,
    );
    expect(notified.sort()).toEqual(['W1', 'W2']);
    expect(notified).not.toContain('S1');
    expect(notified).not.toContain('HIGH');
  });

  it('stamps the one-shot guard even with zero watchers (no re-scan every minute)', async () => {
    const { service, prisma } = makeService([auction], []);
    await service.sweepEndingSoonAuctions();
    expect(prisma.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'L1', endingSoonNotifiedAt: null },
      }),
    );
  });

  it('sends nothing when the guard was already claimed', async () => {
    const { service, prisma, notifications } = makeService([auction], ['W1']);
    prisma.listing.updateMany.mockResolvedValue({ count: 0 });
    const res = await service.sweepEndingSoonAuctions();
    expect(res.alerted).toBe(0);
    expect(notifications.persist).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// SMS: retry FAILED transport, but NEVER a time-sensitive OTP.
// ───────────────────────────────────────────────────────────────────
describe('SmsService retry eligibility + outage alert', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.SMSPORTAL_CLIENT_ID = 'id';
    process.env.SMSPORTAL_API_SECRET = 'secret';
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.restoreAllMocks();
  });

  function makePrisma() {
    return {
      smsLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      adminAlert: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it('marks an ordinary failed send retryable (PIN/waybill/reminder traffic)', async () => {
    const prisma = makePrisma();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'boom' }),
    }) as never;
    const svc = new SmsService(prisma as never);
    await svc.sendSms({ to: '0830000000', message: 'PIN 1234', reference: 'waybill-TX1' });
    expect(prisma.smsLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', retryable: true }),
      }),
    );
  });

  // A one-time code redelivered 20 minutes later is expired + confusing —
  // worse than never arriving. Phone-change OTPs must never queue.
  it('NEVER marks a phone-change OTP retryable', async () => {
    const prisma = makePrisma();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'boom' }),
    }) as never;
    const svc = new SmsService(prisma as never);
    await svc.sendSms({
      to: '0830000000',
      message: 'Your code is 123456',
      reference: 'phone-change-U1',
    });
    const data = (prisma.smsLog.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    }).data;
    expect(data.retryable).toBe(false);
    expect(data.nextRetryAt).toBeNull();
  });

  it('an explicit retryable:false overrides the prefix derivation', async () => {
    const prisma = makePrisma();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as never;
    const svc = new SmsService(prisma as never);
    await svc.sendSms({
      to: '0830000000',
      message: 'x',
      reference: 'offer-O1',
      retryable: false,
    });
    const data = (prisma.smsLog.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    }).data;
    expect(data.retryable).toBe(false);
  });

  it('retries a due row and clears the schedule once it sends', async () => {
    const prisma = makePrisma();
    prisma.smsLog.findMany.mockResolvedValueOnce([
      { id: 'S1', to: '+27830000000', message: 'PIN', attempts: 1 },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ messageId: 'm1' }] }),
    }) as never;
    const svc = new SmsService(prisma as never);
    const res = await svc.retryFailed();
    expect(res.sent).toBe(1);
    expect(prisma.smsLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'S1' },
        data: expect.objectContaining({ status: 'SENT', nextRetryAt: null }),
      }),
    );
  });

  it('gives up at the attempt cap instead of scheduling forever', async () => {
    const prisma = makePrisma();
    prisma.smsLog.findMany.mockResolvedValueOnce([
      { id: 'S1', to: '+27830000000', message: 'PIN', attempts: 2 },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'still down' }),
    }) as never;
    const svc = new SmsService(prisma as never);
    const res = await svc.retryFailed();
    expect(res.exhausted).toBe(1);
    expect(prisma.smsLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 3, nextRetryAt: null }),
      }),
    );
  });

  it('raises ONE outage alert when the last 5 sends all failed', async () => {
    const prisma = makePrisma();
    // No retry work; the outage check runs on the recent-send window.
    prisma.smsLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array(5).fill({ status: 'FAILED' }));
    const svc = new SmsService(prisma as never);
    await svc.retryFailed();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SMS_OUTAGE' }),
      }),
    );
  });

  it('stays quiet when a recent send succeeded (not an outage)', async () => {
    const prisma = makePrisma();
    prisma.smsLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { status: 'SENT' },
        ...Array(4).fill({ status: 'FAILED' }),
      ]);
    const svc = new SmsService(prisma as never);
    await svc.retryFailed();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('does not re-alert while an unresolved outage alert exists', async () => {
    const prisma = makePrisma();
    prisma.smsLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array(5).fill({ status: 'FAILED' }));
    prisma.adminAlert.count.mockResolvedValue(1);
    const svc = new SmsService(prisma as never);
    await svc.retryFailed();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// Auctions: offer an expired win to the runner-up (BIG-2). This
// PROMOTES a listing back into a payable state with a different buyer
// and a fresh money window, so the guards matter more than the copy.
// ───────────────────────────────────────────────────────────────────
describe('AuctionsService.offerToRunnerUp', () => {
  function makeService(over: {
    listing?: Record<string, unknown> | null;
    bidder?: Record<string, unknown> | null;
    claimCount?: number;
  } = {}) {
    const prisma = {
      listing: {
        findUnique: jest.fn().mockResolvedValue(
          over.listing === undefined
            ? { id: 'L1', status: 'EXPIRED', sellerId: 'S1' }
            : over.listing,
        ),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: over.claimCount ?? 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(
          over.bidder === undefined
            ? { id: 'U2', isBanned: false, auctionStrikes: 0 }
            : over.bidder,
        ),
      },
      bid: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AuctionsService(
      prisma as never,
      {} as never,
      { mint: jest.fn().mockResolvedValue('tok') } as never,
      { record: jest.fn() } as never,
    );
    const notify = jest
      .spyOn(
        service as never as Record<string, () => Promise<void>>,
        'notifyAuctionWon' as never,
      )
      .mockResolvedValue(undefined as never);
    return { service, prisma, notify };
  }

  it('promotes EXPIRED → PAYMENT_PENDING with the runner-up and a fresh window', async () => {
    const { service, prisma, notify } = makeService();
    const res = await service.offerToRunnerUp('L1', 'S1', 'U2', 250000);
    await flush();
    expect(res.offered).toBe(true);
    const call = prisma.listing.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // CAS on EXPIRED: a relist racing the accept, or a double-tap of the
    // SMS link, can only ever produce ONE promotion.
    expect(call.where).toMatchObject({ id: 'L1', status: 'EXPIRED' });
    expect(call.data).toMatchObject({
      status: 'PAYMENT_PENDING',
      currentBidderId: 'U2',
      currentBid: 250000,
      // Fresh window ⇒ the pay-window nudge must be eligible again.
      winnerRemindedAt: null,
    });
    expect(call.data.expiresAt).toBeInstanceOf(Date);
    // Reuses the normal win machinery so sweepUnpaidWins polices window 2.
    expect(notify).toHaveBeenCalledWith('U2', 'L1', 250000);
  });

  it('refuses when the seller already relisted (status no longer EXPIRED)', async () => {
    const { service, prisma, notify } = makeService({
      listing: { id: 'L1', status: 'ACTIVE', sellerId: 'S1' },
    });
    const res = await service.offerToRunnerUp('L1', 'S1', 'U2', 1000);
    expect(res.offered).toBe(false);
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not the seller', async () => {
    const { service, prisma } = makeService();
    const res = await service.offerToRunnerUp('L1', 'SOMEONE_ELSE', 'U2', 1000);
    expect(res.offered).toBe(false);
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  // Promoting a banned or struck-out bidder would create a sale they are
  // barred from paying for — re-checked at ACCEPT time, not just at send.
  it('refuses a banned runner-up', async () => {
    const { service, prisma } = makeService({
      bidder: { id: 'U2', isBanned: true, auctionStrikes: 0 },
    });
    const res = await service.offerToRunnerUp('L1', 'S1', 'U2', 1000);
    expect(res.offered).toBe(false);
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a runner-up already at the 3-strike bidding ban', async () => {
    const { service, prisma } = makeService({
      bidder: { id: 'U2', isBanned: false, auctionStrikes: 3 },
    });
    const res = await service.offerToRunnerUp('L1', 'S1', 'U2', 1000);
    expect(res.offered).toBe(false);
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it('notifies nobody when the CAS claim is lost', async () => {
    const { service, notify } = makeService({ claimCount: 0 });
    const res = await service.offerToRunnerUp('L1', 'S1', 'U2', 1000);
    await flush();
    expect(res.offered).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
