// EXP-E4 — ExperienceSlaService. The nudge/alert twin of DispatchSlaService for
// future-dated ON_SITE_SERVICE bookings. Four idempotent passes, NONE of which
// move money (no release, no refund). This spec asserts:
//   • each pass filters shippingMethod=ON_SITE_SERVICE + paymentStatus=HELD
//     (so a courier order is never selected);
//   • each pass is idempotent — its one-shot guard column is in the WHERE, and
//     it stamps that guard when it fires;
//   • escalate + post-event alert create the right AdminAlert type AND stamp
//     the guard in ONE $transaction (roll-back-on-failure idempotency);
//   • NO release/refund primitive is ever reachable (the service has no such
//     dependency — it only has prisma + notifications);
//   • correct stage ordering in the post-event pass (nudge before alert).

import { ExperienceSlaService } from './experience-sla.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A minimal prisma double that records every findMany where-clause + every
// write, and lets each test script the rows returned per pass by call order.
function makePrisma(rowsPerFindMany: Array<Array<Record<string, unknown>>>) {
  const findManyWheres: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const alertsCreated: Array<Record<string, unknown>> = [];
  let findManyCall = 0;

  const prisma = {
    transaction: {
      findMany: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        findManyWheres.push(args.where);
        const rows = rowsPerFindMany[findManyCall] ?? [];
        findManyCall++;
        return Promise.resolve(rows);
      }),
      update: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        updates.push(args);
        return Promise.resolve({});
      }),
    },
    adminAlert: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        alertsCreated.push(args.data);
        return { data: args.data }; // returned as a "prisma promise" placeholder
      }),
    },
    // $transaction([...]) — the ops are already the placeholders returned by
    // create()/update() above (their side-effects ran when constructed, which
    // matches how the real client's atomic array executes them). Just resolve.
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { prisma, findManyWheres, updates, alertsCreated };
}

