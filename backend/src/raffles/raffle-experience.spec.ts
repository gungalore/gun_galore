// EXP-E5 — Raffle prize AS EXPERIENCE. Unit-tests the additive experience path
// on RafflesService, mirroring prizeIsFirearm exactly:
//   • create() persists prizeIsExperience + metadata;
//   • a subscriber raffle FORCES prizeIsExperience false;
//   • claimPrize() experience gate requires the 18+/risk/licence + contact +
//     preferred-date attestations;
//   • markWinnerPrizeDispatched() hard-rejects an experience prize;
//   • markWinnerExperienceFulfilled() happy + idempotent + forfeit guard;
//   • settleSponsor() idempotent (double-settle refused).
//
// RafflesService imports PAYMENT_MODE from transactions.service, which
// transitively pulls ESM-only meilisearch; stub it so ts-jest doesn't choke
// (same as the payments sibling specs). PAYMENT_MODE defaults to 'manual' in
// tests (no PAYMENT_MODE=paygate env), which is what settleSponsor requires.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { RafflesService } from './raffles.service';

const DAY = 24 * 60 * 60 * 1000;

// A minimal mocked Prisma + collaborators. Each test overrides just what it
// needs via `over`. Returns the service plus capture arrays for assertions.
function makeService(
  over: {
    raffle?: Record<string, unknown> | null;
    winner?: Record<string, unknown> | null;
    user?: Record<string, unknown> | null;
    listing?: Record<string, unknown> | null;
    raffleUpdateManyCount?: number;
  } = {},
) {
  const raffleCreates: Array<Record<string, unknown>> = [];
  const raffleUpdateManys: Array<Record<string, unknown>> = [];
  const winnerUpdates: Array<Record<string, unknown>> = [];
  const txCreates: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  const raffleUpdateManyCount = over.raffleUpdateManyCount ?? 1;

  const txClient = {
    raffle: {
      updateMany: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        raffleUpdateManys.push(args);
        return Promise.resolve({ count: raffleUpdateManyCount });
      }),
    },
    transaction: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        txCreates.push(args.data);
        return Promise.resolve({ id: 'SETTLE_TX1', ...args.data });
      }),
    },
  };

  const prisma = {
    raffle: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        raffleCreates.push(args.data);
        return Promise.resolve({ id: 'R1', status: 'DRAFT', ...args.data });
      }),
      findUnique: jest.fn().mockResolvedValue(over.raffle ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        raffleUpdateManys.push(args);
        return Promise.resolve({ count: raffleUpdateManyCount });
      }),
    },
    raffleWinner: {
      findUnique: jest.fn().mockResolvedValue(over.winner ?? null),
      update: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        winnerUpdates.push(args);
        return Promise.resolve({ id: 'W1' });
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(over.user ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    listing: {
      findFirst: jest.fn().mockResolvedValue(over.listing ?? null),
    },
    ticket: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    transaction: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        txCreates.push(args.data);
        return Promise.resolve({ id: 'SETTLE_TX1', ...args.data });
      }),
    },
    raffleAuditEvent: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        auditEvents.push(args.data);
        return Promise.resolve({});
      }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (c: typeof txClient) => unknown) => cb(txClient)),
  };

  const notifications = {
    raffleExperienceFulfilled: jest.fn().mockResolvedValue(undefined),
    raffleWinnerPrizeDispatched: jest.fn().mockResolvedValue(undefined),
  };
  const cloudinary = {};
  const stitch = { isConfigured: false };
  const referenceNumbers = {
    allocateForRaffle: jest.fn().mockResolvedValue('RA000001'),
  };
  const zohoBooks = {};

  const service = new RafflesService(
    prisma as never,
    notifications as never,
    cloudinary as never,
    stitch as never,
    referenceNumbers as never,
    zohoBooks as never,
  );

  return {
    service,
    prisma,
    notifications,
    raffleCreates,
    raffleUpdateManys,
    winnerUpdates,
    txCreates,
    auditEvents,
  };
}

