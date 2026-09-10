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
      { purgeForUser: jest.fn() } as never,
      // And the pair that matters most: the identity document and the selfie
      // are encrypted files on disk, and a Prisma cascade cannot reach the
      // filesystem.
      { purgeKycFiles: jest.fn(async () => ({ removed: 0, failed: 0 })) } as never,
      // Closing an account without erasing the evidence.
      {
        close: jest.fn(async () => ({ userId: 'c', cancelledListingIds: [] })),
        canClose: jest.fn(async () => ({ canClose: true, restricted: false, blockers: [] })),
        assertReason: jest.fn((r: string) => r),
      } as never,
      // DiditService — the phone OTP adapter.
      { sendPhoneCode: jest.fn(), checkPhoneCode: jest.fn(async () => true) } as never,
      // SessionService — closing an account revokes every live session.
      { revokeAllForUser: jest.fn(async () => 0) } as never,
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

  // ── provisioning moved out of this service ──────────────────────────
  //
  // ⚠️ THE FOUR TESTS THAT STOOD HERE GUARDED A REAL RULE, and it still
  // holds — they just no longer have a method to call. They covered
  // upsertFromClerk, the identity-provider sync that created a member row:
  // campaignKey went into the CREATE branch and deliberately NOT the UPDATE
  // branch, because the update ran on every sync for the life of the account
  // and putting the key there would silently re-attribute anyone who later
  // clicked a different blast.
  //
  // Sign-up is ours now, so that rule lives in AuthService.register and is
  // tested in auth.service.spec.ts. The CAS back-fill below is the half that
  // stayed here.
});
