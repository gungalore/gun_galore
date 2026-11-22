import { InternalServerErrorException } from '@nestjs/common';
import { MotivationPaymentsWebhookController } from './motivation-payments.controller';

function build() {
  const payments = {
    handleYocoEvent: jest.fn(async () => undefined),
    reportWebhookRejected: jest.fn(async () => undefined),
  };
  const yoco = {
    verifyWebhook: jest.fn(() => 'valid'),
  };
  const controller = new MotivationPaymentsWebhookController(
    payments as never,
    yoco as never,
  );
  return { controller, payments, yoco };
}

const BODY = {
  type: 'payment.succeeded',
  payload: { metadata: { reference: 'MO000123-ABC123' } },
};
const REQ = {
  headers: {
    'webhook-id': 'msg_1',
    'webhook-timestamp': '1800000000',
    'webhook-signature': 'v1,abc',
  },
  rawBody: Buffer.from(JSON.stringify(BODY)),
} as never;

describe('the Yoco webhook controller', () => {
  it('checks the raw body, then hands the event to the service', async () => {
    const { controller, payments, yoco } = build();
    await expect(controller.yocoWebhook(REQ, BODY)).resolves.toEqual({
      received: true,
    });
    expect(yoco.verifyWebhook).toHaveBeenCalledWith({
      rawBody: JSON.stringify(BODY),
      headers: {
        id: 'msg_1',
        timestamp: '1800000000',
        signature: 'v1,abc',
      },
    });
    expect(payments.handleYocoEvent).toHaveBeenCalledWith(BODY);
  });

  it('drops an invalid signature, alerts, and applies nothing', async () => {
    const { controller, payments, yoco } = build();
    yoco.verifyWebhook.mockReturnValueOnce('invalid');
    await expect(controller.yocoWebhook(REQ, BODY)).resolves.toEqual({
      received: true,
    });
    expect(payments.reportWebhookRejected).toHaveBeenCalledWith(
      'invalid signature',
    );
    expect(payments.handleYocoEvent).not.toHaveBeenCalled();
  });

  it('is quiet but honest while no signing secret is installed', async () => {
    const { controller, payments, yoco } = build();
    yoco.verifyWebhook.mockReturnValueOnce('unsigned');
    await expect(controller.yocoWebhook(REQ, BODY)).resolves.toEqual({
      received: true,
    });
    expect(payments.reportWebhookRejected).not.toHaveBeenCalled();
    expect(payments.handleYocoEvent).not.toHaveBeenCalled();
  });

  it('answers 500 when the handler fails so Yoco retries', async () => {
    const { controller, payments } = build();
    payments.handleYocoEvent.mockRejectedValueOnce(new Error('db down'));
    await expect(controller.yocoWebhook(REQ, BODY)).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
