import { UsersService } from './users.service';

// Marketing-campaign attribution must be FIRST-TOUCH and idempotent.
//
// The operator pays per SMS and judges a blast on its sign-up count, so the
// failure mode that matters is not a crash — it is silent inflation: a
// returning member clicking a later campaign link and being re-counted, or a
// retried flush double-attributing. Both would make a bad blast look good and
// send real money after it. These lock the guard.
describe('UsersService — campaign attribution (first-touch)', () => {
  function makeService(over: {
    existing?: Record<string, unknown> | null;
    upserted?: Record<string, unknown>;
  } = {}) {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            over.existing === undefined ? { id: 'u1', campaignKey: null } : over.existing,
          ),
        upsert: jest.fn().mockResolvedValue(
          over.upserted ?? { id: 'u1', campaignKey: null },
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new UsersService(
      prisma as never,
      {} as never,
      { isBanvEnabled: () => false } as never,
      { resolveByEntity: jest.fn() } as never,
      { purgeForUser: jest.fn() } as never,
    );
    return { service, prisma };
  }

  // ── recordCampaignAttribution (the OAuth / retry flush path) ────────
  it('writes the key when the member has none yet', async () => {
    const { service, prisma } = makeService();
    const ok = await service.recordCampaignAttribution('clerk1', 'j26');
    expect(ok).toBe(true);
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      // The null guard IS the idempotency: two concurrent flushes cannot both
      // write, and a replay after the fact matches nothing.
      expect.objectContaining({
        where: { id: 'u1', campaignKey: null },
        data: { campaignKey: 'j26' },
      }),
    );
  });

  it('NEVER re-attributes a member who already has a campaign', async () => {
    const { service, prisma } = makeService({
      existing: { id: 'u1', campaignKey: 'may-blast' },
    });
    const ok = await service.recordCampaignAttribution('clerk1', 'j26');
    // true = "stop retrying", not "written" — the client must not keep the
    // key parked forever, but the original attribution stands.
    expect(ok).toBe(true);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('reports false (retry later) when the User row is not provisioned yet', async () => {
    const { service, prisma } = makeService({ existing: null });
    const ok = await service.recordCampaignAttribution('clerk1', 'j26');
    expect(ok).toBe(false);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('ignores a blank/whitespace key instead of writing an empty attribution', async () => {
    const { service, prisma } = makeService();
    expect(await service.recordCampaignAttribution('clerk1', '   ')).toBe(false);
    expect(await service.recordCampaignAttribution('clerk1', undefined)).toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('caps an absurdly long key rather than storing it whole', async () => {
    const { service, prisma } = makeService();
    await service.recordCampaignAttribution('clerk1', 'x'.repeat(200));
    const data = (prisma.user.updateMany.mock.calls[0][0] as {
      data: { campaignKey: string };
    }).data;
    expect(data.campaignKey.length).toBe(40);
  });

  // ── upsertFromClerk (the email-signup metadata path) ────────────────
  it('seeds the key on the created row at provisioning', async () => {
    const { service, prisma } = makeService({
      upserted: { id: 'u1', campaignKey: 'j26' },
    });
    await service.upsertFromClerk({
      clerkId: 'clerk1',
      email: 'a@b.co',
      campaignKey: 'j26',
    });
    const args = prisma.user.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create.campaignKey).toBe('j26');
    // The critical one: the UPDATE branch runs on EVERY Clerk sync for the
    // life of the account. If campaignKey were in there, a member who later
    // clicked a different blast would be silently re-attributed and every
    // campaign's numbers would drift upward forever.
    expect(args.update).not.toHaveProperty('campaignKey');
  });

  it('does not touch an existing attribution on a later sync', async () => {
    const { service, prisma } = makeService({
      upserted: { id: 'u1', campaignKey: 'may-blast' },
    });
    await service.upsertFromClerk({
      clerkId: 'clerk1',
      email: 'a@b.co',
      campaignKey: 'j26',
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('back-fills via CAS when the row existed without a key', async () => {
    const { service, prisma } = makeService({
      upserted: { id: 'u1', campaignKey: null },
    });
    await service.upsertFromClerk({
      clerkId: 'clerk1',
      email: 'a@b.co',
      campaignKey: 'j26',
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', campaignKey: null },
        data: { campaignKey: 'j26' },
      }),
    );
  });

  it('provisions normally when there is no campaign at all', async () => {
    const { service, prisma } = makeService();
    await service.upsertFromClerk({ clerkId: 'clerk1', email: 'a@b.co' });
    const args = prisma.user.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(args.create.campaignKey).toBeUndefined();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
