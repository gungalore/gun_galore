// meilisearch is ESM and breaks ts-jest if imported for real (AdminService
// → ListingsService → SearchService pulls it in transitively).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdminService } from './admin.service';

// ────────────────────────────────────────────────────────────────────
// ADMIN CLOSE ACCOUNT — the support-side route, and the one thing Ban is not.
//
// Operator, 2026-08-22: "It must delete the profile from the public [side],
// but still keep transaction links etc … if a user commited a crime or
// something they cant just vanish by deleting and wiping evidence."
//
// ⚠️ THE INVARIANT THESE TESTS EXIST FOR: an admin may wave through the
// RESTRICTION (banned / selling-banned) and nothing else. That carve-out is
// the whole reason the route exists — the self-service button refuses a
// restricted account so closing can never launder a ban, so a banned member
// who genuinely wants out has to come through here.
//
// ⚠️ AND MONEY IS NOT PART OF THE CARVE-OUT — INCLUDING ON THE RESTRICTED
// PATH. canClose() returns on the restriction before it counts anything, so
// on the one path this route exists for its money blockers never run and
// `force` skips the re-check as well. closeAccount re-runs them itself
// (assertNoMoneyInFlight); without that, closing a banned seller who is still
// owed a payout nulls the bank quartet and makes that money permanently
// unpayable with nobody left to re-collect an account number from (H7). The
// "restricted + payout owed" test below is the one that would have caught it.
// ────────────────────────────────────────────────────────────────────

