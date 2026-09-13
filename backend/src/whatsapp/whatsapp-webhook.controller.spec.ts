import { createHmac } from 'crypto';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

const SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function makePrisma() {
  const inbound: unknown[] = [];
  const threads: Record<string, unknown>[] = [];
  return {
    whatsappInboundMessage: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: unknown }) => {
        inbound.push(data);
        return Promise.resolve({ id: `im-${inbound.length}`, ...(data as object) });
      }),
    },
    whatsappThread: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: unknown }) => {
        const row = { id: `th-${threads.length + 1}`, ...(data as object) };
        threads.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: unknown }) => {
        return Promise.resolve({ id: where.id, ...(data as object) });
      }),
    },
    whatsappMessageLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    _inbound: inbound,
    _threads: threads,
  };
}

function fakeRes() {
  const res: { statusCode?: number; body?: unknown; status: jest.Mock; send: jest.Mock } = {
    status: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.send.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('WhatsappWebhookController', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
  });

  describe('GET webhook (handshake)', () => {
    it('echoes the challenge when the token matches and mode is subscribe', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
      const controller = new WhatsappWebhookController(makePrisma() as never);
      const res = fakeRes();
      controller.verifyWebhook('subscribe', VERIFY_TOKEN, 'CHALLENGE123', res as never);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('CHALLENGE123');
    });

    it('returns 403 on a wrong token', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
      const controller = new WhatsappWebhookController(makePrisma() as never);
      const res = fakeRes();
      controller.verifyWebhook('subscribe', 'wrong-token', 'CHALLENGE123', res as never);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 when WHATSAPP_VERIFY_TOKEN is unset, even if a token is supplied', () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      const controller = new WhatsappWebhookController(makePrisma() as never);
      const res = fakeRes();
      controller.verifyWebhook('subscribe', '', 'CHALLENGE123', res as never);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 when mode is not subscribe', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
      const controller = new WhatsappWebhookController(makePrisma() as never);
      const res = fakeRes();
      controller.verifyWebhook('unsubscribe', VERIFY_TOKEN, 'CHALLENGE123', res as never);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('POST webhook', () => {
    function fakeReq(bodyObj: unknown) {
      const raw = Buffer.from(JSON.stringify(bodyObj), 'utf8');
      return {
        headers: { 'x-hub-signature-256': sign(raw.toString('utf8')) },
        rawBody: raw,
      } as unknown as import('express').Request;
    }

    it('bad signature: returns {received:true}, writes nothing, raises the alert', async () => {
      process.env.WHATSAPP_APP_SECRET = SECRET;
      const prisma = makePrisma();
      const controller = new WhatsappWebhookController(prisma as never);
      const body = { object: 'whatsapp_business_account', entry: [] };
      const req = {
        headers: { 'x-hub-signature-256': 'sha256=wrong' },
        rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
      } as unknown as import('express').Request;

      const result = await controller.receiveWebhook(req, body);

      expect(result).toEqual({ received: true });
      expect(prisma.whatsappInboundMessage.create).not.toHaveBeenCalled();
      expect(prisma.whatsappThread.create).not.toHaveBeenCalled();
      expect(prisma.adminAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'WEBHOOK_SIGNATURE_INVALID', referenceId: 'whatsapp' }),
        }),
      );
    });

    it('good signature + messages[]: opens a thread and records the inbound message', async () => {
      process.env.WHATSAPP_APP_SECRET = SECRET;
      const prisma = makePrisma();
      const controller = new WhatsappWebhookController(prisma as never);
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba1',
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    { from: '27821234567', id: 'wamid.IN1', type: 'text', text: { body: 'hi' } },
                  ],
                },
              },
            ],
          },
        ],
      };
      const req = fakeReq(body);

      const result = await controller.receiveWebhook(req, body);

      expect(result).toEqual({ received: true });
      expect(prisma.whatsappThread.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '+27821234567' }) }),
      );
      expect(prisma.whatsappInboundMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ body: 'hi', metaMessageId: 'wamid.IN1' }),
        }),
      );
    });

    it('good signature + statuses[]: updates the matching WhatsappMessageLog row', async () => {
      process.env.WHATSAPP_APP_SECRET = SECRET;
      const prisma = makePrisma();
      prisma.whatsappMessageLog.findFirst = jest.fn().mockResolvedValue({ id: 'log-9' });
      const controller = new WhatsappWebhookController(prisma as never);
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba1',
            changes: [
              {
                field: 'messages',
                value: {
                  statuses: [{ id: 'wamid.OUT1', status: 'delivered', recipient_id: '27821234567' }],
                },
              },
            ],
          },
        ],
      };
      const req = fakeReq(body);

      await controller.receiveWebhook(req, body);

      expect(prisma.whatsappMessageLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'log-9' },
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('redelivery of the same metaMessageId writes nothing twice', async () => {
      process.env.WHATSAPP_APP_SECRET = SECRET;
      const prisma = makePrisma();
      // Simulate the message already recorded.
      prisma.whatsappInboundMessage.findFirst = jest.fn().mockResolvedValue({ id: 'im-existing' });
      const controller = new WhatsappWebhookController(prisma as never);
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba1',
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    { from: '27821234567', id: 'wamid.IN1', type: 'text', text: { body: 'hi again' } },
                  ],
                },
              },
            ],
          },
        ],
      };
      const req = fakeReq(body);

      await controller.receiveWebhook(req, body);

      expect(prisma.whatsappInboundMessage.create).not.toHaveBeenCalled();
      expect(prisma.whatsappThread.create).not.toHaveBeenCalled();
    });
  });
});
