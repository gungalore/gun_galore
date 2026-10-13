jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// resolveBankDetailTasks is the member-side resolver for the action-required
// refund rows that ask for bank details but are linked to the TRANSACTION
// (not 'bank'), so resolveByEntity('bank', userId) never cleared them.

function makeService() {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const svc = Object.create(NotificationsService.prototype) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    prisma: { notification: { updateMany } },
  });
  return { svc: svc as unknown as Record<string, any>, updateMany };
}

describe('NotificationsService.resolveBankDetailTasks', () => {
  it('clears only the member’s non-dismissible bank-detail rows', async () => {
    const { svc, updateMany } = makeService();

    const n = await svc.resolveBankDetailTasks('u1');

    expect(n).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        resolvedAt: null,
        dismissible: false,
        type: {
          in: ['refund_needs_bank_details', 'refund_issued', 'sale_rejected'],
        },
      },
      data: { resolvedAt: expect.any(Date), resolvedBy: 'user_action' },
    });
  });

  it('fails open (returns 0) when the update throws', async () => {
    const { svc, updateMany } = makeService();
    updateMany.mockRejectedValueOnce(new Error('db down'));

    await expect(svc.resolveBankDetailTasks('u1')).resolves.toBe(0);
  });
});