function makeService(
  user: Record<string, unknown> | null,
  eligibility: {
    canClose: boolean;
    restricted: boolean;
    blockers?: { code: string; message: string }[];
  },
  // Counts returned by assertNoMoneyInFlight's two queries, in order:
  // funds held/disputed, then payouts owed.
  moneyCounts: number[] = [0, 0],
) {
  const counts = [...moneyCounts];
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async (a: { data: Record<string, unknown> }) => ({
        id: 'U1',
        ...a.data,
      })),
    },
    transaction: { count: jest.fn(async () => counts.shift() ?? 0) },
  };
  const closures = {
    canClose: jest.fn().mockResolvedValue({
      canClose: eligibility.canClose,
      restricted: eligibility.restricted,
      blockers: eligibility.blockers ?? [],
    }),
    close: jest.fn().mockResolvedValue({
      clerkId: 'clerk_1',
      cancelledListingIds: ['L1', 'L2'],
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(
    prisma as never,
    {} as never, // files
    {} as never, // notifications
    {} as never, // listings
    audit as never,
    {} as never, // zohoBooks
    {} as never, // peach
    {} as never, // transactions
    {} as never, // sms
    closures as never,
  );
  // The real client would try to reach Clerk over the network.
  const deleteUser = jest.fn().mockResolvedValue(undefined);
  (service as unknown as { clerk: unknown }).clerk = { users: { deleteUser } };
  return { service, prisma, closures, audit, deleteUser };
}

const openUser = {
  id: 'U1',
  clerkId: 'clerk_1',
  username: 'boet',
  email: 'boet@example.co.za',
  accountClosedAt: null,
};

describe('AdminService.closeAccount', () => {
  it('closes a clean account, deletes the Clerk user, and audits it', async () => {
    const { service, closures, audit, deleteUser } = makeService(openUser, {
      canClose: true,
      restricted: false,
    });

    const res = await service.closeAccount('U1', 'ADMIN1', 'member asked support');

    expect(res).toEqual({ closed: true, cancelledListings: 2 });
    expect(closures.close).toHaveBeenCalledWith('U1', {
      closedBy: 'ADMIN',
      closedByAdminId: 'ADMIN1',
      reason: 'member asked support',
      // Nothing to force past — this account had no restriction.
      force: false,
    });
    expect(deleteUser).toHaveBeenCalledWith('clerk_1');
    // ⚠️ The handle is snapshotted into the audit row because by the time
    // anybody reads it the User row no longer has one.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_ACCOUNT_CLOSE',
        resourceId: 'U1',
        oldValue: { username: 'boet', email: 'boet@example.co.za' },
      }),
    );
  });

  // The route's reason for existing.
  it('forces past a restriction — this is the only way a banned account closes', async () => {
    const { service, closures } = makeService(openUser, {
      canClose: false,
      restricted: true,
    });

    await service.closeAccount('U1', 'ADMIN1', 'banned member asked to leave');

    expect(closures.close).toHaveBeenCalledWith(
      'U1',
      expect.objectContaining({ force: true }),
    );
  });

  // ⚠️ THE ONE THE FORCE MAY NOT SKIP. canClose() short-circuits on the
  // restriction, so on this path nothing else in it ran — and a ban is not a
  // reason to keep somebody's money. Closing here would null the bank quartet
  // out from under a payout that is still owed, and there is nobody left to
  // ask for an account number afterwards.
  it('still refuses a restricted account with a payout owed', async () => {
    const { service, closures } = makeService(
      openUser,
      { canClose: false, restricted: true },
      [0, 1], // nothing held, one payout owed
    );

    await expect(
      service.closeAccount('U1', 'ADMIN1', 'banned member asked to leave'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(closures.close).not.toHaveBeenCalled();
  });

  it('still refuses a restricted account with funds held', async () => {
    const { service, closures } = makeService(
      openUser,
      { canClose: false, restricted: true },
      [2, 0],
    );

    await expect(
      service.closeAccount('U1', 'ADMIN1', 'banned member asked to leave'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(closures.close).not.toHaveBeenCalled();
  });

  // ⚠️ AND NOTHING ELSE. Money in flight is not an admin's to wave through:
  // closure nulls the bank quartet, and a payout that was still owed becomes
  // permanently unpayable with no re-collection path.
  it('refuses an unrestricted account when money or paperwork is still open', async () => {
    const { service, closures } = makeService(openUser, {
      canClose: false,
      restricted: false,
      blockers: [
        { code: 'FUNDS_HELD', message: 'We are still holding money on 1 order.' },
      ],
    });

    await expect(
      service.closeAccount('U1', 'ADMIN1', 'member asked support'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(closures.close).not.toHaveBeenCalled();
  });

  // Refusal rather than a silent no-op: a second close would snapshot the
  // already-scrubbed row, overwriting the real identity in the accountability
  // record with the tombstone that replaced it.
  it('refuses a second close', async () => {
    const { service, closures } = makeService(
      { ...openUser, accountClosedAt: new Date('2026-08-22') },
      { canClose: false, restricted: false },
    );

    await expect(
      service.closeAccount('U1', 'ADMIN1', 'member asked support'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(closures.close).not.toHaveBeenCalled();
  });

  it('requires a reason — it is written onto the closure record itself', async () => {
    const { service, closures } = makeService(openUser, {
      canClose: true,
      restricted: false,
    });

    await expect(service.closeAccount('U1', 'ADMIN1', 'ok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(closures.close).not.toHaveBeenCalled();
  });

  it('404s on an unknown user', async () => {
    const { service } = makeService(null, { canClose: true, restricted: false });
    await expect(
      service.closeAccount('nope', 'ADMIN1', 'member asked support'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ⚠️ A Clerk outage must not roll back a closure the member has already been
  // told about. Closed-in-our-DB-with-a-live-login is strictly safer than the
  // reverse: every write gate already refuses the row.
  it('still reports success when the Clerk delete fails', async () => {
    const { service, deleteUser, audit } = makeService(openUser, {
      canClose: true,
      restricted: false,
    });
    deleteUser.mockRejectedValue(new Error('clerk down'));

    const res = await service.closeAccount('U1', 'ADMIN1', 'member asked support');

    expect(res.closed).toBe(true);
    expect(audit.record).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// H11 — the username has to become clearable, but only where it is safe.
// ────────────────────────────────────────────────────────────────────

describe('AdminService.updateUser — clearing a username', () => {
  function makeUpdateService(user: Record<string, unknown>) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn(async (a: { data: Record<string, unknown> }) => ({
          id: 'U1',
          ...a.data,
        })),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, audit };
  }

  const base = {
    id: 'U1',
    username: 'boet',
    firstName: 'A',
    lastName: 'B',
    phone: '0820000000',
    sellerTier: 'NEW',
    kycStatus: 'NONE',
    isBanned: false,
    subscriptionTier: 'FREE',
  };

  // The documented invariant that used to be absolute: a live member's handle
  // is rendered on their listings and their ratings, and nulling it turns them
  // into an anonymous seller while they are still trading.
  it('refuses to clear a live member’s username', async () => {
    const { service, prisma } = makeUpdateService({
      ...base,
      accountClosedAt: null,
    });

    await expect(
      service.updateUser('U1', 'ADMIN1', {
        username: '',
        reason: 'tidying up',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Closure releases the handle back into the signup namespace. If a closure
  // half-completes, an admin has to be able to finish it by hand — the only
  // other remedy was a manual database edit.
  it('clears a closed account’s username', async () => {
    const { service, prisma } = makeUpdateService({
      ...base,
      accountClosedAt: new Date('2026-08-22'),
    });

    await service.updateUser('U1', 'ADMIN1', {
      username: '',
      reason: 'finishing a half-completed closure',
    } as never);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ username: null }) }),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// A CLOSED ACCOUNT IS NOT SWEPT INTO A BULK BAN.
//
// ⚠️ The checkbox in bulk-users.tsx disables them, but that is a rendering
// decision over one page of a paginated list — the ids travel on the wire and
// a stale tab is enough to include one. Every gate already refuses a closed
// account, so the ban changes nothing except leaving a USER_BAN audit row on
// somebody who simply left, which is exactly what a later reader takes as
// misconduct.
// ────────────────────────────────────────────────────────────────────

describe('AdminService.bulkBanUsers', () => {
  it('skips a closed account and bans the rest', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'U2' }]) },
    };
    const service = new AdminService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const updateUser = jest
      .spyOn(service, 'updateUser')
      .mockResolvedValue({} as never);

    const res = await service.bulkBanUsers(
      ['U1', 'U2'],
      'ADMIN1',
      'coordinated non-payment ring',
    );

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(
      'U1',
      'ADMIN1',
      expect.objectContaining({ isBanned: true }),
    );
    expect(res.processed).toBe(1);
    expect(res.skipped).toBe(1);
    // The empty-input early return widens `results` to never[], so the union
    // needs naming before it can be read.
    const rows = res.results as { userId: string; message?: string }[];
    expect(rows.find((r) => r.userId === 'U2')?.message).toMatch(/closed/i);
  });
});