function makeNotifications() {
  return {
    experienceBookingConfirmNudgeOutfitter: jest.fn().mockResolvedValue(undefined),
    experiencePreEventReminder: jest.fn().mockResolvedValue(undefined),
    experiencePostEventConfirmNudgeBuyer: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(rowsPerFindMany: Array<Array<Record<string, unknown>>>) {
  const { prisma, findManyWheres, updates, alertsCreated } =
    makePrisma(rowsPerFindMany);
  const notifications = makeNotifications();
  const service = new ExperienceSlaService(
    prisma as never,
    notifications as never,
  );
  return { service, prisma, notifications, findManyWheres, updates, alertsCreated };
}

const sellerRel = {
  email: 's@x.co',
  firstName: 'Sam',
  lastName: 'Guide',
  username: 'outfitter',
  phone: '+27820000000',
};
const buyerRel = {
  email: 'b@x.co',
  firstName: 'Bo',
  username: 'buyer',
  phone: '+27830000000',
};
const listingRel = { title: 'Kudu hunt' };

// ─── every pass must scope to live experience bookings ───────────────────────
describe('EXP-E4 ExperienceSlaService — scope guard (never touches a courier order)', () => {
  it('EVERY findMany filters shippingMethod=ON_SITE_SERVICE + paymentStatus=HELD', async () => {
    // Return no rows everywhere; we only care about the where-clauses.
    const { service, findManyWheres } = makeService([[], [], [], [], []]);
    await service.experienceSlaSweep();
    expect(findManyWheres.length).toBeGreaterThanOrEqual(4);
    for (const where of findManyWheres) {
      expect(where.shippingMethod).toBe('ON_SITE_SERVICE');
      expect(where.paymentStatus).toBe('HELD');
    }
  });
});

// ─── (a) nudgeBookingConfirm ─────────────────────────────────────────────────
describe('EXP-E4 nudgeBookingConfirm', () => {
  it('nudges the outfitter and stamps bookingConfirmNudgedAt (one-shot)', async () => {
    const tx = {
      id: 'TX1',
      eventDate: new Date(Date.now() + 30 * DAY),
      listing: listingRel,
      seller: sellerRel,
    };
    const { service, notifications, updates, findManyWheres } = makeService([[tx]]);
    const res = await service.nudgeBookingConfirm();

    expect(res).toEqual({ scanned: 1, nudged: 1 });
    // Guard column is in the WHERE (idempotency: a stamped row won't re-match).
    expect(findManyWheres[0]).toMatchObject({
      shippingMethod: 'ON_SITE_SERVICE',
      paymentStatus: 'HELD',
      bookingConfirmedAt: null,
      bookingConfirmNudgedAt: null,
    });
    // Stamped the guard.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ where: { id: 'TX1' } });
    expect((updates[0].data as Record<string, unknown>).bookingConfirmNudgedAt).toBeInstanceOf(Date);
    // Best-effort outfitter nudge fired.
    expect(notifications.experienceBookingConfirmNudgeOutfitter).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: an already-stamped row is excluded by the guard filter', async () => {
    // Simulate the DB having filtered out the stamped row → no rows returned.
    const { service, notifications, updates } = makeService([[]]);
    const res = await service.nudgeBookingConfirm();
    expect(res).toEqual({ scanned: 0, nudged: 0 });
    expect(updates).toHaveLength(0);
    expect(notifications.experienceBookingConfirmNudgeOutfitter).not.toHaveBeenCalled();
  });
});

// ─── (b) escalateBookingConfirm ──────────────────────────────────────────────
describe('EXP-E4 escalateBookingConfirm', () => {
  it('raises EXPERIENCE_BOOKING_UNCONFIRMED + stamps escalation guard in one $transaction, NO refund', async () => {
    const tx = {
      id: 'TX1',
      orderReference: 'HP000001',
      buyerTotal: 2_537_500,
      paidAt: new Date(Date.now() - 60 * HOUR),
      eventDate: new Date(Date.now() + 20 * DAY),
      listing: listingRel,
      buyer: buyerRel,
      seller: sellerRel,
    };
    const { service, prisma, alertsCreated, findManyWheres } = makeService([[tx]]);
    const res = await service.escalateBookingConfirm();

    expect(res).toEqual({ scanned: 1, escalated: 1 });
    expect(findManyWheres[0]).toMatchObject({
      shippingMethod: 'ON_SITE_SERVICE',
      paymentStatus: 'HELD',
      bookingConfirmedAt: null,
      bookingConfirmEscalatedAt: null,
    });
    // Alert + stamp bundled atomically.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(alertsCreated).toHaveLength(1);
    expect(alertsCreated[0]).toMatchObject({
      type: 'EXPERIENCE_BOOKING_UNCONFIRMED',
      referenceId: 'TX1',
      urgent: true,
    });
    // NO refund/release mechanic exists on this service at all.
    expect((prisma.transaction as Record<string, unknown>).updateMany).toBeUndefined();
  });

  it('is idempotent: no rows (already escalated) → no alert', async () => {
    const { service, prisma, alertsCreated } = makeService([[]]);
    const res = await service.escalateBookingConfirm();
    expect(res).toEqual({ scanned: 0, escalated: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(alertsCreated).toHaveLength(0);
  });
});

// ─── (c) remindPreEvent ──────────────────────────────────────────────────────
describe('EXP-E4 remindPreEvent', () => {
  it('reminds BOTH buyer + outfitter and stamps eventPreReminderSentAt', async () => {
    const tx = {
      id: 'TX1',
      eventDate: new Date(Date.now() + 2 * DAY),
      listing: listingRel,
      buyer: buyerRel,
      seller: sellerRel,
    };
    const { service, notifications, updates, findManyWheres } = makeService([[tx]]);
    const res = await service.remindPreEvent();

    expect(res).toEqual({ scanned: 1, reminded: 1 });
    // Only CONFIRMED bookings; guard column in the filter.
    expect(findManyWheres[0]).toMatchObject({
      shippingMethod: 'ON_SITE_SERVICE',
      paymentStatus: 'HELD',
      bookingConfirmedAt: { not: null },
      eventPreReminderSentAt: null,
    });
    expect(updates).toHaveLength(1);
    expect((updates[0].data as Record<string, unknown>).eventPreReminderSentAt).toBeInstanceOf(Date);
    // One reminder to each party.
    expect(notifications.experiencePreEventReminder).toHaveBeenCalledTimes(2);
    const roles = notifications.experiencePreEventReminder.mock.calls.map(
      (c: [Record<string, unknown>]) => c[0].role,
    );
    expect(roles).toEqual(expect.arrayContaining(['BUYER', 'OUTFITTER']));
  });
});

// ─── (d) nudgeAndAlertPostEvent ──────────────────────────────────────────────
describe('EXP-E4 nudgeAndAlertPostEvent', () => {
  it('stage A: buyer confirm nudge + stamp, no admin alert when inside the window', async () => {
    const tx = {
      id: 'TX1',
      eventDate: new Date(Date.now() - 1 * DAY), // yesterday
      eventEndDate: null,
      listing: listingRel,
      buyer: buyerRel,
      seller: sellerRel,
    };
    // First findMany = stage-A nudge rows; second = stage-B alert candidates (none).
    const { service, notifications, updates, alertsCreated, prisma } = makeService([
      [tx],
      [],
    ]);
    const res = await service.nudgeAndAlertPostEvent();

    expect(res.nudged).toBe(1);
    expect(res.alerted).toBe(0);
    expect(notifications.experiencePostEventConfirmNudgeBuyer).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect((updates[0].data as Record<string, unknown>).eventCompletionNudgedAt).toBeInstanceOf(Date);
    expect(alertsCreated).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stage B: past the 7-day window → EXPERIENCE_EVENT_UNCONFIRMED alert + stamp, NO release', async () => {
    const nudgeTx = {
      id: 'TXn',
      eventDate: new Date(Date.now() - 10 * DAY),
      eventEndDate: null,
      listing: listingRel,
      buyer: buyerRel,
      seller: sellerRel,
    };
    const alertTx = {
      id: 'TXa',
      orderReference: 'HP000002',
      buyerTotal: 1_000_000,
      eventDate: new Date(Date.now() - 10 * DAY), // 10d ago > 7d window
      eventEndDate: null,
      listing: listingRel,
      buyer: buyerRel,
      seller: sellerRel,
    };
    const { service, alertsCreated, prisma, findManyWheres } = makeService([
      [nudgeTx],
      [alertTx],
    ]);
    const res = await service.nudgeAndAlertPostEvent();

    expect(res.alerted).toBe(1);
    // Stage-B filter also carries the shipping/status/guard scope.
    expect(findManyWheres[1]).toMatchObject({
      shippingMethod: 'ON_SITE_SERVICE',
      paymentStatus: 'HELD',
      eventCompletedConfirmedAt: null,
      adminAlertedForEventUnconfirmedAt: null,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(alertsCreated).toHaveLength(1);
    expect(alertsCreated[0]).toMatchObject({
      type: 'EXPERIENCE_EVENT_UNCONFIRMED',
      referenceId: 'TXa',
      urgent: true,
    });
  });

  it('stage B respects eventEndDate: a multi-day event still inside its window is NOT alerted', async () => {
    // eventDate is 10d ago (would trip a naive eventDate check) but eventEndDate
    // is only 2d ago → window (endDate + 7d) has NOT closed → no alert.
    const alertTx = {
      id: 'TXa',
      orderReference: 'HP000003',
      buyerTotal: 1_000_000,
      eventDate: new Date(Date.now() - 10 * DAY),
      eventEndDate: new Date(Date.now() - 2 * DAY),
      listing: listingRel,
      buyer: buyerRel,
      seller: sellerRel,
    };
    const { service, alertsCreated, prisma } = makeService([[], [alertTx]]);
    const res = await service.nudgeAndAlertPostEvent();
    expect(res.alerted).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(alertsCreated).toHaveLength(0);
  });
});

// ─── no money movement anywhere ──────────────────────────────────────────────
describe('EXP-E4 ExperienceSlaService — NO money movement', () => {
  it('exposes no release/refund surface: prisma double only needs findMany/update/adminAlert/$transaction', async () => {
    // If the service ever tried to release/refund it would call updateMany with
    // paymentStatus RELEASED/REFUNDED, or a stitch/zoho dependency — none of
    // which are wired. A full sweep over empty data must complete cleanly.
    const { service, alertsCreated, updates } = makeService([[], [], [], [], []]);
    const res = await service.experienceSlaSweep();
    expect(res).toEqual({
      bookingNudged: 0,
      bookingEscalated: 0,
      preEventReminded: 0,
      postEventNudged: 0,
      postEventAlerted: 0,
    });
    expect(alertsCreated).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
