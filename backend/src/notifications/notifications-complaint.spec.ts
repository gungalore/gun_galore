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
    // The row and the email CTA both land on the MEMBER complaints page, not
    // the static legal /complaints explainer.
    expect(svc.persistByEmail.mock.calls[0][1]).toEqual(
      expect.objectContaining({ url: '/account/complaints' }),
    );
    const html = svc.send.mock.calls[0][2] as string;
    expect(html).toContain('/account/complaints');
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

describe('NotificationsService.complaintConcernForSeller', () => {
  // A condition/description concern is between buyer and seller: the seller
  // gets ONE neutral email, with no inbox row, no complaint body, no evidence
  // and no buyer identity.
  it('emails the seller once and does not persist an inbox row', async () => {
    const { svc, calls } = makeService();

    await svc.complaintConcernForSeller({
      email: 'seller@example.com',
      name: 'Sam',
      listingTitle: 'Scope',
      referenceNumber: 'CO000123',
    });

    expect(svc.send).toHaveBeenCalledTimes(1);
    expect(svc.persistByEmail).not.toHaveBeenCalled();
    expect(svc.sendSms).not.toHaveBeenCalled();
    expect(calls).toEqual([]);

    const [to, subject, html] = svc.send.mock.calls[0];
    expect(to).toBe('seller@example.com');
    expect(subject).toContain('Scope');
    expect(html).toContain('Scope');
    expect(html).toContain('does not affect your payment');
    expect(html).toContain('CO000123');
    // Plain email only — no attachment and no complaint body/evidence.
    expect(svc.send.mock.calls[0]).toHaveLength(3);
    expect(html).not.toContain('bob');
  });
});