// A valid public-raffle create DTO with the experience prize flags set.
function experienceDto(over: Record<string, unknown> = {}) {
  return {
    title: 'Kudu hunt raffle',
    description: 'Win a guided plains-game hunt with a vetted outfitter.',
    itemValueCents: 2_500_000,
    itemCostCents: 0,
    ticketPriceCents: 5000,
    question: 'What is 2 + 2?',
    optionA: 'One',
    optionB: 'Two',
    optionC: 'Four',
    optionD: 'Five',
    startTime: new Date(Date.now() + DAY).toISOString(),
    prizeIsExperience: true,
    experienceType: 'PLAINS_GAME_HUNT',
    eventStartDate: new Date(Date.now() + 60 * DAY).toISOString(),
    eventProvince: 'LIMPOPO',
    locationText: 'Waterberg, Limpopo',
    durationText: '3 days / 2 nights',
    speciesList: ['Kudu', 'Impala'],
    whatsIncluded: 'PH, accommodation, field prep',
    rifleProvided: true,
    sponsorUserId: 'SPON1',
    sponsorSettlementCents: 1_800_000,
    ...over,
  };
}

// ─── create() ────────────────────────────────────────────────────────────────
describe('EXP-E5 create — prizeIsExperience', () => {
  it('persists prizeIsExperience true + the package metadata + sponsor fields', async () => {
    const { service, raffleCreates } = makeService();
    await service.create('admin1', experienceDto() as never);

    const data = raffleCreates[0];
    expect(data.prizeIsExperience).toBe(true);
    expect(data.experienceType).toBe('PLAINS_GAME_HUNT');
    expect(data.eventProvince).toBe('LIMPOPO');
    expect(data.locationText).toBe('Waterberg, Limpopo');
    expect(data.durationText).toBe('3 days / 2 nights');
    expect(data.speciesList).toEqual(['Kudu', 'Impala']);
    expect(data.whatsIncluded).toBe('PH, accommodation, field prep');
    expect(data.rifleProvided).toBe(true);
    expect(data.eventStartDate).toBeInstanceOf(Date);
    expect(data.sponsorUserId).toBe('SPON1');
    expect(data.sponsorSettlementCents).toBe(1_800_000);
  });

  it('subscriber raffle FORCES prizeIsExperience false + drops the metadata/sponsor', async () => {
    const { service, raffleCreates } = makeService();
    await service.create(
      'admin1',
      experienceDto({
        subscriberTierRestriction: 'MEMBER',
        // subscriber raffles have 0 economics
        itemValueCents: 0,
        ticketPriceCents: 0,
      }) as never,
    );

    const data = raffleCreates[0];
    expect(data.prizeIsExperience).toBe(false);
    expect(data.experienceType).toBeNull();
    expect(data.eventProvince).toBeNull();
    expect(data.sponsorUserId).toBeNull();
    expect(data.sponsorSettlementCents).toBeNull();
    expect(data.speciesList).toEqual([]);
    expect(data.rifleProvided).toBe(false);
  });

  it('a non-experience public raffle never carries stray experience metadata', async () => {
    const { service, raffleCreates } = makeService();
    await service.create(
      'admin1',
      experienceDto({
        prizeIsExperience: false,
        // stray values that must be dropped because the flag is off
        experienceType: 'RANGE_DAY',
        sponsorUserId: 'SPON1',
        sponsorSettlementCents: 999,
      }) as never,
    );
    const data = raffleCreates[0];
    expect(data.prizeIsExperience).toBe(false);
    expect(data.experienceType).toBeNull();
    expect(data.sponsorUserId).toBeNull();
    expect(data.sponsorSettlementCents).toBeNull();
  });
});

