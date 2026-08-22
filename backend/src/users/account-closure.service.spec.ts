import { AccountClosureService } from './account-closure.service';

// CLOSING AN ACCOUNT WITHOUT ERASING THE EVIDENCE.
//
// Operator, 2026-08-22: "It must delete the profile from the public [side], but
// still keep transaction links etc, reason for that is if a user commited a
// crime or something they cant just vanish by deleting and wiping evidence."
//
// Almost every test here is about something the closure must NOT do.

const CLEAN = {
  id: 'u1',
  clerkId: 'clerk_1',
  username: 'turbosnail',
  email: 'a@b.com',
  phone: '0743039999',
  firstName: 'Gerhard',
  lastName: 'Fourie',
  kycIdHash: 'hash-abc',
  isBanned: false,
  bannedAt: null,
  sellingBannedAt: null,
  sellerRejectStrikes: 0,
  auctionStrikes: 0,
  dispatchStrikes: 0,
  trustScore: 42,
  accountClosedAt: null,
};

function build(
  o: {
    user?: Record<string, unknown>;
    counts?: Record<string, number>;
    listings?: { id: string }[];
    closure?: Record<string, unknown> | null;
  } = {},
) {
  const user = { ...CLEAN, ...(o.user ?? {}) };
  const counts = o.counts ?? {};
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const tx: any = {
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async (a: any) => {
        updated.push(a.data);
        return {};
      }),
    },
    listing: {
      findMany: jest.fn(async () => o.listings ?? []),
      updateMany: jest.fn(async () => ({ count: (o.listings ?? []).length })),
    },
    accountClosure: {
      create: jest.fn(async (a: any) => {
        created.push(a.data);
        return a.data;
      }),
      update: jest.fn(async () => ({})),
    },
    actionToken: { deleteMany: jest.fn(async () => ({ count: 3 })) },
  };

  const prisma: any = {
    user: { findUnique: jest.fn(async () => user), update: tx.user.update },
    transaction: {
      count: jest.fn(async (a: any) => {
        if (a?.where?.paymentStatus?.in) return counts.held ?? 0;
        if (a?.where?.paymentStatus === 'RELEASED') return counts.payout ?? 0;
        if (a?.where?.shippingStatus) return counts.undelivered ?? 0;
        if (a?.where?.listing?.isFirearm) return counts.firearm ?? 0;
        return 0;
      }),
    },
    complaint: { count: jest.fn(async () => counts.complaints ?? 0) },
    listing: {
      count: jest.fn(async (a: any) =>
        a?.where?.listingType === 'AUCTION'
          ? (counts.auctions ?? 0)
          : (counts.checkout ?? 0),
      ),
    },
    offer: { count: jest.fn(async () => counts.offers ?? 0) },
    accountClosure: {
      findUnique: jest.fn(async () =>
        o.closure === undefined ? null : o.closure,
      ),
      update: tx.accountClosure.update,
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const svc = new AccountClosureService(prisma as never);
  return { svc, prisma, tx, created, updated };
}

describe('what stops a closure', () => {
  it('lets a clean account through', async () => {
    const { svc } = build();
    expect(await svc.canClose('u1')).toEqual({
      canClose: true,
      restricted: false,
      blockers: [],
    });
  });

  it.each([
    ['held', 'FUNDS_IN_FLIGHT'],
    ['payout', 'PAYOUT_DUE'],
    ['undelivered', 'UNDELIVERED'],
    ['firearm', 'FIREARM_TRANSFER'],
    ['complaints', 'OPEN_COMPLAINT'],
    ['auctions', 'LIVE_AUCTION'],
    ['checkout', 'MID_CHECKOUT'],
    ['offers', 'OPEN_OFFERS'],
  ])('refuses on %s', async (key, code) => {
    const { svc } = build({ counts: { [key]: 1 } });
    const r = await svc.canClose('u1');
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain(code);
  });

  it('refuses a RESTRICTED account without listing blockers', async () => {
    // ⚠️ HALF THE BAN-EVASION ANSWER. Somebody cannot close in order to shed a
    // live restriction; that route goes through support, where an admin
    // closure records who did it.
    const { svc } = build({ user: { isBanned: true } });
    const r = await svc.canClose('u1');
    expect(r).toEqual({ canClose: false, restricted: true, blockers: [] });
  });

  it('refuses a selling ban too, not only a full ban', async () => {
    const { svc } = build({ user: { sellingBannedAt: new Date() } });
    expect((await svc.canClose('u1')).restricted).toBe(true);
  });

  it('says so plainly when it is already closed', async () => {
    const { svc } = build({ user: { accountClosedAt: new Date() } });
    const r = await svc.canClose('u1');
    expect(r.blockers[0].code).toBe('ALREADY_CLOSED');
  });
});

describe('the closure itself', () => {
  it('releases every claim that would block coming back', async () => {
    // ⚠️ THE POINT OF THE WHOLE DESIGN. The old scrub held username and the SA
    // ID hash forever, so a member was told their own ID belonged to somebody
    // else and their handle was taken — by a row that no longer represented
    // anyone.
    const { svc, updated } = build();
    await svc.close('u1', { closedBy: 'MEMBER', reason: 'NOT_USING' });
    const d = updated[0];
    expect(d.username).toBeNull();
    expect(d.phone).toBeNull();
    expect(d.phoneVerified).toBe(false);
    // ⚠️ .invalid is reserved by RFC 6761 and can never resolve.
    expect(String(d.email)).toContain('@accounts.invalid');
  });

  it('HOLDS what a statutory form and the ban barrier need', async () => {
    const { svc, updated } = build();
    await svc.close('u1', { closedBy: 'MEMBER', reason: 'NOT_USING' });
    const d = updated[0];
    // Section C of the SAP 534 is assembled live off these.
    expect(d).not.toHaveProperty('firstName');
    expect(d).not.toHaveProperty('lastName');
    expect(d).not.toHaveProperty('idNumberEncrypted');
    // The only identity-anchored enforcement barrier in the codebase.
    expect(d).not.toHaveProperty('kycIdHash');
    // Closing is not misconduct.
    expect(d).not.toHaveProperty('isBanned');
  });

  it('snapshots the identity and the enforcement state', async () => {
    const { svc, created } = build({
      user: { auctionStrikes: 2, trustScore: 17 },
    });
    await svc.close('u1', { closedBy: 'MEMBER', reason: 'PRIVACY' });
    expect(created[0]).toMatchObject({
      closedUsername: 'turbosnail',
      closedEmail: 'a@b.com',
      closedFirstName: 'Gerhard',
      kycIdHashArchived: 'hash-abc',
      wasAuctionStrikes: 2,
      wasTrustScore: 17,
      closedBy: 'MEMBER',
      reason: 'PRIVACY',
    });
  });

  it('kills every outstanding magic link', async () => {
    // They authorise actions without a login — a KYC link, a witness
    // signature, a scan hand-off. One still working after closure is an open
    // door into an account nobody owns.
    const { svc, tx } = build();
    await svc.close('u1', { closedBy: 'MEMBER', reason: 'NOT_USING' });
    expect(tx.actionToken.deleteMany).toHaveBeenCalledWith({
      where: { authorisedUserId: 'u1' },
    });
  });

  it('cancels the live listings and records which', async () => {
    const { svc, created, tx } = build({ listings: [{ id: 'l1' }, { id: 'l2' }] });
    const r = await svc.close('u1', { closedBy: 'MEMBER', reason: 'NOT_USING' });
    expect(r.cancelledListingIds).toEqual(['l1', 'l2']);
    expect(tx.listing.updateMany).toHaveBeenCalled();
    // On the closure record, so a failed reindex can be retried without
    // re-deriving them from a row whose seller is now anonymous.
    expect(created[0].cancelledListingIds).toEqual(['l1', 'l2']);
  });

  it('is idempotent — a second call changes nothing', async () => {
    // The Clerk webhook can arrive twice and a member can double-submit.
    const { svc, created } = build({ user: { accountClosedAt: new Date() } });
    const r = await svc.close('u1', {
      closedBy: 'CLERK_WEBHOOK',
      reason: 'OTHER',
      force: true,
    });
    expect(r.cancelledListingIds).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it('refuses a member closure that has blockers', async () => {
    const { svc } = build({ counts: { complaints: 1 } });
    await expect(
      svc.close('u1', { closedBy: 'MEMBER', reason: 'NOT_USING' }),
    ).rejects.toThrow(/complaint/i);
  });

  it('lets an ADMIN force past a RESTRICTION', async () => {
    // The support-reviewed route, and the only way a banned account is ever
    // closed.
    const { svc, created } = build({ user: { isBanned: true } });
    await svc.close('u1', {
      closedBy: 'ADMIN',
      reason: 'member asked support to close',
      closedByAdminId: 'adm1',
      force: true,
    });
    expect(created[0]).toMatchObject({
      closedBy: 'ADMIN',
      closedByAdminId: 'adm1',
      wasBanned: true,
    });
  });

  it('does NOT let an admin force past money still owed', async () => {
    // ⚠️ THE DISTINCTION THAT `force` USED TO COLLAPSE. Closing a banned
    // member is what the admin route is for; closing one who is still owed a
    // payout clears the bank quartet and makes that money permanently
    // unpayable, with nobody left to re-collect details from.
    const { svc } = build({ user: { isBanned: true }, counts: { payout: 1 } });
    await expect(
      svc.close('u1', {
        closedBy: 'ADMIN',
        reason: 'support request',
        closedByAdminId: 'adm1',
        force: true,
      }),
    ).rejects.toThrow(/still owe you money/i);
  });

  it('evaluates the blockers even for a restricted account', async () => {
    // canClose used to return early on `restricted` with an empty blocker
    // list, so the admin route — whose whole purpose is restricted accounts —
    // had nothing to consult.
    const { svc } = build({ user: { isBanned: true }, counts: { complaints: 1 } });
    const r = await svc.canClose('u1');
    expect(r.restricted).toBe(true);
    expect(r.blockers.map((b) => b.code)).toContain('OPEN_COMPLAINT');
  });

  it('only accepts a reason from the ticklist', async () => {
    const { svc } = build();
    expect(() => svc.assertReason('NOT_USING')).not.toThrow();
    expect(() => svc.assertReason('because I felt like it')).toThrow();
    expect(() => svc.assertReason(undefined)).toThrow();
  });
});

describe('coming back', () => {
  const closure = {
    userId: 'old',
    wasBanned: true,
    wasBannedAt: new Date('2026-01-01'),
    wasSellingBannedAt: null,
    wasSellerRejectStrikes: 3,
    wasAuctionStrikes: 1,
    wasDispatchStrikes: 0,
    wasTrustScore: 5,
  };

  it('carries a ban FORWARD onto the new account', async () => {
    // ⚠️ THE OTHER HALF OF THE BAN-EVASION ANSWER. Releasing the ID hash would
    // hand every banned seller a clean slate, because every strike and ban is
    // a defaulted column and a new row is a clean row. So the collision is not
    // an error — it is the signal that we already know this person.
    const { svc, prisma, tx } = build({ closure });
    tx.user.findUnique = jest.fn(async () => ({
      kycIdHash: 'hash-abc',
      accountClosedAt: new Date(),
    }));
    await expect(svc.relinkFromClosure('old', 'new')).resolves.toBe(true);

    const writes = (tx.user.update as jest.Mock).mock.calls.map((c) => c[0]);
    // Off the old row first — kycIdHash is @unique, so writing it onto the new
    // row while the old one still holds it is a P2002.
    expect(writes[0]).toMatchObject({
      where: { id: 'old' },
      data: { kycIdHash: null },
    });
    expect(writes[1].data).toMatchObject({
      kycIdHash: 'hash-abc',
      isBanned: true,
      sellerRejectStrikes: 3,
      trustScore: 5,
    });
    expect(prisma.accountClosure.findUnique).toHaveBeenCalled();
  });

  it('does nothing when there is no closure record', async () => {
    const { svc } = build({ closure: null });
    expect(await svc.relinkFromClosure('old', 'new')).toBe(false);
  });
});
