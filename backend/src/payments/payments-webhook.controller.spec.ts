// The Ozow webhook controller must NOT swallow a handler failure with a 200:
// Ozow treats 200 as delivered and will not re-send, and there is no poll
// fallback for a missed pay-in notification, so a transient failure would
// strand a paid order forever. A bad-signature drop is a different case — it
// stays 200 (retrying a forged delivery is pointless).
import { InternalServerErrorException } from '@nestjs/common';
import { PaymentsWebhookController } from './transactions.controller';

function makeController(
  over: {
    valid?: boolean;
    handlerError?: Error;
  } = {},
) {
  const txService = {
    verifyOzowWebhook: jest.fn().mockReturnValue(over.valid ?? true),
    handleOzowWebhook: over.handlerError
      ? jest.fn().mockRejectedValue(over.handlerError)
      : jest.fn().mockResolvedValue(undefined),
    alertWebhookSignatureFailure: jest.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new PaymentsWebhookController(txService as never),
    txService,
  };
}

const req = () =>
  ({
    headers: {
      'svix-id': 'id',
      'svix-timestamp': 'ts',
      'svix-signature': 'sig',
    },
    rawBody: Buffer.from('{"type":"transaction.complete"}'),
  }) as never;

describe('PaymentsWebhookController — Ozow pay-in webhook', () => {
  it('returns 200 and drops when the signature is invalid', async () => {
    const { controller, txService } = makeController({ valid: false });
    const res = await controller.ozowWebhook(req(), {});
    expect(res).toEqual({ received: true });
    expect(txService.handleOzowWebhook).not.toHaveBeenCalled();
    expect(txService.alertWebhookSignatureFailure).toHaveBeenCalled();
  });

  it('returns 200 on a successful handler run', async () => {
    const { controller } = makeController();
    await expect(controller.ozowWebhook(req(), {})).resolves.toEqual({
      received: true,
    });
  });

  it('re-throws as 500 so Ozow re-delivers when the handler fails', async () => {
    const { controller } = makeController({
      handlerError: new Error('db down'),
    });
    await expect(controller.ozowWebhook(req(), {})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
