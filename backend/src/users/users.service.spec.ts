import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

// Address-book CRUD + notification-preference logic (Phase 2). Light Prisma
// mock; $transaction runs the callback against the same mock.
describe('UsersService — address book & notification prefs', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    address: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: UsersService;

  const validAddr = {
    street: '1 Main Rd',
    city: 'Cape Town',
    postalCode: '8001',
    province: 'WESTERN_CAPE',
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      address: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    service = new UsersService(
      prisma as never,
      {} as never,
      { isBanvEnabled: () => false } as never,
      { resolveByEntity: jest.fn() } as never,
      // Account deletion removes a member's encrypted licence documents before
      // the cascade takes the rows that point at them.
      { purgeForUser: jest.fn(async () => ({ filesRemoved: 0, filesFailed: 0, motivations: 0 })) } as never,
    );
  });

  it('makes the first saved address the default', async () => {
    prisma.address.count.mockResolvedValue(0);
    const created = await service.createAddress('clerk1', validAddr as never);
    expect(created.isDefault).toBe(true);
  });

  it('clears the previous default when a new default is added', async () => {
    prisma.address.count.mockResolvedValue(2);
    await service.createAddress('clerk1', { ...validAddr, isDefault: true } as never);
    expect(prisma.address.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', isDefault: true },
        data: { isDefault: false },
      }),
    );
  });

  it('does not auto-default a non-first address', async () => {
    prisma.address.count.mockResolvedValue(3);
    const created = await service.createAddress('clerk1', validAddr as never);
    expect(created.isDefault).toBe(false);
  });

  it('rejects updating an address that is not the user’s', async () => {
    prisma.address.findFirst.mockResolvedValue(null);
    await expect(
      service.updateAddress('clerk1', 'aX', { city: 'Durban' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('promotes another address to default when the default is deleted', async () => {
    prisma.address.findFirst
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', isDefault: true }) // the one being deleted
      .mockResolvedValueOnce({ id: 'a2', userId: 'u1', isDefault: false }); // next to promote
    await service.deleteAddress('clerk1', 'a1');
    expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: 'a2' },
      data: { isDefault: true },
    });
  });

  it('writes only the provided notification-preference booleans', async () => {
    await service.updateNotificationPrefs('clerk1', { smsEnabled: false });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkId: 'clerk1' },
        data: { notifySmsEnabled: false },
      }),
    );
  });
});

// ── account deletion ────────────────────────────────────────────────
//
// Both branches of deleteByClerkId used to leak a member's encrypted licence
// documents, in opposite directions: a hard delete cascaded the rows away and
// left the files unreachable, and the PII-scrub fallback kept the User row so
// the motivations survived an erasure request entirely.

describe('UsersService.deleteByClerkId', () => {
  function build(opts: { hardDeleteFails?: boolean } = {}) {
    const retention = {
      purgeForUser: jest.fn(async () => ({
        filesRemoved: 2,
        filesFailed: 0,
        motivations: 1,
      })),
    };
    const order: string[] = [];
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({ id: 'u-1' })),
        deleteMany: jest.fn(async () => {
          order.push('user.delete');
          if (opts.hardDeleteFails) throw new Error('FK RESTRICT');
          return { count: 1 };
        }),
        updateMany: jest.fn(async () => {
          order.push('user.scrub');
          return { count: 1 };
        }),
      },
    };
    retention.purgeForUser.mockImplementation(async () => {
      order.push('motivations.purge');
      return { filesRemoved: 2, filesFailed: 0, motivations: 1 };
    });
    const svc = new UsersService(
      prisma as never,
      {} as never,
      { isBanvEnabled: () => false } as never,
      { resolveByEntity: jest.fn() } as never,
      retention as never,
    );
    return { svc, prisma, retention, order };
  }

  it('removes the licence documents BEFORE the row that points at them', async () => {
    // A cascade cannot reach the filesystem, so the other order strands the
    // encrypted files with nothing left referencing them.
    const { svc, retention, order } = build();
    await svc.deleteByClerkId('clerk_1');
    expect(retention.purgeForUser).toHaveBeenCalledWith('u-1');
    expect(order).toEqual(['motivations.purge', 'user.delete']);
  });

  it('still purges them when the hard delete is blocked and it falls back to scrubbing', async () => {
    // This is the worse leak: the scrub keeps the User row, so without this the
    // motivations — ID number, home address, security circumstances — survived
    // the erasure request untouched.
    const { svc, retention, order } = build({ hardDeleteFails: true });
    await svc.deleteByClerkId('clerk_1');
    expect(retention.purgeForUser).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['motivations.purge', 'user.delete', 'user.scrub']);
  });

  it('does not throw out of the webhook when the purge fails', async () => {
    // Clerk retries forever on a non-2xx, and the account stays undeleted.
    const { svc, retention } = build();
    retention.purgeForUser.mockRejectedValueOnce(new Error('disk on fire'));
    await expect(svc.deleteByClerkId('clerk_1')).resolves.toBeUndefined();
  });

  it('skips the purge for a clerk id we never had a row for', async () => {
    const { svc, prisma, retention } = build();
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await svc.deleteByClerkId('clerk_unknown');
    expect(retention.purgeForUser).not.toHaveBeenCalled();
  });
});
