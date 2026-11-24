// A BANV result that never reaches us (webhook missed or signature-unverified)
// leaves bankVerifiedAt NULL, which silently holds the seller's payout once
// Peach payouts are enabled. This sweep re-reads the result from the Payouts
// API — it can never be forged into a pass.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

function makeService(opts: {
  pending?: { id: string; bankVerificationId: string | null }[];
  verifiedAfter?: boolean;
  configured?: boolean;
}) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(opts.pending ?? []),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.verifiedAfter ? { bankVerifiedAt: new Date() } : { bankVerifiedAt: null },
        ),
    },
  };
  const peach = {
    isPayoutsConfigured: () => opts.configured !== false,
  };
  const service = new TransactionsService(
    prisma as never, // prisma
    {} as never, // fees
    {} as never, // notifications
    {} as never, // ozow
    {} as never, // kyc
    {} as never, // shipping
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
    undefined, // dealerPortal
    undefined, // rails
    peach as never,
  );
  const handler = jest
    .spyOn(service, 'handlePeachBanvWebhook')
    .mockResolvedValue(undefined);
  return { service, prisma, handler };
}

describe('Peach BANV reconcile sweep', () => {
  it('polls every pending verification and reports the passes', async () => {
    const { service, handler } = makeService({
      pending: [
        { id: 'U1', bankVerificationId: 'banv-1' },
        { id: 'U2', bankVerificationId: 'banv-2' },
      ],
      verifiedAfter: true,
    });

    const r = await service.reconcilePeachBanv();

    expect(r).toEqual({ checked: 2, resolved: 2 });
    // The sweep is the webhook handler with only the id: the result itself is
    // read back from the Payouts API.
    expect(handler).toHaveBeenCalledWith({ bankVerificationId: 'banv-1' });
    expect(handler).toHaveBeenCalledWith({ bankVerificationId: 'banv-2' });
  });

  it('counts nothing resolved while Peach still reports pending', async () => {
    const { service, prisma } = makeService({
      pending: [{ id: 'U1', bankVerificationId: 'banv-1' }],
      verifiedAfter: false,
    });

    await expect(service.reconcilePeachBanv()).resolves.toEqual({
      checked: 1,
      resolved: 0,
    });
    expect(prisma.user.findMany.mock.calls[0][0].where.bankAvsResult).toEqual({
      startsWith: 'REQUESTED',
    });
  });

  it('is a no-op when the Payouts product is not configured', async () => {
    const { service, handler } = makeService({ configured: false });

    await expect(service.reconcilePeachBanv()).resolves.toEqual({
      checked: 0,
      resolved: 0,
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
