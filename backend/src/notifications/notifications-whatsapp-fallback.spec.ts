jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

function makeService(logs: unknown[]) {
  const update = jest.fn().mockResolvedValue({});
  const sendSms = jest.fn().mockResolvedValue(undefined);
  const sendEmail = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    whatsappMessageLog: {
      findMany: jest.fn().mockResolvedValue(logs),
      update,
    },
    transaction: { findUnique: jest.fn() },
    offer: { findUnique: jest.fn() },
    listing: { findUnique: jest.fn() },
    user: {
      findFirst: jest.fn().mockResolvedValue({
        email: 'seller@example.com',
        firstName: 'Sam',
      }),
    },
  };
  const svc = Object.create(NotificationsService.prototype) as Record<
    string,
    any
  >;
  Object.assign(svc, {
    appUrl: 'https://alloutdoor.co.za',
    prisma,
    sms: {
      toE164: (v: string) => (v.startsWith('0') ? `+27${v.slice(1)}` : v),
    },
    sendSms,
    send: sendEmail,
    email: jest.fn(() => '<html />'),
  });
  return { svc: svc as NotificationsService & Record<string, any>, prisma, update, sendSms, sendEmail };
}

function log(over: Record<string, unknown> = {}) {
  return {
    id: 'log1',
    to: '0820000000',
    templateKey: 'new_sale_seller',
    status: 'SENT',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    vars: {
      ref: 'ABCDEF12',
      code: 'aaccept-token',
      txId: 'tx1',
    },
    ...over,
  };
}

describe('WhatsApp fallback nudges', () => {
  it('sends SMS and email once when a sale message is undelivered after an hour', async () => {
    const { svc, prisma, update, sendSms, sendEmail } = makeService([
      log(),
    ]);
    prisma.transaction.findUnique.mockResolvedValue({
      acceptedAt: null,
      paymentStatus: 'HELD',
    });

    await expect(svc.processWhatsappFallbacks()).resolves.toEqual({
      undelivered: 1,
      unread: 0,
    });

    expect(sendSms).toHaveBeenCalledWith(
      '0820000000',
      expect.stringContaining('https://alloutdoor.co.za/a/accept-token'),
      'wa-undelivered-log1',
    );
    expect(sendEmail).toHaveBeenCalledWith(
      'seller@example.com',
      expect.stringContaining('Action needed'),
      '<html />',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'log1' },
      data: {
        undeliveredNudgeAt: expect.any(Date),
        unreadNudgeAt: expect.any(Date),
      },
    });
  });

  it('sends only the unread reminder when delivery succeeded but the offer is unread', async () => {
    const { svc, prisma, update, sendSms } = makeService([
      log({
        templateKey: 'offer_received_seller',
        status: 'DELIVERED',
        createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        vars: { offerId: 'offer1', code: 'aoffer-token' },
      }),
    ]);
    prisma.offer.findUnique.mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(svc.processWhatsappFallbacks()).resolves.toEqual({
      undelivered: 0,
      unread: 1,
    });

    expect(sendSms).toHaveBeenCalledWith(
      '0820000000',
      expect.stringContaining('/a/offer-token'),
      'wa-unread-log1',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'log1' },
      data: { unreadNudgeAt: expect.any(Date) },
    });
  });

  it('does not nudge an action that is already complete, but stamps the log', async () => {
    const { svc, prisma, update, sendSms, sendEmail } = makeService([
      log(),
    ]);
    prisma.transaction.findUnique.mockResolvedValue({
      acceptedAt: new Date(),
      paymentStatus: 'HELD',
    });

    await expect(svc.processWhatsappFallbacks()).resolves.toEqual({
      undelivered: 0,
      unread: 0,
    });
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
