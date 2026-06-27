import { FraudRiskService } from './fraud-risk.service';

describe('FraudRiskService.evaluate', () => {
  let prisma: {
    transaction: { findUnique: jest.Mock; count: jest.Mock; update: jest.Mock };
    contactDetailRejection: { count: jest.Mock };
    user: { count: jest.Mock };
  };
  let service: FraudRiskService;

  const now = new Date('2026-06-20T10:00:00Z');

  function setup(opts: {
    accountAgeDays: number;
    buyerTotal: number;
    phone?: string | null;
    paidCount: number;
    rapidCount: number;
    contactViolations: number;
    sharedPhone: number;
  }) {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'TX',
      buyerId: 'B',
      buyerTotal: opts.buyerTotal,
      createdAt: now,
      buyer: {
        id: 'B',
        createdAt: new Date(now.getTime() - opts.accountAgeDays * 86400000),
        phone: opts.phone ?? null,
      },
    });
    // Promise.all order: paidCount, rapidCount (both transaction.count)…
    prisma.transaction.count
      .mockResolvedValueOnce(opts.paidCount)
      .mockResolvedValueOnce(opts.rapidCount);
    prisma.contactDetailRejection.count.mockResolvedValue(opts.contactViolations);
    prisma.user.count.mockResolvedValue(opts.sharedPhone);
  }

  beforeEach(() => {
    prisma = {
      transaction: {
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      contactDetailRejection: { count: jest.fn() },
      user: { count: jest.fn() },
    };
    service = new FraudRiskService(prisma as never);
  });

  it('flags a new account making a high-value first order', async () => {
    setup({
      accountAgeDays: 1,
      buyerTotal: 800_000, // R8 000 > R5 000
      paidCount: 1, // this is their first
      rapidCount: 1,
      contactViolations: 0,
      sharedPhone: 0,
    });
    await service.evaluate('TX');
    const data = prisma.transaction.update.mock.calls[0][0].data;
    expect(data.riskFlags).toEqual(
      expect.arrayContaining(['new_account', 'high_value_first_order']),
    );
    expect(data.riskScore).toBe(50); // 20 + 30
  });

  it('scores an established, normal order at 0', async () => {
    setup({
      accountAgeDays: 200,
      buyerTotal: 120_000,
      paidCount: 12,
      rapidCount: 1,
      contactViolations: 0,
      sharedPhone: 0,
    });
    await service.evaluate('TX');
    const data = prisma.transaction.update.mock.calls[0][0].data;
    expect(data.riskFlags).toEqual([]);
    expect(data.riskScore).toBe(0);
  });

  it('flags rapid repeat orders + shared phone + contact violations', async () => {
    setup({
      accountAgeDays: 90,
      buyerTotal: 50_000,
      phone: '+27820000000',
      paidCount: 5,
      rapidCount: 4, // >= 3
      contactViolations: 2,
      sharedPhone: 1,
    });
    await service.evaluate('TX');
    const data = prisma.transaction.update.mock.calls[0][0].data;
    expect(data.riskFlags).toEqual(
      expect.arrayContaining([
        'rapid_repeat_orders',
        'contact_violations',
        'shared_phone',
      ]),
    );
    expect(data.riskScore).toBe(70); // 25 + 20 + 25
  });

  it('never throws on a missing transaction', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);
    await expect(service.evaluate('nope')).resolves.toBeUndefined();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });
});