// ─── claimPrize() experience gate ────────────────────────────────────────────
describe('EXP-E5 claimPrize — experience attestation gate', () => {
  const baseWinner = () => ({
    id: 'W1',
    userId: 'U1',
    raffleId: 'R1',
    position: 1,
    claimedAt: null,
    forfeitedAt: null,
    claimDeadline: new Date(Date.now() + 5 * DAY),
    raffle: { prizeIsFirearm: false, prizeIsExperience: true },
  });

  it('rejects the claim when the experience attestation is missing', async () => {
    const { service } = makeService({
      user: { id: 'U1', clerkId: 'clerk_u' },
      winner: baseWinner(),
    });
    await expect(
      service.claimPrize('clerk_u', 'W1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when 18+/risk/licence is unticked even if contact + date are given', async () => {
    const { service } = makeService({
      user: { id: 'U1', clerkId: 'clerk_u' },
      winner: baseWinner(),
    });
    await expect(
      service.claimPrize('clerk_u', 'W1', {
        experience: {
          ageRiskAndLicenceAccepted: false,
          contactConfirmed: true,
          preferredDate: new Date(Date.now() + 90 * DAY).toISOString(),
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the preferred date is missing', async () => {
    const { service } = makeService({
      user: { id: 'U1', clerkId: 'clerk_u' },
      winner: baseWinner(),
    });
    await expect(
      service.claimPrize('clerk_u', 'W1', {
        experience: {
          ageRiskAndLicenceAccepted: true,
          contactConfirmed: true,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts + persists the attestation columns when all three are supplied', async () => {
    const { service, winnerUpdates } = makeService({
      user: { id: 'U1', clerkId: 'clerk_u' },
      winner: baseWinner(),
    });
    const preferred = new Date(Date.now() + 90 * DAY);
    const res = await service.claimPrize('clerk_u', 'W1', {
      experience: {
        ageRiskAndLicenceAccepted: true,
        contactConfirmed: true,
        preferredDate: preferred.toISOString(),
      },
    });
    expect(res.claimedAt).toBeInstanceOf(Date);

    const data = winnerUpdates[0].data as Record<string, unknown>;
    expect(data.winnerExperienceAttestedAt).toBeInstanceOf(Date);
    expect(data.winnerContactConfirmedAt).toBeInstanceOf(Date);
    expect((data.winnerPreferredDate as Date).getTime()).toBe(preferred.getTime());
  });
});

// ─── markWinnerPrizeDispatched() rejects experience ──────────────────────────
describe('EXP-E5 markWinnerPrizeDispatched — rejects experience prizes', () => {
  it('refuses to courier-dispatch an experience prize', async () => {
    const { service } = makeService({
      winner: {
        id: 'W1',
        userId: 'U1',
        raffleId: 'R1',
        ticketId: 'T1',
        position: 1,
        prizeDispatchedAt: null,
        forfeitedAt: null,
        user: { id: 'U1', email: 'w@x.co', phone: null, username: 'winner' },
        raffle: {
          id: 'R1',
          title: 'Kudu hunt',
          prizeIsFirearm: false,
          prizeIsExperience: true,
        },
      },
    });
    await expect(
      service.markWinnerPrizeDispatched('W1', 'admin1', { trackingRef: 'ABC123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── markWinnerExperienceFulfilled() ─────────────────────────────────────────
describe('EXP-E5 markWinnerExperienceFulfilled', () => {
  const fulfilWinner = (over: Record<string, unknown> = {}) => ({
    id: 'W1',
    userId: 'U1',
    raffleId: 'R1',
    ticketId: 'T1',
    position: 1,
    experienceFulfilledAt: null,
    forfeitedAt: null,
    user: { id: 'U1', email: 'w@x.co', phone: '0821234567', username: 'winner' },
    raffle: { id: 'R1', title: 'Kudu hunt', prizeIsExperience: true },
    ...over,
  });

  it('happy path — stamps fulfilment + audits EXPERIENCE_FULFILLED + notifies', async () => {
    const { service, winnerUpdates, auditEvents, notifications } = makeService({
      winner: fulfilWinner(),
    });
    const res = await service.markWinnerExperienceFulfilled('W1', 'admin1', {
      note: 'Kudu taken cleanly',
    });
    expect(res.experienceFulfilledAt).toBeInstanceOf(Date);

    const data = winnerUpdates[0].data as Record<string, unknown>;
    expect(data.experienceFulfilledAt).toBeInstanceOf(Date);
    expect(data.experienceFulfilledByAdminId).toBe('admin1');
    expect(data.experienceFulfilmentNote).toBe('Kudu taken cleanly');

    expect(auditEvents.some((e) => e.eventType === 'EXPERIENCE_FULFILLED')).toBe(true);
    expect(notifications.raffleExperienceFulfilled).toHaveBeenCalledTimes(1);
  });

  it('idempotent — refuses when already fulfilled', async () => {
    const { service } = makeService({
      winner: fulfilWinner({ experienceFulfilledAt: new Date() }),
    });
    await expect(
      service.markWinnerExperienceFulfilled('W1', 'admin1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forfeit guard — refuses when the winner has forfeited', async () => {
    const { service } = makeService({
      winner: fulfilWinner({ forfeitedAt: new Date() }),
    });
    await expect(
      service.markWinnerExperienceFulfilled('W1', 'admin1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when the prize is not an experience', async () => {
    const { service } = makeService({
      winner: fulfilWinner({
        raffle: { id: 'R1', title: 'Rifle', prizeIsExperience: false },
      }),
    });
    await expect(
      service.markWinnerExperienceFulfilled('W1', 'admin1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── settleSponsor() ─────────────────────────────────────────────────────────
describe('EXP-E5 settleSponsor', () => {
  const sponsorRaffle = (over: Record<string, unknown> = {}) => ({
    id: 'R1',
    title: 'Kudu hunt raffle',
    referenceNumber: 'RA000001',
    prizeIsExperience: true,
    sponsorUserId: 'SPON1',
    sponsorSettlementCents: 1_800_000,
    sponsorSettledAt: null,
    sponsorSettlementRef: null,
    ...over,
  });

  it('happy path — mints a synthetic RELEASED payout tx + stamps the raffle', async () => {
    const { service, txCreates, raffleUpdateManys } = makeService({
      raffle: sponsorRaffle(),
      listing: { id: 'L1' },
    });
    const res = await service.settleSponsor('R1', 'admin1');

    expect(res.sponsorSettlementRef).toBe('SPON-RA000001');
    // The exactly-once CAS stamp.
    expect(
      raffleUpdateManys.some(
        (u) => (u.where as Record<string, unknown>).sponsorSettledAt === null,
      ),
    ).toBe(true);
    // The synthetic RELEASED payout tx the FNB batch will sweep.
    const tx = txCreates[0];
    expect(tx.paymentStatus).toBe('RELEASED');
    expect(tx.sellerId).toBe('SPON1');
    expect(tx.sellerPayout).toBe(1_800_000);
    expect(tx.releasedAt).toBeInstanceOf(Date);
  });

  it('idempotent — refuses when already settled', async () => {
    const { service, txCreates } = makeService({
      raffle: sponsorRaffle({ sponsorSettledAt: new Date() }),
      listing: { id: 'L1' },
    });
    await expect(service.settleSponsor('R1', 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No phantom EFT queued on the idempotent-refuse path.
    expect(txCreates).toHaveLength(0);
  });

  it('refuses when the raffle is not an experience prize', async () => {
    const { service } = makeService({
      raffle: sponsorRaffle({ prizeIsExperience: false }),
    });
    await expect(service.settleSponsor('R1', 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses when there is no sponsor to settle', async () => {
    const { service } = makeService({
      raffle: sponsorRaffle({ sponsorUserId: null }),
    });
    await expect(service.settleSponsor('R1', 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
