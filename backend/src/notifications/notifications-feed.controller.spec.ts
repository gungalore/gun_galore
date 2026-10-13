import { NotificationsFeedController } from './notifications-feed.controller';

// Focused on the keyset cursor in list(): the (createdAt, id) tiebreaker is
// the fix for sibling rows written in the same millisecond being skipped
// between pages. Everything else in this controller is a thin Prisma call.

function makeController() {
  const prisma = {
    user: { findUnique: jest.fn() },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const controller = new NotificationsFeedController(prisma as never);
  return { controller, prisma };
}

describe('NotificationsFeedController.list — cursor', () => {
  it('returns [] when the user row is missing', async () => {
    const { controller, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      controller.list('ghost', {} as never),
    ).resolves.toEqual([]);
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('omits the cursor clause and orders by createdAt then id', async () => {
    const { controller, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    await controller.list('u1', {} as never);

    const arg = prisma.notification.findMany.mock.calls[0][0];
    expect(arg.where.userId).toBe('u1');
    expect(arg.where.OR).toBeUndefined();
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('pages on createdAt alone when no id tiebreaker is supplied', async () => {
    const { controller, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    await controller.list('u1', {
      before: '2026-01-01T00:00:00.000Z',
    } as never);

    const arg = prisma.notification.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { createdAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
    ]);
  });

  it('adds the id tiebreaker so same-millisecond siblings are not skipped', async () => {
    const { controller, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    await controller.list('u1', {
      before: '2026-01-01T00:00:00.000Z',
      beforeId: 'cm123',
    } as never);

    const arg = prisma.notification.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { createdAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
      { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: { lt: 'cm123' } },
    ]);
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('defaults status to active (unresolved only)', async () => {
    const { controller, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    await controller.list('u1', {} as never);

    const arg = prisma.notification.findMany.mock.calls[0][0];
    expect(arg.where.resolvedAt).toBeNull();
  });
});
