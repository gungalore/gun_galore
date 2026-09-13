import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { DeskWhatsappController } from './desk-whatsapp.controller';
import { DeskWhatsappService } from './desk-whatsapp.service';

/**
 * THE DESK — the WhatsApp reply endpoints.
 *
 * ⚠️ `/reply` IGNORING ANYTHING BUT `templateKey` IS THE WHOLE NO-FREE-TEXT
 * CONTRACT. The controller reads only `body?.templateKey` off the request —
 * see the direct-controller test below, which posts a `text`/`vars` payload
 * alongside a valid key and proves DeskWhatsappService.reply is called with
 * nothing else.
 */
describe('DeskWhatsappController', () => {
  it('is guarded by AdminJwtGuard — GET is open to any active admin, every other method SUPERADMIN-only by the guard itself', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DeskWhatsappController) ?? [];
    expect(guards).toContain(AdminJwtGuard);
  });

  function makeController(overrides: Partial<DeskWhatsappService> = {}) {
    const service = {
      fetchThread: jest.fn(),
      reply: jest.fn().mockResolvedValue({ ok: true }),
      markHandled: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    } as unknown as DeskWhatsappService;
    return { controller: new DeskWhatsappController(service), service };
  }

  it('reply() posts only templateKey to the service — anything else in the body has no effect', async () => {
    const { controller, service } = makeController();
    await controller.reply('th_1', {
      templateKey: 'order_confirmed_buyer',
      // A free-text composer arriving by the back door — must be dropped.
      text: 'Hi, your order is on the way!',
      vars: { ref: 'HACKED', title: 'Glock 19' },
    } as never);

    expect(service.reply).toHaveBeenCalledTimes(1);
    expect(service.reply).toHaveBeenCalledWith('th_1', 'order_confirmed_buyer');
  });

  it('reply() with no templateKey at all still calls through with an empty string, never throwing on the controller boundary', async () => {
    const { controller, service } = makeController();
    await controller.reply('th_1', {} as never);
    expect(service.reply).toHaveBeenCalledWith('th_1', '');
  });

  it('markHandled() takes no body at all', async () => {
    const { controller, service } = makeController();
    await controller.markHandled('th_1');
    expect(service.markHandled).toHaveBeenCalledWith('th_1');
  });

  it('fetchThread() passes the id straight through', async () => {
    const { controller, service } = makeController();
    await controller.fetchThread('th_1');
    expect(service.fetchThread).toHaveBeenCalledWith('th_1');
  });

  it('surfaces the service refusal (window closed / channel off) as a thrown error, not a swallowed one', async () => {
    const { controller } = makeController({
      reply: jest.fn().mockRejectedValue(new BadRequestException('The 24-hour window has closed.')),
    });
    await expect(controller.reply('th_1', { templateKey: 'order_confirmed_buyer' } as never)).rejects.toThrow(
      'The 24-hour window has closed.',
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * The real DeskWhatsappService, driven through the controller — a fake
 * Prisma and a fake WhatsappService stand in for the box, so these prove
 * the actual gates (channel, window, var re-derivation) rather than a mock
 * that only echoes back what it was told to say.
 * ──────────────────────────────────────────────────────────────────────── */

function makePrisma(over: {
  thread?: Record<string, unknown> | null;
  whatsappEnabled?: boolean;
  tx?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
}) {
  return {
    whatsappThread: {
      findUnique: jest.fn().mockResolvedValue(over.thread ?? null),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: unknown }) =>
        Promise.resolve({ id: where.id, ...(over.thread ?? {}), ...(data as object) }),
      ),
    },
    setting: {
      findUnique: jest
        .fn()
        .mockResolvedValue(over.whatsappEnabled === undefined ? null : { value: String(over.whatsappEnabled) }),
    },
    transaction: {
      findUnique: jest.fn().mockResolvedValue(over.tx ?? null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(over.user ?? null),
    },
  };
}

function makeWhatsapp(sendResult: { success: boolean } = { success: true }) {
  return { sendTemplate: jest.fn().mockResolvedValue(sendResult) };
}

const OPEN_THREAD = {
  id: 'th_1',
  phone: '+27821234567',
  userId: 'u_1',
  transactionId: 'tx_1',
  windowOpenedAt: new Date('2026-09-13T08:00:00.000Z'),
  windowClosesAt: new Date(Date.now() + 6 * 3_600_000),
  handledAt: null,
  messages: [],
};

const TX = {
  id: 'tx_1',
  orderReference: 'AO-1234',
  trackingReference: null,
  carrierDropoffPin: null,
  carrierProvider: null,
  shippingStatus: null,
  estimatedDeliveryAt: null,
  listing: { title: 'A rifle' },
};

describe('DeskWhatsappController + DeskWhatsappService, end to end', () => {
  it('reply() refuses when whatsapp_enabled is off, and never calls the sender', async () => {
    const prisma = makePrisma({ thread: OPEN_THREAD, whatsappEnabled: false, tx: TX });
    const whatsapp = makeWhatsapp();
    const service = new DeskWhatsappService(prisma as never, whatsapp as never);
    const controller = new DeskWhatsappController(service);

    await expect(controller.reply('th_1', { templateKey: 'order_confirmed_buyer' })).rejects.toThrow(
      /kill switch is off/,
    );
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('reply() refuses once the 24-hour window has closed, and never calls the sender', async () => {
    const closedThread = { ...OPEN_THREAD, windowClosesAt: new Date(Date.now() - 60_000) };
    const prisma = makePrisma({ thread: closedThread, whatsappEnabled: true, tx: TX });
    const whatsapp = makeWhatsapp();
    const service = new DeskWhatsappService(prisma as never, whatsapp as never);
    const controller = new DeskWhatsappController(service);

    await expect(controller.reply('th_1', { templateKey: 'order_confirmed_buyer' })).rejects.toThrow(
      /window has closed/,
    );
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('reply() sends with vars re-derived from the order, ignoring anything the caller supplied', async () => {
    const prisma = makePrisma({ thread: OPEN_THREAD, whatsappEnabled: true, tx: TX });
    const whatsapp = makeWhatsapp();
    const service = new DeskWhatsappService(prisma as never, whatsapp as never);
    const controller = new DeskWhatsappController(service);

    await controller.reply('th_1', {
      templateKey: 'order_confirmed_buyer',
      // @ts-expect-error — deliberately posting fields the route must ignore
      vars: { ref: 'HACKED' },
      text: 'free text',
    });

    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const call = whatsapp.sendTemplate.mock.calls[0][0];
    expect(call.templateKey).toBe('order_confirmed_buyer');
    expect(call.vars).toEqual({ ref: 'AO-1234', txId: 'tx_1' });
    expect(call.vars.ref).not.toBe('HACKED');
  });

  it('handled() stamps handledAt and sends nothing', async () => {
    const prisma = makePrisma({ thread: OPEN_THREAD, whatsappEnabled: true, tx: TX });
    const whatsapp = makeWhatsapp();
    const service = new DeskWhatsappService(prisma as never, whatsapp as never);
    const controller = new DeskWhatsappController(service);

    const result = await controller.markHandled('th_1');

    expect(result).toEqual({ ok: true });
    expect(prisma.whatsappThread.update).toHaveBeenCalledWith({
      where: { id: 'th_1' },
      data: { handledAt: expect.any(Date) },
    });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });
});
