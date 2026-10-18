import { createHmac } from 'crypto';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { TransactionsService } from '../payments/transactions.service';
import { OffersService } from '../offers/offers.service';

const SECRET = 'test-app-secret';
const SELLER_PHONE = '27821234567';
const BUYER_PHONE = '27829876543';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('WhatsappWebhookController � sales quick replies', () => {
  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
  });

  function make(opts: {
    templateKey: string;
    vars: Record<string, unknown>;
    to?: string;
    txId?: string;
    offer?: Record<string, unknown> | null;
    actionToken?: Record<string, unknown> | null;
  }) {
    const prisma = {
      whatsappInboundMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      whatsappThread: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'th1', windowClosesAt: new Date(Date.now() + 1e7) }),
        create: jest.fn().mockResolvedValue({ id: 'th1' }),
        update: jest.fn().mockResolvedValue({ id: 'th1' }),
      },
      whatsappMessageLog: {
        findFirst: jest.fn().mockResolvedValue({
          to: opts.to ?? '+27821234567',
          templateKey: opts.templateKey,
          vars: opts.vars,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          sellerId: 'S',
          seller: { phone: '+27821234567' },
          buyerId: 'B',
          buyer: { phone: '+27829876543' },
          shippingMethod: 'COURIER',
        }),
      },
      offer: {
        findUnique: jest.fn().mockResolvedValue(
          opts.offer === undefined
            ? {
                buyerId: 'B',
                buyer: { phone: '+27829876543' },
                listing: {
                  sellerId: 'S',
                  seller: { phone: '+27821234567' },
                },
              }
            : opts.offer,
        ),
      },
      actionToken: {
        findUnique: jest.fn().mockResolvedValue(
          opts.actionToken === undefined
            ? {
                purpose: 'TRANSACTION_ACCEPT',
                targetType: 'transaction',
                targetId: opts.txId ?? 'TX1',
                authorisedUserId: 'S',
                expiresAt: new Date(Date.now() + 60_000),
                usedAt: null,
              }
            : opts.actionToken,
        ),
      },
      adminAlert: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const transactions = {
      acceptTransaction: jest.fn().mockResolvedValue({}),
      rejectTransaction: jest.fn().mockResolvedValue({}),
    };
    const offers = {
      accept: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      acceptCounter: jest.fn().mockResolvedValue({}),
      rejectCounter: jest.fn().mockResolvedValue({}),
    };
    const whatsapp = {
      sendSessionText: jest.fn(
        (args: { to: string; text: string; reference: string }) => {
          void args;
          return true;
        },
      ),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === TransactionsService) return transactions;
        if (token === OffersService) return offers;
        return null;
      }),
    };
    const controller = new WhatsappWebhookController(
      prisma as never,
      whatsapp as never,
      moduleRef as never,
    );
    return { controller, prisma, transactions, offers, whatsapp };
  }

  function body(buttonText: string, from = SELLER_PHONE) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    id: 'wamid.in.1',
                    type: 'button',
                    button: { text: buttonText },
                    context: { id: 'wamid.out.1' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  function req(bodyObj: unknown) {
    const raw = JSON.stringify(bodyObj);
    return {
      headers: { 'x-hub-signature-256': sign(raw) },
      rawBody: Buffer.from(raw),
    } as never;
  }

  it('accepts a paid sale on Accept', async () => {
    const { controller, transactions } = make({
      templateKey: 'new_sale_seller',
      vars: { txId: 'TX1' },
    });
    const b = body('Accept');
    await controller.receiveWebhook(req(b), b);
    expect(transactions.acceptTransaction).toHaveBeenCalledWith('TX1', 'S');
  });

  it('sends the reason-picker link on a paid-sale Decline', async () => {
    const { controller, transactions, whatsapp } = make({
      templateKey: 'new_sale_seller',
      vars: { txId: 'TX1', code: 'aQ2x7Yk9mN4pR8sT2vW6zB' },
    });
    const b = body('Decline');
    await controller.receiveWebhook(req(b), b);
    expect(transactions.rejectTransaction).not.toHaveBeenCalled();
    const call = whatsapp.sendSessionText.mock.lastCall?.[0];
    expect(call?.text).toContain('/a/Q2x7Yk9mN4pR8sT2vW6zB');
  });

  it('accepts a courier sale from the extra txId var', async () => {
    const { controller, transactions } = make({
      templateKey: 'new_sale_seller_courier',
      vars: { acceptToken: 'tok', txId: 'TX1' },
    });
    const b = body('Accept');
    await controller.receiveWebhook(req(b), b);
    expect(transactions.acceptTransaction).toHaveBeenCalledWith('TX1', 'S');
  });

  it('keeps the courier Decline reason-picker instead of defaulting', async () => {
    const { controller, transactions, whatsapp } = make({
      templateKey: 'new_sale_seller_courier',
      vars: { acceptToken: 'tok', txId: 'TX1' },
    });
    const b = body('Decline');
    await controller.receiveWebhook(req(b), b);
    expect(transactions.rejectTransaction).not.toHaveBeenCalled();
    const call = whatsapp.sendSessionText.mock.lastCall?.[0];
    expect(call?.text).toContain('/a/tok');
  });

  it('accepts an offer for the seller', async () => {
    const { controller, offers } = make({
      templateKey: 'offer_received_seller',
      vars: { offerId: 'OFF1' },
    });
    const b = body('Accept');
    await controller.receiveWebhook(req(b), b);
    expect(offers.accept).toHaveBeenCalledWith('S', 'OFF1');
  });

  it('sends the reason-picker link on an offer Decline', async () => {
    const { controller, offers, whatsapp } = make({
      templateKey: 'offer_received_seller',
      vars: { offerId: 'OFF1', code: 'aQ2x7Yk9mN4pR8sT2vW6zB' },
    });
    const b = body('Decline');
    await controller.receiveWebhook(req(b), b);
    expect(offers.reject).not.toHaveBeenCalled();
    const call = whatsapp.sendSessionText.mock.lastCall?.[0];
    expect(call?.text).toContain('/a/Q2x7Yk9mN4pR8sT2vW6zB');
  });

  it('accepts a counter for the buyer', async () => {
    const { controller, offers } = make({
      templateKey: 'offer_countered_buyer',
      vars: { offerId: 'OFF1' },
      to: '+27829876543',
    });
    const b = body('Accept', BUYER_PHONE);
    await controller.receiveWebhook(req(b), b);
    expect(offers.acceptCounter).toHaveBeenCalledWith('B', 'OFF1');
  });

  it('ignores a tap from the wrong phone', async () => {
    const { controller, transactions } = make({
      templateKey: 'new_sale_seller',
      vars: { txId: 'TX1' },
    });
    const b = body('Accept', '27820000000');
    await controller.receiveWebhook(req(b), b);
    expect(transactions.acceptTransaction).not.toHaveBeenCalled();
  });
});
