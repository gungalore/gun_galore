import { createHmac } from 'crypto';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

const SECRET = 'test-app-secret';
function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

// W2 — a Private Arrangement quick reply ("Item received") is resolved from the
// tapped message's templateKey + vars.txId and routed to TransactionsService.
describe('WhatsappWebhookController — private-arrange buttons', () => {
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
    tx?: Record<string, unknown> | null;
  }) {
    const prisma = {
      whatsappInboundMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      whatsappThread: {
        findFirst: jest.fn().mockResolvedValue({ id: 'th1', windowClosesAt: new Date(Date.now() + 1e7) }),
        create: jest.fn().mockResolvedValue({ id: 'th1' }),
        update: jest.fn().mockResolvedValue({ id: 'th1' }),
      },
      whatsappMessageLog: {
        findFirst: jest.fn().mockResolvedValue({
          to: opts.to ?? '+27821234567',
          templateKey: opts.templateKey,
          vars: opts.vars,
        }),
      },
      transaction: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.tx === undefined
              ? { buyerId: 'B', sellerId: 'S', shippingMethod: 'PRIVATE_ARRANGE' }
              : opts.tx,
          ),
      },
    };
    const transactions = {
      markPrivateArrangeDelivered: jest.fn().mockResolvedValue({}),
      confirmPrivateArrangeReceived: jest.fn().mockResolvedValue({}),
      disputePrivateArrange: jest.fn().mockResolvedValue({}),
    };
    const moduleRef = { get: jest.fn().mockReturnValue(transactions) };
    const controller = new WhatsappWebhookController(
      prisma as never,
      undefined,
      moduleRef as never,
    );
    return { controller, prisma, transactions };
  }

  function body(buttonText: string, from = '27821234567') {
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

  it('routes a buyer "Item received" tap to confirm receipt', async () => {
    const { controller, transactions } = make({
      templateKey: 'private_arrange_buyer_confirm',
      vars: { txId: 'TX1' },
    });
    const b = body('Item received');
    await controller.receiveWebhook(req(b), b as never);
    expect(transactions.confirmPrivateArrangeReceived).toHaveBeenCalledWith('TX1', 'B');
  });

  it('routes a seller "Item delivered" tap', async () => {
    const { controller, transactions } = make({
      templateKey: 'private_arrange_seller_handover',
      vars: { txId: 'TX1' },
    });
    const b = body('Item delivered');
    await controller.receiveWebhook(req(b), b as never);
    expect(transactions.markPrivateArrangeDelivered).toHaveBeenCalledWith('TX1', 'S');
  });

  it('routes a "Dispute" tap from the buyer', async () => {
    const { controller, transactions } = make({
      templateKey: 'private_arrange_buyer_confirm',
      vars: { txId: 'TX1' },
    });
    const b = body('Dispute');
    await controller.receiveWebhook(req(b), b as never);
    expect(transactions.disputePrivateArrange).toHaveBeenCalledWith(
      'TX1',
      'B',
      'Raised via WhatsApp',
    );
  });

  it('ignores an "Item received" tap on the seller template (wrong party)', async () => {
    const { controller, transactions } = make({
      templateKey: 'private_arrange_seller_handover',
      vars: { txId: 'TX1' },
    });
    const b = body('Item received');
    await controller.receiveWebhook(req(b), b as never);
    expect(transactions.confirmPrivateArrangeReceived).not.toHaveBeenCalled();
  });

  it('ignores a tap from a phone we did not send the message to', async () => {
    const { controller, transactions } = make({
      templateKey: 'private_arrange_buyer_confirm',
      vars: { txId: 'TX1' },
      to: '+27820000000',
    });
    const b = body('Item received', '27821234567');
    await controller.receiveWebhook(req(b), b as never);
    expect(transactions.confirmPrivateArrangeReceived).not.toHaveBeenCalled();
  });
});
