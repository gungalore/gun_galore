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
    service = new UsersService(prisma as never, {} as never, { isBanvEnabled: () => false } as never);
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
