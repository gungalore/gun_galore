jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// The complaint-status row is the one notification type with no action
// handler that resolves it by entity. These tests pin the supersede-first
// behaviour that keeps the (non-dismissible) AWAITING_USER row from living in
// the member's inbox forever.

function makeService() {
  const calls: string[] = [];
  const svc = Object.create(NotificationsService.prototype) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    appUrl: 'https://alloutdoor.co.za',
    resolveByEntity: jest.fn().mockImplementation(async () => {
      calls.push('resolve');
      return 1;
    }),
    persistByEmail: jest.fn().mockImplementation(async () => {
      calls.push('persist');
    }),
    send: jest.fn().mockResolvedValue(undefined),
    sendSms: jest.fn().mockResolvedValue(undefined),
  });
  return { svc: svc as unknown as Record<string, any>, calls };
}

const base = {
  email: 'member@example.com',
  name: 'Sam',
  referenceNumber: 'CO000123',
  subject: 'Wrong scope',
  heldPayout: false,
};

describe('NotificationsService.complaintStatusChanged — supersede', () => {
  it('retires the prior complaint rows before writing the new one', async () => {
    const { svc, calls } = makeService();

    await svc.complaintStatusChanged({ ...base, status: 'AWAITING_USER' });

    expect(svc.resolveByEntity).toHaveBeenCalledWith('complaint', 'CO000123', {
      types: ['complaint_status_changed'],
      resolvedBy: 'auto_expired',
    });
    expect(calls).toEqual(['resolve', 'persist']);
  });

  it('also supersedes on a closing status (verdict row replaces the ask)', async () => {
    const { svc } = makeService();

    await svc.complaintStatusChanged({
      ...base,
      subject: 'Wrong scope',
      status: 'RESOLVED',
    });

    expect(svc.resolveByEntity).toHaveBeenCalledTimes(1);
    expect(svc.persistByEmail).toHaveBeenCalledTimes(1);
  });
});
